/*
 * Graph Studio computation tests on small datasets, plus a cross-check of a mean and its
 * confidence interval against the PSPP engine (skipped when the engine build is absent).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef } from '../charts/studioTypes';
import students from '../samples/students.json';
import { runWithExtensions } from '../ext/runner';
import { binEdges, binIndex, boxStats, computeChart, intervalHalf, niceStep, summarize } from './compute';
import { defaultDef, missingSlots, rejection, slotsOf, withVariant } from './model';
import { cleanStyle, seriesNames } from './series';

const t = (k: string, a?: Record<string, unknown>) => (a ? `${k}:${JSON.stringify(a)}` : k);

const num = (name: string, extra: Partial<Variable> = {}): Variable => ({
  name,
  label: '',
  type: 'numeric',
  width: 0,
  print: { type: 'F', w: 8, d: 2 },
  write: { type: 'F', w: 8, d: 2 },
  valueLabels: [],
  missing: { values: [] },
  columns: 8,
  align: 'right',
  measure: 'scale',
  role: 'input',
  ...extra,
});

/** group 1 = Female, 2 = Male; y has one system-missing value */
function small(extra: Partial<Dataset> = {}): Dataset {
  return {
    name: 'small',
    variables: [num('g', { measure: 'nominal', valueLabels: [{ value: 1, label: 'Female' }, { value: 2, label: 'Male' }] }), num('y'), num('x'), num('w')],
    columns: [
      [2, 1, 1, 2, 1, 2, 1, 2],
      [4, 2, 3, 8, null, 6, 5, 10],
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 1, 1, 1, 1, 1, 1, 1],
    ],
    ...extra,
  };
}

const def = (kind: GraphDef['kind'], variant: string, bind: GraphDef['bind'], options: Record<string, unknown> = {}): GraphDef => {
  const d = defaultDef(kind, variant);
  return { ...d, bind, options: { ...d.options, ...options } };
};

function ok(d: GraphDef, ds: Dataset) {
  const r = computeChart(d, ds, t);
  if (!r.ok) throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r;
}

describe('numeric helpers', () => {
  it('nice steps and bin edges', () => {
    expect(niceStep(0.37)).toBe(0.5);
    expect(niceStep(7)).toBe(10);
    expect(binEdges(0, 100, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(binEdges(2, 9, 7, { integer: true })).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(binEdges(3, 3, 5)).toEqual([2.5, 3.5]);
    expect(binEdges(18, 66, 5, { width: 5 })).toEqual([15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]);
  });
  it('puts the maximum into the last, closed bin', () => {
    const e = [0, 10, 20];
    expect(binIndex(e, 0)).toBe(0);
    expect(binIndex(e, 10)).toBe(1);
    expect(binIndex(e, 20)).toBe(1);
    expect(binIndex(e, 21)).toBe(-1);
  });
  it('weighted summaries', () => {
    const v = [{ y: 1, w: 3 }, { y: 5, w: 1 }];
    expect(summarize('mean', v)).toBe(2);
    expect(summarize('median', v)).toBe(1);
    expect(summarize('sum', v)).toBe(8);
    expect(summarize('sd', [{ y: 1, w: 1 }])).toBeNull();
  });
  it('t based interval', () => {
    const vals = [2, 4, 4, 4, 5, 5, 7, 9].map((y) => ({ y, w: 1 }));
    // sd = 2.138, se = 0.756, t(0.975, 7) = 2.365
    expect(intervalHalf('ci', 95, 2, vals)).toBeCloseTo(1.788, 2);
    expect(intervalHalf('se', 95, 2, vals)).toBeCloseTo(1.512, 2);
    expect(intervalHalf('sd', 95, 1, vals)).toBeCloseTo(2.138, 2);
  });
  it('boxplot with an outlier uses Tukey hinges', () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 30].map((y, row) => ({ y, row })), 'a');
    expect(b.hinges).toEqual([2.5, 4, 5.5]);
    expect(b.whiskers).toEqual([1, 6]);
    expect(b.outliers).toEqual([{ value: 30, label: '7', extreme: true }]);
  });
});

describe('model', () => {
  it('knows required slots and why a variable is rejected', () => {
    const d = defaultDef('bar', 'clustered');
    expect(missingSlots(d).map((s) => s.id)).toEqual(['x', 'group']);
    const s = slotsOf(defaultDef('scatter', 'simple'));
    const text = num('t', { type: 'string' });
    expect(rejection(s[0], text, 3)?.key).toBe('graphstudio.reject.text');
    expect(rejection(slotsOf(d)[0], num('age'), 80)).toBeNull();
    expect(rejection(slotsOf(d)[0], num('age', { measure: 'nominal' }), 80)).toBeNull();
  });
  it('drops bindings of slots that disappear and fixes options', () => {
    const d = withVariant({ ...def('bar', 'clustered', { x: ['g'], group: ['g2'] }, { func: 'mean' }) }, 'stacked');
    expect(d.options.func).toBe('count');
    const e = withVariant(d, 'simple');
    expect(e.bind.group).toEqual(['g2']);
    expect(withVariant(def('histogram', 'stacked', { value: ['y'], group: ['g'] }), 'simple').bind.group).toBeUndefined();
  });
});

describe('computeChart', () => {
  it('asks for missing slots instead of drawing', () => {
    const r = computeChart(defaultDef('bar', 'simple'), small(), t);
    expect(r).toEqual({ ok: false, reason: 'missing', slots: ['x'] });
  });
  it('reports unknown variables', () => {
    const r = computeChart(def('bar', 'simple', { x: ['nope'] }), small(), t);
    expect(r).toEqual({ ok: false, reason: 'novar', names: ['nope'] });
  });

  it('bar of counts uses value labels in value order', () => {
    const r = ok(def('bar', 'simple', { x: ['g'] }), small());
    expect(r.chart.type).toBe('bar');
    expect(r.chart.bars).toEqual([
      { x: 'Female', group: null, count: 4 },
      { x: 'Male', group: null, count: 4 },
    ]);
    expect(r.info.used).toBe(8);
  });
  it('bar of means drops cases with a missing value (listwise) and reports it', () => {
    const r = ok(def('bar', 'simple', { x: ['g'], value: ['y'] }, { func: 'mean' }), small());
    // Female: 2, 3, 5 (the missing one is out) -> mean 3.333; Male: 4, 8, 6, 10 -> 7
    const bars = r.chart.bars as { x: string; count: number }[];
    expect(bars[0].count).toBeCloseTo(10 / 3, 10);
    expect(bars[1].count).toBe(7);
    expect(r.info.excluded).toBe(1);
    expect(r.info.used).toBe(7);
    expect(r.chart.ylabel).toContain('graphstudio.func.mean');
  });
  it('bar with a confidence interval adds err aligned with the bars', () => {
    const r = ok(def('bar', 'simple', { x: ['g'], value: ['y'] }, { func: 'mean', interval: 'ci', level: 95 }), small());
    const err = r.chart.err as ({ lo: number; hi: number } | null)[];
    const bars = r.chart.bars as { count: number }[];
    expect(err).toHaveLength(2);
    const male = [4, 8, 6, 10].map((y) => ({ y, w: 1 }));
    expect(err[1]!.hi - bars[1].count).toBeCloseTo(intervalHalf('ci', 95, 2, male)!, 10);
    expect(err[1]!.lo + err[1]!.hi).toBeCloseTo(2 * bars[1].count, 10);
  });
  it('stacked and horizontal variants set the flags; percent counts of the drawn cases', () => {
    const s = ok(def('bar', 'stacked100', { x: ['g'], group: ['w'] }), small());
    expect(s.chart.stack).toBe('stack100');
    const h = ok(def('bar', 'horizontal', { x: ['g'] }, { func: 'pct' }), small());
    expect(h.chart.horizontal).toBe(true);
    expect(h.chart.percent).toBe(true);
    expect((h.chart.bars as { count: number }[]).map((b) => b.count)).toEqual([50, 50]);
  });
  it('honours the weight and the filter of the dataset', () => {
    const ds = small();
    ds.columns[3] = [1, 1, 1, 1, 1, 1, 1, 5];
    ds.weight = 'w';
    const r = ok(def('bar', 'simple', { x: ['g'] }), ds);
    expect((r.chart.bars as { count: number }[]).map((b) => b.count)).toEqual([4, 8]);
    expect(r.info.weight).toBe('w');
    const filtered = small({ filter: 'f', variables: [...small().variables, num('f')], columns: [...small().columns, [1, 1, 1, 0, 1, 1, 1, 1]] });
    const f = ok(def('bar', 'simple', { x: ['g'] }), filtered);
    expect(f.info.filtered).toBe(1);
    expect((f.chart.bars as { count: number }[]).map((b) => b.count)).toEqual([4, 3]);
  });
  it('sorts categories by value', () => {
    const r = ok(def('bar', 'simple', { x: ['g'], value: ['y'] }, { func: 'mean', sort: 'desc' }), small());
    expect((r.chart.bars as { x: string }[]).map((b) => b.x)).toEqual(['Male', 'Female']);
  });

  it('line and error bar charts', () => {
    const l = ok(def('line', 'multiple', { x: ['g'], group: ['w'], value: ['y'] }, { func: 'mean', interval: 'se' }), small());
    expect(l.chart.type).toBe('line');
    expect(l.chart.categories).toEqual(['Female', 'Male']);
    expect(l.chart.errorLabel).toContain('graphstudio.chart.se');
    const e = ok(def('errorbar', 'simple', { x: ['g'], value: ['y'] }), small());
    expect(e.chart.connect).toBe(false);
    const s = (e.chart.series as { values: number[]; lo: number[]; hi: number[] }[])[0];
    expect(s.values[1]).toBe(7);
    expect(s.lo[1]).toBeLessThan(7);
    expect(s.hi[1]).toBeGreaterThan(7);
  });
  it('area and pie', () => {
    const a = ok(def('area', 'stacked', { x: ['w'], group: ['g'] }), small());
    expect(a.chart.stack).toBe('stack');
    expect((a.chart.series as { name: string }[]).map((x) => x.name)).toEqual(['Female', 'Male']);
    const p = ok(def('pie', 'simple', { x: ['g'] }), small());
    expect(p.chart.slices).toEqual([{ label: 'Female', value: 4 }, { label: 'Male', value: 4 }]);
  });

  it('histogram: nice bins, stacked series, polygon mode, normal curve numbers', () => {
    const ds = small();
    const h = ok(def('histogram', 'simple', { value: ['x'] }, { binRule: 'width', binWidth: 4, normal: true }), ds);
    expect(h.chart.bins).toEqual([[0, 4, 3], [4, 8, 5]]);
    expect(h.chart.showNormal).toBe(true);
    expect(h.chart.n).toBe(8);
    expect(h.chart.mean).toBe(4.5);
    expect(h.chart.stddev as number).toBeCloseTo(2.449, 3);
    const st = ok(def('histogram', 'stacked', { value: ['x'], group: ['g'] }, { binRule: 'width', binWidth: 4 }), ds);
    const series = st.chart.series as { name: string; counts: number[] }[];
    expect(series.map((x) => x.name)).toEqual(['Female', 'Male']);
    expect(series[0].counts.map((c, i) => c + series[1].counts[i])).toEqual([3, 5]);
    expect(ok(def('histogram', 'polygon', { value: ['x'] }), ds).chart.mode).toBe('polygon');
  });
  it('pyramid takes the first two categories', () => {
    const p = ok(def('pyramid', 'simple', { value: ['x'], group: ['g'] }, { binRule: 'width', binWidth: 4 }), small());
    expect(p.chart.leftName).toBe('Female');
    expect(p.chart.bins).toEqual([[0, 4, 2, 1], [4, 8, 2, 3]]);
    const swapped = ok(def('pyramid', 'simple', { value: ['x'], group: ['g'] }, { binRule: 'width', binWidth: 4, swap: true }), small());
    expect(swapped.chart.leftName).toBe('Male');
  });
  it('boxplot per category and clustered', () => {
    const b = ok(def('boxplot', 'simple', { value: ['y'], x: ['g'] }), small());
    expect((b.chart.boxes as { label: string }[]).map((x) => x.label)).toEqual(['Female', 'Male']);
    const c = ok(def('boxplot', 'clustered', { value: ['y'], x: ['g'], group: ['w'] }), small());
    // clustered boxes keep the category as the label and name the cluster member in `group`
    expect((c.chart.boxes as { label: string; group: string }[]).map((x) => [x.label, x.group])).toEqual([['Female', '1'], ['Male', '1']]);
  });
  it('scatter keeps fit options and group labels; listwise missing', () => {
    const r = ok(def('scatter', 'grouped', { x: ['x'], y: ['y'], group: ['g'] }, { fit: 'linear' }), small());
    expect(r.chart.points).toHaveLength(7);
    expect((r.chart.points as unknown[][])[0]).toEqual([1, 4, 'Male']);
    expect(r.chart.fit).toBe('linear');
    expect(r.chart.showR2).toBe(true);
    expect(r.chart.byvar).toBe('g');
  });
  it('dot, pareto, heatmap', () => {
    const d = ok(def('dot', 'simple', { value: ['x'] }), small());
    expect((d.chart.bins as { x: number; count: number }[]).map((b) => b.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const p = ok(def('pareto', 'simple', { x: ['g'], value: ['y'] }), small());
    expect(p.chart.bars).toEqual([{ label: 'Male', count: 28 }, { label: 'Female', count: 10 }]);
    expect(p.chart.total).toBe(38);
    const h = ok(def('heatmap', 'simple', { x: ['x'], y: ['y'] }, { xBins: 4, yBins: 4 }), small());
    const counts = h.chart.counts as number[][];
    expect(counts.flat().reduce((s, c) => s + c, 0)).toBe(7);
  });
  it('scatter matrix samples deterministically to at most 2000 cases', () => {
    const n = 5000;
    const ds: Dataset = { name: 'big', variables: [num('a'), num('b')], columns: [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => (i * 7) % 101)] };
    const d = def('scattermatrix', 'simple', { vars: ['a', 'b'] });
    const r1 = ok(d, ds);
    const r2 = ok(d, ds);
    expect((r1.chart.rows as unknown[]).length).toBeLessThanOrEqual(2000);
    expect(r1.chart.rows).toEqual(r2.chart.rows);
    expect(r1.notes).toHaveLength(1);
    expect(ok(def('scattermatrix', 'simple', { vars: ['x', 'y'] }), small()).notes).toEqual([]);
  });
  it('names the series for the palette', () => {
    expect(seriesNames(ok(def('bar', 'clustered', { x: ['g'], group: ['w'] }), small()).chart)).toEqual(['1']);
    expect(seriesNames(ok(def('pie', 'simple', { x: ['g'] }), small()).chart)).toEqual(['Female', 'Male']);
    expect(seriesNames({ chart: { type: 'roc', curves: [{ name: 'A' }, { name: 'B' }] } })).toEqual(['A', 'B']);
  });
  it('cleans empty style values', () => {
    expect(cleanStyle({ title: '', palette: [null, null], xMin: null, fontScale: 1, grid: false })).toEqual({ grid: false });
  });
});

const ENGINE = path.resolve(__dirname, '../../public/engine/pspp.js');
const WRAPPER = path.resolve(__dirname, '../../../engine/js/engine.mjs');
const have = fs.existsSync(ENGINE) && fs.existsSync(WRAPPER);

describe.skipIf(!have)('cross-check with the PSPP engine', () => {
  it('mean and 95% CI of gpa match T-TEST (test value 0)', async () => {
    const ds = students as unknown as Dataset;
    const mine = ok(def('errorbar', 'simple', { x: ['gender'], value: ['gpa'] }, { interval: 'ci', level: 95 }), ds);
    const s = (mine.chart.series as { values: number[]; lo: number[]; hi: number[] }[])[0];
    const { createEngine } = await import(/* @vite-ignore */ pathToFileURL(WRAPPER).href);
    const { default: createPspp } = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
    const engine = await createEngine(createPspp);
    await engine.init();
    const r = await runWithExtensions(engine, 'TEMPORARY.\nSELECT IF gender = 1.\nT-TEST /TESTVAL=0 /VARIABLES=gpa /CRITERIA=CI(.95).', structuredClone(ds), { lang: 'en', decimal: '.', t: (k: string) => k });
    const flat = (items: { kind: string; children?: unknown[] }[]): { kind: string; html?: string }[] => items.flatMap((i) => (i.kind === 'group' ? flat(i.children as never) : [i as never]));
    const html = flat(r.items as never)
      .filter((i) => i.kind === 'table')
      .map((i) => i.html ?? '')
      .join('\n');
    const nums = [...html.replace(/<[^>]+>/g, ' ').matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
    if (process.env.SHOW) console.log(s, nums);
    // the one-sample test table lists the mean difference and the CI bounds (2 decimals)
    const has = (x: number) => nums.some((n) => Math.abs(n - x) < 0.006);
    expect(has(s.values[0])).toBe(true);
    expect(has(s.lo[0])).toBe(true);
    expect(has(s.hi[0])).toBe(true);
  }, 60000);
});
