/*
 * Graph Studio phase 2 tests: high-low, dual axis, probability plots, sequence, control charts,
 * violin, density, panels, quick reference statistics and the many-categories rules.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef } from '../charts/studioTypes';
import { blom, c4, computeChart, D2, kde, niceRange, quickStats, silverman, standardQuantile } from './compute';
import { CATEGORY_CAP, defaultDef, optionsOf, rejection, slotsOf, withVariant } from './model';
import { studioChart } from './outputBridge';
import { labelNumber, quickLines } from './Properties';
import { seriesNames } from './series';

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

const ds = (vars: [string, (number | null)[]][], extra: Partial<Dataset> = {}): Dataset => ({ name: 't', variables: vars.map(([n]) => num(n)), columns: vars.map(([, c]) => c), ...extra });

const def = (kind: GraphDef['kind'], variant: string, bind: GraphDef['bind'], options: Record<string, unknown> = {}): GraphDef => {
  const d = defaultDef(kind, variant);
  return { ...d, bind, options: { ...d.options, ...options } };
};

function ok(d: GraphDef, data: Dataset) {
  const r = computeChart(d, data, t);
  if (!r.ok) throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r;
}

const G = [1, 1, 1, 1, 2, 2, 2, 2];
const Y = [2, 4, 3, 5, 10, 12, 11, 15];
const Z = [1, 2, 3, 4, 5, 6, 7, 8];
const small = () => ds([['g', G], ['y', Y], ['z', Z]]);

describe('high-low and dual axis', () => {
  it('aggregates high, low and close per category', () => {
    const r = ok(def('highlow', 'hlc', { x: ['g'], high: ['y'], low: ['z'], close: ['y'] }, { func: 'max' }), small());
    expect(r.chart.type).toBe('highlow');
    expect(r.chart.mode).toBe('hlc');
    expect(r.chart.categories).toEqual(['1', '2']);
    expect(r.chart.high).toEqual([5, 15]);
    expect(r.chart.low).toEqual([4, 8]);
    expect(r.chart.close).toEqual([5, 15]);
    expect(ok(def('highlow', 'range', { x: ['g'], high: ['y'], low: ['z'] }, { func: 'min' }), small()).chart.close).toBeNull();
    expect(ok(def('highlow', 'diff', { x: ['g'], high: ['y'], low: ['z'] }), small()).chart.mode).toBe('diff');
  });
  it('dual axis takes bar or line per side from the variant', () => {
    const r = ok(def('dualaxis', 'barline', { x: ['g'], left: ['y'], right: ['z'] }), small());
    const left = r.chart.left as { kind: string; values: number[] };
    const right = r.chart.right as { kind: string; values: number[] };
    expect([left.kind, right.kind]).toEqual(['bar', 'line']);
    expect(left.values).toEqual([3.5, 12]);
    expect(right.values).toEqual([2.5, 6.5]);
    const b = ok(def('dualaxis', 'linebar', { x: ['g'], left: ['y'], right: ['z'] }), small());
    expect([(b.chart.left as { kind: string }).kind, (b.chart.right as { kind: string }).kind]).toEqual(['line', 'bar']);
  });
});

describe('probability plots', () => {
  const d = ds([['v', [5, 1, 4, 2, 3, 9, 7, 8, 6, 10]]]);
  it('Blom positions and normal quantiles', () => {
    expect(blom(0, 10)).toBeCloseTo(0.625 / 10.25, 12);
    expect(blom(9, 10)).toBeCloseTo(9.625 / 10.25, 12);
    expect(standardQuantile('normal', 0.5)).toBeCloseTo(0, 8);
    expect(standardQuantile('exponential', 1 - Math.exp(-2))).toBeCloseTo(2, 8);
    expect(standardQuantile('uniform', 0.3)).toBe(0.3);
  });
  it('Q-Q points are sorted and the reference passes through the quartiles', () => {
    const r = ok(def('qq', 'qq', { value: ['v'] }), d);
    const pts = r.chart.points as [number, number][];
    expect(pts.map((p) => p[1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pts[0][0]).toBeLessThan(pts[9][0]);
    const [[x0, y0], [x1, y1]] = r.chart.reference as [[number, number], [number, number]];
    const slope = (y1 - y0) / (x1 - x0);
    const q1 = standardQuantile('normal', 0.25);
    expect(y0 + slope * (q1 - x0)).toBeCloseTo(3.25, 8); // first quartile of 1..10
    expect(y0 + slope * (-q1 - x0)).toBeCloseTo(7.75, 8);
  });
  it('P-P: reference is the diagonal, values are proportions', () => {
    const r = ok(def('pp', 'pp', { value: ['v'] }, { dist: 'uniform' }), d);
    expect(r.chart.reference).toEqual([[0, 0], [1, 1]]);
    const pts = r.chart.points as [number, number][];
    expect(pts[0][0]).toBe(0);
    expect(pts[9][0]).toBe(1);
    expect(pts.every((p) => p[1] > 0 && p[1] < 1)).toBe(true);
  });
  it('lognormal drops non-positive values and plots on the log scale', () => {
    const r = ok(def('qq', 'qq', { value: ['v'] }, { dist: 'lognormal' }), ds([['v', [Math.E, 1, 0, -2, Math.E ** 2]]]));
    expect((r.chart.points as [number, number][]).map((p) => p[1])).toEqual([0, 1, 2]);
    expect(r.notes.some((n) => n.includes('graphstudio.note.dropped'))).toBe(true);
  });
  it('notes that weights are not used', () => {
    const w = ds([['v', [1, 2, 3, 4]], ['w', [1, 1, 2, 1]]], { weight: 'w' });
    expect(ok(def('qq', 'qq', { value: ['v'] }), w).notes.some((n) => n.includes('weightIgnored'))).toBe(true);
  });
});

describe('sequence', () => {
  it('plots against the case number or a sorted numeric variable, with transforms', () => {
    const d = ds([['y', [3, 5, 4, 8]], ['x', [40, 10, 30, 20]]]);
    expect(ok(def('sequence', 'sequence', { value: ['y'] }), d).chart.x).toEqual([1, 2, 3, 4]);
    const r = ok(def('sequence', 'sequence', { value: ['y'], x: ['x'] }), d);
    expect(r.chart.x).toEqual([10, 20, 30, 40]);
    expect((r.chart.series as { values: number[] }[])[0].values).toEqual([5, 8, 4, 3]);
    const diff = ok(def('sequence', 'sequence', { value: ['y'] }, { transform: 'diff' }), d);
    expect((diff.chart.series as { values: (number | null)[] }[])[0].values).toEqual([null, 2, -1, 4]);
  });
});

describe('control charts', () => {
  const vals = [10, 10.2, 9.8, 10.1, 9.9, 10, 15, 10.1];
  it('individuals: limits are centre +- 3 * MRbar / d2 and out of limit points are flagged', () => {
    const r = ok(def('control', 'individuals', { value: ['v'] }), ds([['v', vals]]));
    const mr = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
    const mrBar = mr.reduce((s, x) => s + x, 0) / mr.length;
    const center = vals.reduce((s, x) => s + x, 0) / vals.length;
    expect(r.chart.center).toBeCloseTo(center, 10);
    expect((r.chart.ucl as number[])[0]).toBeCloseTo(center + (3 * mrBar) / 1.128, 10);
    expect((r.chart.lcl as number[])[0]).toBeCloseTo(center - (3 * mrBar) / 1.128, 10);
    expect(r.chart.flags).toEqual([false, false, false, false, false, false, true, false]);
  });
  it('moving range: UCL = D4 * MRbar (3.267), LCL = 0', () => {
    const r = ok(def('control', 'movingrange', { value: ['v'] }), ds([['v', vals]]));
    const mr = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
    const mrBar = mr.reduce((s, x) => s + x, 0) / mr.length;
    expect((r.chart.values as (number | null)[])[0]).toBeNull();
    expect(r.chart.center).toBeCloseTo(mrBar, 10);
    expect((r.chart.ucl as number[])[0] / mrBar).toBeCloseTo(3.267, 2);
    expect((r.chart.lcl as number[])[0]).toBe(0);
  });
  it('I-MR is a pair of panels without its own panel slot', () => {
    const d = def('control', 'imr', { value: ['v'] });
    expect(slotsOf(d).some((s) => s.id === 'panel')).toBe(false);
    const r = ok(d, ds([['v', vals]]));
    expect(r.chart.type).toBe('panels');
    expect((r.chart.panels as unknown[]).length).toBe(2);
    expect(r.chart.sharedAxes).toBe(false);
  });
  it('X-bar: grand mean and per subgroup limits with c4 (sd method) or d2 (range method)', () => {
    const sub = [1, 1, 1, 2, 2, 2, 3, 3, 3];
    const v = [10, 11, 12, 12, 13, 14, 11, 12, 13];
    const d = ds([['s', sub], ['v', v]]);
    const sd = r2(ok(def('control', 'xbar', { value: ['v'], subgroup: ['s'] }), d).chart);
    expect(sd.values).toEqual([11, 13, 12]);
    expect(sd.center).toBeCloseTo(12, 10);
    // every subgroup has sd 1 and n = 3
    expect(sd.ucl[0]).toBeCloseTo(12 + (3 * (1 / c4(3))) / Math.sqrt(3), 10);
    const rg = r2(ok(def('control', 'xbar', { value: ['v'], subgroup: ['s'] }, { sigma: 'range' }), d).chart);
    expect(rg.ucl[0]).toBeCloseTo(12 + (3 * (2 / D2[3])) / Math.sqrt(3), 10);
    expect(sd.flags).toEqual([false, false, false]);
    expect(c4(2)).toBeCloseTo(0.7979, 4);
    expect(c4(5)).toBeCloseTo(0.94, 3);
  });
});
const r2 = (c: Record<string, unknown>) => c as { values: number[]; center: number; ucl: number[]; lcl: number[]; flags: boolean[] };

describe('density and violin', () => {
  const rnd = (n: number) => Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453)).map((u) => u * 10);
  it('Silverman bandwidth and a density that integrates to one', () => {
    const s = rnd(200).sort((a, b) => a - b);
    const h = silverman(s);
    expect(h).toBeGreaterThan(0);
    const pts = kde(s, h, s[0] - 4 * h, s[199] + 4 * h, 400);
    const dx = pts[1][0] - pts[0][0];
    expect(pts.reduce((a, p) => a + p[1] * dx, 0)).toBeCloseTo(1, 2);
    expect(silverman([3, 3, 3])).toBe(0);
  });
  it('violin: 64 points clipped to the data range, quartiles', () => {
    const r = ok(def('violin', 'simple', { value: ['y'], x: ['g'] }), small());
    const vs = r.chart.violins as { label: string; points: [number, number][]; median: number; q1: number; q3: number }[];
    expect(vs.map((x) => x.label)).toEqual(['1', '2']);
    expect(vs[0].points).toHaveLength(64);
    expect(vs[0].points[0][0]).toBe(2);
    expect(vs[0].points[63][0]).toBe(5);
    expect(vs[0].median).toBe(3.5);
  });
  it('density per group with optional fill; constant groups are skipped with a note', () => {
    const d = ds([['g', [1, 1, 1, 2, 2, 2]], ['y', [1, 2, 3, 5, 5, 5]]]);
    const r = ok(def('density', 'simple', { value: ['y'], group: ['g'] }, { fill: false }), d);
    expect((r.chart.curves as unknown[]).length).toBe(1);
    expect(r.chart.fill).toBe(false);
    expect(r.notes.some((n) => n.includes('groupsSkipped'))).toBe(true);
  });
});

describe('panels', () => {
  it('builds one chart per level of the panel variable with shared axes', () => {
    const d = def('bar', 'simple', { x: ['z'], value: ['y'], panel: ['g'] }, { func: 'max' });
    const r = ok(d, ds([['g', G], ['y', Y], ['z', [1, 2, 1, 2, 1, 2, 1, 2]]]));
    expect(r.chart.type).toBe('panels');
    const panels = r.chart.panels as { title: string; chart: { type: string; style: { yMin: number; yMax: number } } }[];
    expect(panels).toHaveLength(2);
    expect(panels[0].chart.type).toBe('bar');
    expect(panels[0].chart.style).toEqual(panels[1].chart.style);
    expect(panels[0].chart.style.yMin).toBe(0);
    expect(panels[0].chart.style.yMax).toBeGreaterThanOrEqual(15);
    expect(r.chart.sharedAxes).toBe(true);
    expect(r.chart.columns).toBe(2);
  });
  it('can leave the axes free and sets the columns', () => {
    const d = def('histogram', 'simple', { value: ['y'], panel: ['g'] }, { sharedAxes: false, panelCols: 1 });
    const r = ok(d, small());
    const panels = r.chart.panels as { chart: { style?: unknown; bins: number[][] } }[];
    expect(panels[0].chart.style).toBeUndefined();
    expect(r.chart.columns).toBe(1);
    // the bins come from all the data so the panels line up
    expect(panels[0].chart.bins.map((b) => b[0])).toEqual(panels[1].chart.bins.map((b) => b[0]));
  });
  it('refuses more than 12 levels and offers the slot for every kind but the matrix', () => {
    const many = ds([['g', Array.from({ length: 30 }, (_, i) => i % 13)], ['y', Array.from({ length: 30 }, (_, i) => i)]]);
    expect(computeChart(def('histogram', 'simple', { value: ['y'], panel: ['g'] }), many, t)).toEqual({ ok: false, reason: 'panels', max: 12 });
    const panel = slotsOf(defaultDef('bar')).find((s) => s.id === 'panel')!;
    expect(rejection(panel, num('g'), 13)?.key).toBe('graphstudio.reject.manyLevels');
    expect(rejection(panel, num('g'), 12)).toBeNull();
    expect(slotsOf(defaultDef('scattermatrix')).some((s) => s.id === 'panel')).toBe(false);
    for (const k of ['bar', 'qq', 'violin', 'sequence', 'scatter'] as const) expect(slotsOf(defaultDef(k)).some((s) => s.id === 'panel')).toBe(true);
  });
  it('panel options only show with a panel variable; switching the variant keeps the panel', () => {
    const d = defaultDef('bar');
    const shown = (x: GraphDef) => optionsOf(x).filter((o) => !o.when || o.when(x)).map((o) => o.id);
    expect(shown(d)).not.toContain('sharedAxes');
    const p = { ...d, bind: { panel: ['g'] } };
    expect(shown(p)).toContain('sharedAxes');
    expect(withVariant(p, 'stacked').bind.panel).toEqual(['g']);
  });
  it('studioChart merges the user style into each panel without touching the spec', () => {
    const d = def('bar', 'simple', { x: ['z'], panel: ['g'] });
    const r = ok(d, ds([['g', G], ['z', [1, 2, 1, 2, 1, 2, 1, 2]]]));
    const before = JSON.stringify(r.chart);
    const out = studioChart(r.chart, d, { refLines: [{ axis: 'y', value: 2 }], palette: ['#ff0000'], title: 'T' });
    expect(JSON.stringify(r.chart)).toBe(before);
    const panels = out.panels as { chart: { style: Record<string, unknown> } }[];
    expect(panels[0].chart.style.refLines).toEqual([{ axis: 'y', value: 2 }]);
    expect(panels[1].chart.style.palette).toEqual(['#ff0000']);
    expect(panels[0].chart.style.title).toBeUndefined();
    expect(seriesNames(out)).toEqual(seriesNames((out.panels as { chart: unknown }[])[0].chart));
  });
  it('rounds shared ranges outwards', () => {
    expect(niceRange([0.3, 14.2], true)).toEqual([0, 15]);
    expect(niceRange([3.1, 7.7], false)).toEqual([3, 8]);
  });
});

describe('quick reference lines', () => {
  it('weighted mean, median and SD of the value variable on the right axis', () => {
    const q = quickStats(def('boxplot', 'simple', { value: ['y'] }), small())!;
    expect(q.axis).toBe('y');
    expect(q.mean).toBeCloseTo(7.75, 10);
    expect(q.median).toBe(7.5);
    expect(q.sd).toBeCloseTo(4.833, 2);
    expect(quickStats(def('histogram', 'simple', { value: ['y'] }), small())!.axis).toBe('x');
    expect(quickStats(def('bar', 'horizontal', { x: ['g'], value: ['y'] }, { func: 'mean' }), small())!.axis).toBe('x');
    expect(quickStats(def('pie', 'simple', { x: ['g'] }), small())).toBeNull();
  });
  it('uses the plotted counts when a bar chart has no variable', () => {
    const d = def('bar', 'simple', { x: ['g'] });
    const r = ok(d, small());
    expect(quickStats(d, small(), r.chart)!.mean).toBe(4);
  });
  it('lines are plain, labelled and editable', () => {
    const q = { axis: 'y' as const, n: 8, mean: 3.4, median: 3, sd: 1 };
    const label = (k: string, v: string) => `${k} ${v}`;
    expect(quickLines(q, 'mean', label, '.')).toEqual([{ axis: 'y', value: 3.4, label: 'mean 3.4', dash: false }]);
    expect(quickLines(q, 'sd2', label, ',').map((l) => [l.value, l.label])).toEqual([[5.4, 'plus2 5,4'], [1.4, 'minus2 1,4']]);
    expect(labelNumber(1234.567, '.')).toBe('1235');
  });
});

describe('many categories', () => {
  const big = (n: number) => ds([['c', Array.from({ length: n }, (_, i) => i)], ['y', Array.from({ length: n }, () => 1)]]);
  it('accepts a scale variable as a category at any count', () => {
    expect(rejection(slotsOf(defaultDef('bar'))[0], num('age'), 5000)).toBeNull();
  });
  it('warns above 50 categories but draws all of them', () => {
    const r = ok(def('bar', 'simple', { x: ['c'] }), big(80));
    expect((r.chart.bars as unknown[]).length).toBe(80);
    expect(r.notes.some((n) => n.includes('manyCategories'))).toBe(true);
  });
  it('is quiet up to 50', () => {
    expect(ok(def('bar', 'simple', { x: ['c'] }), big(50)).notes).toEqual([]);
  });
  it('caps at the ceiling and says how many were left out', () => {
    const r = ok(def('bar', 'simple', { x: ['c'] }), big(CATEGORY_CAP + 37));
    expect((r.chart.bars as unknown[]).length).toBe(CATEGORY_CAP);
    expect(r.notes.some((n) => n.includes('categoriesCut') && n.includes('"left":37'))).toBe(true);
    expect(r.info.used).toBe(CATEGORY_CAP);
  });
});

describe('scatter fit band', () => {
  it('passes fitCi only with a fit line', () => {
    const d = ds([['x', Z], ['y', Y]]);
    expect(ok(def('scatter', 'simple', { x: ['x'], y: ['y'] }, { fit: 'linear', fitCi: true }), d).chart.fitCi).toBe(true);
    expect(ok(def('scatter', 'simple', { x: ['x'], y: ['y'] }, { fit: 'none', fitCi: true }), d).chart.fitCi).toBe(false);
  });
});
