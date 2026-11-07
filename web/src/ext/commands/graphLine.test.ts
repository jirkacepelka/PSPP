/*
 * GRAPH /LINE: summaries per category checked against hand / numpy values
 * (scipy.stats.t.ppf(0.975, 2) = 4.302653 for the CI of a cell with 3 cases).
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, OutputItem } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { errorsOf, flatItems, runExt } from '../testing';
import { isExtCommand } from '../runner';
import cs from '../../i18n/fragments/ext-graphline.cs.json';
import en from '../../i18n/fragments/ext-graphline.en.json';

type Line = { type: string; categories: string[]; ylabel: string; legendTitle: string; errorLabel: string; series: { name: string; values: (number | null)[]; lo?: (number | null)[]; hi?: (number | null)[] }[] };
const charts = (items: OutputItem[]) => flatItems(items).filter((x) => x.kind === 'chart').map((x) => (x as { chart: Line }).chart);

function ds(extra: Partial<Dataset> = {}): Dataset {
  const x = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3];
  const g = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  const y = [4, 6, 5, 7, 8, 9, 3, 2, 4, null];
  const vx = { ...makeVariable('x'), valueLabels: [{ value: 1, label: 'Low' }, { value: 2, label: 'Mid' }, { value: 3, label: 'High' }] };
  return { name: 't', variables: [vx, makeVariable('g'), makeVariable('y'), makeVariable('w')], columns: [x, g, y, [1, 1, 1, 1, 1, 1, 1, 1, 1, 2]], ...extra };
}

describe('GRAPH /LINE', () => {
  it('is claimed only with /LINE', () => {
    expect(isExtCommand('GRAPH', 'GRAPH /LINE(SIMPLE)=MEAN(y) BY x.')).toBe(true);
    expect(isExtCommand('GRAPH', 'GRAPH /BAR=COUNT BY x.')).toBe(false);
  });

  it('simple mean with value labels and a 95% CI', () => {
    const out = runExt('GRAPH /LINE(SIMPLE)=MEAN(y) BY x /INTERVAL CI(95).', ds());
    expect(errorsOf(out)).toEqual([]);
    const [c] = charts(out);
    expect(c.type).toBe('line');
    expect(c.categories).toEqual(['Low', 'Mid', 'High']);
    expect(c.series[0].values).toEqual([5, 8, 3]);
    // x = 1: y = 4 6 5, sd 1, se 1/√3, t(.975, 2) = 4.302653
    expect(c.series[0].hi![0]).toBeCloseTo(5 + 4.302653 / Math.sqrt(3), 5);
    expect(c.errorLabel).toBe('95% CI');
  });

  it('multiple lines, counts, percentages and cumulative counts (listwise; weights)', () => {
    const m = charts(runExt('GRAPH /LINE(MULTIPLE)=COUNT BY x BY g.', ds()))[0];
    expect(m.series.map((s) => s.name)).toEqual(['1', '2']);
    expect(m.series[0].values).toEqual([2, 1, 2]);
    expect(m.series[1].values).toEqual([1, 2, 2]);
    expect(m.legendTitle).toBe('g');
    const p = charts(runExt('GRAPH /LINE=PCT BY x.', ds()))[0];
    expect(p.series[0].values.map((v) => +v!.toFixed(4))).toEqual([30, 30, 40]);
    const cu = charts(runExt('GRAPH /LINE=CUFREQ BY x.', ds({ weight: 'w' })))[0];
    expect(cu.series[0].values).toEqual([3, 6, 11]);
    // the missing y of the last case drops it from MEAN(y) but not from COUNT
    const med = charts(runExt('GRAPH /LINE=MEDIAN(y) BY x.', ds()))[0];
    expect(med.series[0].values).toEqual([5, 8, 3]);
  });

  it('split file: one chart per group; errors', () => {
    const split = ds({ split: ['g'] });
    split.columns = split.columns.map((c) => [0, 2, 4, 6, 8, 1, 3, 5, 7, 9].map((i) => c[i]));
    expect(charts(runExt('GRAPH /LINE=MEAN(y) BY x.', split))).toHaveLength(2);
    expect(errorsOf(runExt('GRAPH /LINE=MEAN BY x.', ds()))[0]).toMatch(/needs a variable/);
    expect(errorsOf(runExt('GRAPH /LINE(DROP)=COUNT BY x.', ds()))[0]).toMatch(/SIMPLE or MULTIPLE/);
    expect(errorsOf(runExt('GRAPH /LINE=COUNT BY nope.', ds()))[0]).toMatch(/not a variable/);
  });

  it('i18n fragments have identical keys', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, p + k + '.') : [p + k]));
    expect(keys(cs).sort()).toEqual(keys(en).sort());
  });
});
