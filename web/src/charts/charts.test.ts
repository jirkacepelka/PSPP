/* Parsing, style layer and studio math of the chart module.  SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json';
import { parseChart } from './types';
import { applyDomain, parseStyle } from './styleSpec';
import { cumulativePercent, dotRadius, fitCurve, loessAt, polyFit, rampColor, rampPercent, stackSegments } from './studioMath';
import { chartStrings } from './strings';
import { niceTicks } from './scale';

const fx = fixtures as Record<string, unknown>;

describe('parseChart: existing types stay unchanged without style', () => {
  it('parses every engine fixture without a style', () => {
    for (const k of ['boxplot', 'histogram', 'np', 'scatter', 'bar', 'pie', 'bar-grouped', 'scree']) {
      const spec = parseChart(fx[k]);
      expect(spec.type).not.toBe('unknown');
      expect(spec.style).toBeUndefined();
    }
  });
  it('ignores chart.studio', () => {
    const spec = parseChart({ type: 'pie', slices: [{ label: 'a', value: 1 }], studio: { v: 1, kind: 'pie', bind: {}, options: {} } });
    expect(spec.type).toBe('pie');
    expect(Object.keys(spec)).not.toContain('studio');
  });
});

describe('style parsing', () => {
  it('reads style from the bare chart and from the item wrapper', () => {
    const chart = { type: 'pie', slices: [], style: { title: 'T', grid: false } };
    expect(parseChart(chart).style).toEqual({ title: 'T', grid: false });
    expect(parseChart({ kind: 'chart', title: 'x', chart: { type: 'pie', slices: [] }, style: { subtitle: 'S' } }).style).toEqual({ subtitle: 'S' });
    expect(parseChart({ kind: 'chart', chart }).style?.title).toBe('T');
  });
  it('is defensive', () => {
    const s = parseStyle({
      title: 5,
      legend: 'weird',
      palette: ['#fff', 'url(x)', null, 3],
      xMin: 'a',
      yMax: null,
      refLines: [{ axis: 'q', value: 1 }, { axis: 'x', value: 2, label: ' hi ', color: 'red; x: y' }, { axis: 'y', value: NaN }, { axis: 'y', value: 3, dash: false }],
      annotations: [{ x: 1, y: 2, text: 'ok' }, { x: 1, y: 2, text: '' }, 7],
      fontScale: 9,
    })!;
    expect(s.title).toBeUndefined();
    expect(s.legend).toBeUndefined();
    expect(s.palette).toEqual(['#fff', null, null, null]);
    expect(s.xMin).toBeUndefined();
    expect(s.yMax).toBeNull();
    expect(s.refLines).toEqual([{ axis: 'x', value: 2, label: 'hi' }, { axis: 'y', value: 3, dash: false }]);
    expect(s.annotations).toEqual([{ x: 1, y: 2, text: 'ok' }]);
    expect(s.fontScale).toBe(2);
    expect(parseStyle('nope')).toBeUndefined();
  });
  it('parses the styled fixtures', () => {
    const h = parseChart(fx['styled-histogram']);
    expect(h.type).toBe('histogram');
    expect(h.style?.refLines).toHaveLength(2);
    expect(h.style?.palette?.[1]).toBeNull();
  });
  it('applyDomain overrides only when asked', () => {
    const t = niceTicks(0, 97, 5);
    expect(applyDomain(t, undefined, undefined, 5)).toBe(t);
    expect(applyDomain(t, null, null, 5)).toBe(t);
    expect(applyDomain(t, 10, 50, 5).domain).toEqual([10, 50]);
    expect(applyDomain(t, 10, null, 5).domain[0]).toBe(10);
    expect(applyDomain(t, 50, 10, 5)).toBe(t);
  });
});

describe('extended specs', () => {
  it('bar: stack, horizontal, xlabel, err', () => {
    const b = parseChart(fx['bar-stacked']);
    expect(b.type === 'bar' && b.stack).toBe('stack');
    const e = parseChart(fx['bar-err']);
    if (e.type !== 'bar') throw new Error('type');
    expect(e.err).toHaveLength(e.bars.length);
    expect(e.err![0]!.hi).toBeGreaterThan(e.err![0]!.lo);
    const h = parseChart(fx['bar-horizontal']);
    expect(h.type === 'bar' && h.horizontal).toBe(true);
    expect(h.type === 'bar' && h.xlabel).toBe('City');
    const plain = parseChart({ type: 'bar', bars: [], stack: 'bogus', err: 3 });
    expect(plain.type === 'bar' && plain.stack).toBeUndefined();
    expect(plain.type === 'bar' && plain.err).toBeUndefined();
  });
  it('histogram: series and mode', () => {
    const h = parseChart(fx['histogram-polygon']);
    if (h.type !== 'histogram') throw new Error('type');
    expect(h.mode).toBe('polygon');
    expect(h.series).toHaveLength(2);
    expect(h.series![0].counts).toHaveLength(h.bins.length);
  });
  it('line: connect false', () => {
    const l = parseChart(fx['line-errorbar']);
    expect(l.type === 'line' && l.connect).toBe(false);
    expect(parseChart(fx['bar']).type).toBe('bar');
  });
  it('scatter: fit options', () => {
    const s = parseChart(fx['scatter-fit-groups']);
    if (s.type !== 'scatter') throw new Error('type');
    expect([s.fit, s.fitByGroup, s.showR2]).toEqual(['loess', true, true]);
    const none = parseChart({ type: 'scatter', points: [], fit: 'spline' });
    expect(none.type === 'scatter' && none.fit).toBeUndefined();
  });
});

describe('new chart types parse', () => {
  it.each([
    ['area', 'area'],
    ['area-stacked100', 'area'],
    ['dot', 'dot'],
    ['dot-grouped', 'dot'],
    ['pareto', 'pareto'],
    ['matrix', 'matrix'],
    ['heatmap', 'heatmap'],
    ['pyramid', 'pyramid'],
  ])('%s', (key, type) => {
    expect(parseChart(fx[key]).type).toBe(type);
  });
  it('area pads short series and keeps stack mode', () => {
    const a = parseChart({ type: 'area', categories: ['a', 'b', 'c'], stack: 'stack100', series: [{ name: 's', values: [1, null] }] });
    if (a.type !== 'area') throw new Error('type');
    expect(a.series[0].values).toEqual([1, null, null]);
    expect(a.stack).toBe('stack100');
  });
  it('matrix caps variables at six and pads rows', () => {
    const m = parseChart({ type: 'matrix', vars: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], rows: [[1, 2], [3]], groups: ['x', null], byvar: 'g' });
    if (m.type !== 'matrix') throw new Error('type');
    expect(m.vars).toHaveLength(6);
    expect(m.rows[1]).toEqual([3, null, null, null, null, null]);
    expect(m.groups).toEqual(['x', null]);
  });
  it('heatmap normalizes counts to the edge grid', () => {
    const h = parseChart({ type: 'heatmap', xEdges: [0, 1, 2], yEdges: [0, 1], counts: [[1, 2, 3], [4]] });
    if (h.type !== 'heatmap') throw new Error('type');
    expect(h.counts).toEqual([[1, 2]]);
  });
  it('pareto computes a missing total; pyramid drops broken bins; dot drops bad bins', () => {
    const p = parseChart({ type: 'pareto', bars: [{ label: 'a', count: 3 }, { label: 'b', count: 1 }] });
    expect(p.type === 'pareto' && p.total).toBe(4);
    const py = parseChart({ type: 'pyramid', bins: [[0, 10, 5, 6], ['x', 1, 2, 3], [10, 20, 1]] });
    expect(py.type === 'pyramid' && py.bins).toEqual([[0, 10, 5, 6], [10, 20, 1, 0]]);
    const d = parseChart({ type: 'dot', bins: [{ x: 1, count: 2.7 }, { x: 'a', count: 1 }, { x: 2, count: -1 }] });
    expect(d.type === 'dot' && d.bins).toEqual([{ x: 1, count: 2, group: null }]);
  });
});

describe('fit lines', () => {
  const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [i, 3 + 2 * i]);
  it('linear fit recovers an exact line with r2 = 1', () => {
    const f = polyFit(line, 1)!;
    expect(f(10)).toBeCloseTo(23, 8);
    const r = fitCurve(line, 'linear', 0, 19)!;
    expect(r.r2).toBeCloseTo(1, 10);
    expect(r.curve[0][0]).toBe(0);
    expect(r.curve[r.curve.length - 1][0]).toBe(19);
  });
  it('quadratic and cubic recover exact polynomials', () => {
    const q: [number, number][] = Array.from({ length: 15 }, (_, i) => [i - 7, 1 - 2 * (i - 7) + 0.5 * (i - 7) ** 2]);
    expect(polyFit(q, 2)!(3)).toBeCloseTo(1 - 6 + 4.5, 8);
    const cu: [number, number][] = Array.from({ length: 15 }, (_, i) => [i - 7, (i - 7) ** 3 - (i - 7)]);
    expect(polyFit(cu, 3)!(2)).toBeCloseTo(6, 6);
    // a line is not a good quadratic only in noise terms: r2 stays 1
    expect(fitCurve(line, 'quadratic', 0, 19)!.r2).toBeCloseTo(1, 8);
  });
  it('r2 of a noisy linear relation is between 0 and 1', () => {
    const pts: [number, number][] = [[0, 1], [1, 3], [2, 2], [3, 5], [4, 4], [5, 7]];
    const r2 = fitCurve(pts, 'linear', 0, 5)!.r2!;
    expect(r2).toBeGreaterThan(0.5);
    expect(r2).toBeLessThan(1);
  });
  it('returns null when it cannot fit', () => {
    expect(polyFit([[1, 1], [1, 2], [1, 3]], 1)).toBeNull();
    expect(fitCurve([[1, 1]], 'linear', 0, 1)).toBeNull();
    expect(fitCurve([[0, 0], [1, 1]], 'cubic', 0, 1)).toBeNull();
  });
  it('loess follows a smooth curve and is exact on a line', () => {
    expect(loessAt(line, 7.5, 0.6)!).toBeCloseTo(18, 6);
    const sine: [number, number][] = Array.from({ length: 80 }, (_, i) => [i / 8, Math.sin(i / 8)]);
    expect(loessAt(sine, 5, 0.12)!).toBeCloseTo(Math.sin(5), 1);
    expect(loessAt([[0, 0], [1, 1]], 0.5)).toBeNull();
  });
});

describe('stacking and helpers', () => {
  it('stacks positives up and negatives down', () => {
    const seg = stackSegments([[1, 2], [3, -4], [5, null]], 'stack');
    expect(seg.filter((s) => s.cat === 0).map((s) => [s.series, s.v0, s.v1])).toEqual([[0, 0, 1], [1, 1, 4], [2, 4, 9]]);
    expect(seg.filter((s) => s.cat === 1).map((s) => [s.series, s.v0, s.v1])).toEqual([[0, 0, 2], [1, 0, -4]]);
  });
  it('stack100 scales each category to 100', () => {
    const seg = stackSegments([[1, 0], [3, 0]], 'stack100');
    expect(seg.filter((s) => s.cat === 0).map((s) => s.v1)).toEqual([25, 100]);
    expect(seg.filter((s) => s.cat === 1).every((s) => s.v1 === 0)).toBe(true);
  });
  it('cumulative percent', () => {
    expect(cumulativePercent([50, 30, 20], 100)).toEqual([50, 80, 100]);
    expect(cumulativePercent([1, 1], 0)).toEqual([50, 100]);
    expect(cumulativePercent([5, 5], 8).at(-1)).toBe(100);
  });
  it('dot radius fits both dimensions', () => {
    expect(dotRadius(10, 40, 200)).toBeLessThanOrEqual(9);
    expect(dotRadius(100, 40, 200)).toBeCloseTo(1.5, 5);
    expect(dotRadius(2, 10, 500)).toBeCloseTo(4.5, 5);
  });
  it('colour ramp is monotone and empty cells are transparent', () => {
    expect(rampColor(0, 10)).toBe('transparent');
    expect(rampPercent(1, 100)).toBeLessThan(rampPercent(50, 100));
    expect(rampPercent(100, 100)).toBe(100);
    expect(rampColor(5, 10)).toContain('color-mix');
  });
});

describe('strings', () => {
  it('cs and en define the same keys', () => {
    expect(Object.keys(chartStrings.cs).sort()).toEqual(Object.keys(chartStrings.en).sort());
    for (const k of ['areaChart', 'dotPlot', 'paretoChart', 'scatterMatrix', 'heatmap', 'pyramid', 'cumulativePercent']) {
      expect((chartStrings.cs as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
