/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { makeVariable } from '../../lib/variables';
import { computeStats, histogram, isCategorical, suggestMeasure } from './stats';

describe('inspector statistics', () => {
  it('computes descriptive statistics, skipping missing values', () => {
    const v = makeVariable('x', { missing: { values: [99] } });
    const s = computeStats(v, [1, 2, 3, 4, null, 99]);
    expect(s.n).toBe(6);
    expect(s.valid).toBe(4);
    expect(s.sysmis).toBe(1);
    expect(s.userMissing).toBe(1);
    expect(s.mean).toBe(2.5);
    expect(s.sd).toBeCloseTo(1.29099, 4);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.median).toBe(2.5);
    expect(s.integers).toBe(true);
    expect(s.distinct).toBe(5);
  });
  it('counts frequencies with labels, most frequent first', () => {
    const v = makeVariable('g', { measure: 'nominal', valueLabels: [{ value: 1, label: 'F' }, { value: 2, label: 'M' }] });
    const s = computeStats(v, [1, 2, 2, 2, 1, 3], { maxFreq: 2 });
    expect(s.freqs).toEqual([
      { value: 2, count: 3, missing: false, label: 'M' },
      { value: 1, count: 2, missing: false, label: 'F' },
    ]);
    expect(s.otherDistinct).toBe(1);
    expect(s.otherCount).toBe(1);
    expect(isCategorical(v, s)).toBe(true);
  });
  it('handles strings and empty columns', () => {
    const v = makeVariable('s', { type: 'string', width: 4 });
    const s = computeStats(v, ['a ', 'a', '', 'b']);
    expect(s.sysmis).toBe(1);
    expect(s.freqs[0]).toMatchObject({ value: 'a', count: 2 });
    expect(s.mean).toBeNull();
    const e = computeStats(makeVariable('e'), []);
    expect(e.valid).toBe(0);
    expect(e.hist).toEqual([]);
  });
  it('builds nice histogram bins covering all values', () => {
    const bins = histogram(Float64Array.from([0, 1, 2, 3, 9.5, 10]), 5);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(6);
    expect(bins[0].x0).toBeLessThanOrEqual(0);
    expect(bins[bins.length - 1].x1).toBeGreaterThanOrEqual(10);
    expect(histogram(Float64Array.from([5, 5]))).toEqual([{ x0: 4.5, x1: 5.5, count: 2 }]);
  });
  it('suggests a measurement level only in clear cases', () => {
    const v = makeVariable('job');
    expect(suggestMeasure(v, { distinct: 2, integers: true, valid: 100 })).toEqual({ measure: 'nominal', reason: 'twoValues' });
    expect(suggestMeasure(v, { distinct: 80, integers: false, valid: 100 })).toBeNull();
    const n = makeVariable('w', { measure: 'nominal' });
    expect(suggestMeasure(n, { distinct: 90, integers: false, valid: 100 })).toEqual({ measure: 'scale', reason: 'manyValues' });
  });
});
