/* Phase 4 chart types: parsing and pure math.  SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json';
import { parseChart } from './types';
import { chartStrings } from './strings';
import {
  boxStats,
  bubbleRadius,
  forestItems,
  histCounts,
  interpolate,
  kdeCurve,
  logTicks,
  mosaicLayout,
  pearsonResiduals,
  quantileSorted,
  radarFraction,
  radarPath,
  radarPoint,
  radarRange,
  residualLevel,
  ridgeOffsets,
  sizeReferences,
  squarify,
  tileLabelRoom,
  treemapLayout,
  waterfallBars,
  weightSide,
} from './phase4Math';

const fx = fixtures as Record<string, unknown>;
const area = (r: { w: number; h: number }) => r.w * r.h;
const inside = (r: { x: number; y: number; w: number; h: number }, o: { x: number; y: number; w: number; h: number }) => r.x >= o.x - 1e-9 && r.y >= o.y - 1e-9 && r.x + r.w <= o.x + o.w + 1e-9 && r.y + r.h <= o.y + o.h + 1e-9;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

describe('phase 4 fixtures', () => {
  it('parse as their own type with a title', () => {
    const types: Record<string, string> = {
      bubble: 'bubble', 'bubble-many': 'bubble', mosaic: 'mosaic', 'mosaic-shaded': 'mosaic', 'mosaic-3x4': 'mosaic', radar: 'radar', 'radar-auto': 'radar', waterfall: 'waterfall', 'waterfall-negative': 'waterfall',
      forest: 'forest', 'forest-linear': 'forest', treemap: 'treemap', 'treemap-groups': 'treemap', 'scatter-marginals-histogram': 'scatter', 'scatter-marginals-density': 'scatter', 'scatter-marginals-box': 'scatter',
      'density-ridge': 'density', 'density-ridge-lines': 'density', 'bar-lollipop': 'bar', 'bar-lollipop-horizontal': 'bar', 'bar-lollipop-grouped-err': 'bar', 'sequence-forecast': 'sequence',
    };
    for (const [k, type] of Object.entries(types)) {
      const s = parseChart(fx[k]);
      expect(s.type, k).toBe(type);
      expect(s.title, k).not.toBe('');
    }
  });
  it('keeps the extension fields', () => {
    expect((parseChart(fx['scatter-marginals-box']) as { marginals?: string }).marginals).toBe('box');
    expect((parseChart(fx['density-ridge']) as { layout?: string }).layout).toBe('ridge');
    expect((parseChart(fx['bar-lollipop']) as { lollipop?: boolean }).lollipop).toBe(true);
    const seq = parseChart(fx['sequence-forecast']) as { series: { dash?: boolean }[]; bands?: { series?: number; lo: (number | null)[] }[]; x: number[] };
    expect(seq.series[1].dash).toBe(true);
    expect(seq.series[0].dash).toBeUndefined();
    expect(seq.bands).toHaveLength(1);
    expect(seq.bands![0].series).toBe(1);
    expect(seq.bands![0].lo).toHaveLength(seq.x.length);
  });
  it('ignore unknown extension values', () => {
    expect((parseChart({ type: 'scatter', points: [], marginals: 'weird' }) as { marginals?: string }).marginals).toBeUndefined();
    expect((parseChart({ type: 'density', curves: [], layout: 'x' }) as { layout?: string }).layout).toBeUndefined();
    expect((parseChart({ type: 'bar', bars: [], lollipop: 'yes' }) as { lollipop?: boolean }).lollipop).toBeUndefined();
  });
});

describe('phase 4 parsers are defensive', () => {
  it('bubble drops points without numbers and caps the count', () => {
    const s = parseChart({ type: 'bubble', points: [{ x: 1, y: 2, size: 3 }, { x: 'a', y: 2, size: 3 }, { x: 1, y: 2 }, 5, { x: 1, y: 1, size: -2, group: 'g', label: ' L ' }] });
    expect(s.type === 'bubble' && s.points).toHaveLength(2);
    expect(s.type === 'bubble' && s.points[1]).toEqual({ x: 1, y: 1, size: -2, group: 'g', label: 'L' });
    const big = parseChart({ type: 'bubble', points: Array.from({ length: 9000 }, (_, i) => ({ x: i, y: i, size: 1 })) });
    expect(big.type === 'bubble' && big.points.length).toBe(5000);
  });
  it('mosaic pads and clamps counts', () => {
    const s = parseChart({ type: 'mosaic', xs: ['a', 'b'], ys: ['u', 'v'], counts: [[1, -3], [2]], shade: true });
    expect(s.type === 'mosaic' && s.counts).toEqual([[1, 0], [2, 0]]);
    expect(s.type === 'mosaic' && s.shade).toBe(true);
  });
  it('radar aligns values with axes and ignores an inverted range', () => {
    const s = parseChart({ type: 'radar', axes: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 'x'] }], min: 5, max: 1 });
    expect(s.type === 'radar' && s.series[0].values).toEqual([1, null, null]);
    expect(s.type === 'radar' && [s.min, s.max]).toEqual([null, null]);
  });
  it('waterfall keeps total steps without a value', () => {
    const s = parseChart({ type: 'waterfall', steps: [{ label: 'a', value: 3 }, { label: 'b' }, { label: 'T', total: true }, { label: 'c', value: NaN }] });
    expect(s.type === 'waterfall' && s.steps.map((x) => x.label)).toEqual(['a', 'T']);
  });
  it('forest swaps reversed intervals, drops bad rows and defaults the reference by scale', () => {
    const s = parseChart({ type: 'forest', log: true, rows: [{ label: 'a', est: 1, lo: 2, hi: 0.5, weight: -1 }, { label: 'b', est: 1, lo: 1 }] });
    expect(s.type === 'forest' && s.rows).toHaveLength(1);
    expect(s.type === 'forest' && [s.rows[0].lo, s.rows[0].hi, s.rows[0].weight]).toEqual([0.5, 2, null]);
    expect(s.type === 'forest' && s.refValue).toBe(1);
    expect((parseChart({ type: 'forest', rows: [] }) as { refValue: number }).refValue).toBe(0);
  });
  it('treemap drops tiles without area', () => {
    const s = parseChart({ type: 'treemap', tiles: [{ label: 'a', value: 2 }, { label: 'b', value: 0 }, { label: 'c', value: -1 }, { label: 'd', value: 'x' }] });
    expect(s.type === 'treemap' && s.tiles).toHaveLength(1);
  });
  it('sequence bands follow the x positions kept', () => {
    const s = parseChart({ type: 'sequence', x: [1, null, 3], series: [{ name: 'a', values: [1, 2, 3] }], bands: [{ name: 'b', lo: [0, 1, 2], hi: [2, 3, 4] }] });
    expect(s.type === 'sequence' && s.bands?.[0].lo).toEqual([0, 2]);
  });
});

describe('squarify', () => {
  const rect = { x: 10, y: 20, w: 300, h: 200 };
  it('fills the rectangle with areas proportional to the values, in input order', () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const rs = squarify(values, rect);
    const total = values.reduce((a, b) => a + b, 0);
    rs.forEach((r, i) => {
      expect(area(r) / area(rect)).toBeCloseTo(values[i] / total, 9);
      expect(inside(r, rect)).toBe(true);
    });
    expect(rs.reduce((s, r) => s + area(r), 0)).toBeCloseTo(area(rect), 6);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i], rs[j])).toBe(false);
  });
  it('keeps aspect ratios reasonable', () => {
    const rs = squarify([6, 6, 4, 3, 2, 2, 1], rect);
    for (const r of rs) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(4);
  });
  it('handles one value, zeros and an empty rectangle', () => {
    expect(squarify([5], rect)[0]).toEqual(rect);
    const rs = squarify([3, 0, -1, NaN, 1], rect);
    expect(area(rs[1]) + area(rs[2]) + area(rs[3])).toBe(0);
    expect(area(rs[0]) + area(rs[4])).toBeCloseTo(area(rect), 6);
    expect(squarify([1, 2], { x: 0, y: 0, w: 0, h: 5 }).every((r) => area(r) === 0)).toBe(true);
    expect(squarify([], rect)).toEqual([]);
  });
  it('lays out groups in two levels without overlap', () => {
    const tiles = [
      { label: 'a', value: 5, group: 'g1' },
      { label: 'b', value: 3, group: 'g2' },
      { label: 'c', value: 2, group: 'g1' },
      { label: 'd', value: 4, group: null },
      { label: 'e', value: 1, group: 'g2' },
    ];
    const lay = treemapLayout(tiles, rect, 0);
    expect(lay.groups.map((g) => g.name)).toEqual(['g1', 'g2', '']);
    lay.tiles.forEach((r, i) => {
      const g = lay.groups.find((x) => x.name === (tiles[i].group ?? ''))!;
      expect(inside(r, g.rect)).toBe(true);
      expect(area(r) / area(rect)).toBeCloseTo(tiles[i].value / 15, 9);
    });
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) expect(overlap(lay.tiles[i], lay.tiles[j])).toBe(false);
  });
  it('a padded layout stays inside the rectangle', () => {
    const lay = treemapLayout([{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }], rect, 4);
    lay.tiles.forEach((r) => expect(inside(r, rect)).toBe(true));
  });
  it('label room needs a minimum tile size', () => {
    expect(tileLabelRoom(10, 10, 11).label).toBe(false);
    expect(tileLabelRoom(120, 60, 11)).toEqual({ label: true, value: true });
    expect(tileLabelRoom(120, 20, 11)).toEqual({ label: true, value: false });
  });
});

describe('radar geometry', () => {
  it('puts the first axis up and walks clockwise', () => {
    const [x0, y0] = radarPoint(100, 100, 50, 0, 4, 1);
    expect([Math.round(x0), Math.round(y0)]).toEqual([100, 50]);
    const [x1, y1] = radarPoint(100, 100, 50, 1, 4, 1);
    expect([Math.round(x1), Math.round(y1)]).toEqual([150, 100]);
    const [x2, y2] = radarPoint(100, 100, 50, 2, 4, 0.5);
    expect([Math.round(x2), Math.round(y2)]).toEqual([100, 125]);
  });
  it('maps values to fractions, clamping and sending null to the centre', () => {
    expect(radarFraction(5, 0, 10)).toBe(0.5);
    expect(radarFraction(-3, 0, 10)).toBe(0);
    expect(radarFraction(30, 0, 10)).toBe(1);
    expect(radarFraction(null, 0, 10)).toBe(0);
    expect(radarFraction(5, 3, 3)).toBe(0);
  });
  it('derives the range from the data unless given', () => {
    expect(radarRange([[3, 7, null], [9]], null, null)).toEqual([0, 9]);
    expect(radarRange([[-4, 2]], null, null)).toEqual([-4, 2]);
    expect(radarRange([[3, 7]], 1, 20)).toEqual([1, 20]);
    expect(radarRange([[]], null, null)).toEqual([0, 1]);
  });
  it('closes the polygon path', () => {
    const d = radarPath(0, 0, 10, [10, 10, 10], 0, 10);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/L/g)).toHaveLength(2);
  });
});

describe('Pearson residuals and mosaic layout', () => {
  const table = [[203, 118, 178, 212], [122, 167, 528, 673]];
  it('matches expected counts and chi-square', () => {
    const r = pearsonResiduals(table);
    expect(r.total).toBe(2201);
    expect(r.expected[0][0]).toBeCloseTo((711 * 325) / 2201, 6);
    // the classical Titanic table: chi-square 190.4 on 3 degrees of freedom
    expect(r.chi2).toBeCloseTo(190.4, 0);
    expect(r.df).toBe(3);
    // residuals of a 2-row table are mirrored
    for (let xi = 0; xi < 4; xi++) expect(r.resid[0][xi] * Math.sqrt(r.expected[0][xi])).toBeCloseTo(-r.resid[1][xi] * Math.sqrt(r.expected[1][xi]), 6);
    expect(r.resid[0][0]).toBeGreaterThan(4);
  });
  it('is zero under independence and safe for empty tables', () => {
    const r = pearsonResiduals([[10, 20], [20, 40]]);
    r.resid.flat().forEach((z) => expect(z).toBeCloseTo(0, 9));
    expect(r.chi2).toBeCloseTo(0, 9);
    expect(pearsonResiduals([[0, 0], [0, 0]]).chi2).toBe(0);
    expect(pearsonResiduals([]).total).toBe(0);
  });
  it('levels split at 2 and 4', () => {
    expect([0, 1.99, -1.99, 2, -2, 3.9, -4, 9].map(residualLevel)).toEqual([0, 0, 0, 1, -1, 1, -2, 2]);
  });
  it('mosaic widths follow the column totals and heights the column shares, with gaps', () => {
    const lay = mosaicLayout(table, 400, 200, 4);
    const colT = [325, 285, 706, 885];
    const avail = 400 - 3 * 4;
    lay.columns.forEach((c, i) => expect(c.w).toBeCloseTo((avail * colT[i]) / 2201, 6));
    const first = lay.cells.filter((k) => k.xi === 0);
    expect(first).toHaveLength(2);
    expect(first[0].h + first[1].h).toBeCloseTo(200 - 4, 6);
    expect(first[0].h / (first[0].h + first[1].h)).toBeCloseTo(203 / 325, 6);
    expect(first[0].colShare).toBeCloseTo(203 / 325, 9);
    expect(lay.cells.reduce((s, k) => s + k.share, 0)).toBeCloseTo(1, 9);
    for (const k of lay.cells) expect(k.x + k.w).toBeLessThanOrEqual(400 + 1e-9);
  });
  it('empty columns and cells take no room and no gap', () => {
    const lay = mosaicLayout([[5, 0, 5], [5, 0, 0]], 100, 100, 10);
    expect(lay.columns[1].w).toBe(0);
    expect(lay.cells).toHaveLength(3);
    const last = lay.cells.find((k) => k.xi === 2)!;
    expect(last.h).toBeCloseTo(100, 9);
    expect(lay.columns[2].x).toBeCloseTo(lay.columns[0].w + 10, 9);
    expect(mosaicLayout([], 100, 100, 4).cells).toEqual([]);
  });
});

describe('ridge offsets', () => {
  it('first peak touches the top, last baseline the bottom, steps are even', () => {
    const r = ridgeOffsets(4, 10, 300, 1.7, 0.5);
    expect(r.baselines[3]).toBeCloseTo(310, 9);
    expect(r.baselines[0] - r.peak).toBeCloseTo(10, 9);
    expect(r.baselines[1] - r.baselines[0]).toBeCloseTo(r.step, 9);
    expect(r.peak).toBeCloseTo(1.7 * r.step, 9);
    expect(r.unit * 0.5).toBeCloseTo(r.peak, 9);
  });
  it('curves overlap when the peak is higher than one step', () => {
    const r = ridgeOffsets(3, 0, 200, 2, 1);
    expect(r.peak).toBeGreaterThan(r.step);
  });
  it('one row and zero density are safe', () => {
    const r = ridgeOffsets(1, 0, 100, 2, 0);
    expect(r.baselines).toHaveLength(1);
    expect(r.unit).toBe(0);
  });
  it('interpolates inside the curve only', () => {
    const pts: [number, number][] = [[0, 0], [10, 10]];
    expect(interpolate(pts, 5)).toBe(5);
    expect(interpolate(pts, -1)).toBeNull();
    expect(interpolate(pts, 11)).toBeNull();
    expect(interpolate([], 1)).toBeNull();
  });
});

describe('bubbles', () => {
  it('area is proportional to size', () => {
    const r1 = bubbleRadius(25, 100, 20);
    const r2 = bubbleRadius(100, 100, 20);
    expect(r2).toBe(20);
    expect((r2 * r2) / (r1 * r1)).toBeCloseTo(4, 9);
    expect(bubbleRadius(0, 100, 20)).toBe(0);
    expect(bubbleRadius(-4, 100, 20)).toBe(0);
    expect(bubbleRadius(5, 0, 20)).toBe(0);
  });
  it('reference sizes are round numbers not above the maximum', () => {
    expect(sizeReferences(120)).toEqual([100, 50, 10]);
    expect(sizeReferences(7.5)).toEqual([5, 2.5, 0.5]);
    expect(sizeReferences(2)).toEqual([2, 1, 0.2]);
    expect(sizeReferences(0)).toEqual([]);
    for (const m of [0.013, 1, 3, 99, 4200]) {
      const refs = sizeReferences(m);
      expect(refs).toHaveLength(3);
      refs.forEach((v) => expect(v).toBeLessThanOrEqual(m));
    }
  });
});

describe('waterfall', () => {
  it('runs a total through increases, decreases and total bars', () => {
    const bars = waterfallBars([{ label: 'a', value: 100 }, { label: 'b', value: -30 }, { label: 'T', value: 0, total: true }, { label: 'c', value: -90 }, { label: 'T2', value: 0, total: true }]);
    expect(bars.map((b) => [b.from, b.to, b.kind])).toEqual([[0, 100, 'increase'], [100, 70, 'decrease'], [0, 70, 'total'], [70, -20, 'decrease'], [0, -20, 'total']]);
    expect(bars.map((b) => b.delta)).toEqual([100, -30, 70, -90, -20]);
  });
  it('is empty for no steps', () => {
    expect(waterfallBars([])).toEqual([]);
  });
});

describe('forest', () => {
  it('keeps groups together behind headers, ungrouped rows first', () => {
    const rows = [{ group: 'B' }, { group: 'A' }, { group: null }, { group: 'B' }, { group: 'A' }];
    const items = forestItems(rows);
    expect(items.map((i) => (i.kind === 'header' ? 'H' + i.label : 'r' + i.index))).toEqual(['r2', 'HB', 'r0', 'r3', 'HA', 'r1', 'r4']);
    expect(forestItems([{}, {}]).every((i) => i.kind === 'row')).toBe(true);
  });
  it('marker side grows with the square root of the weight', () => {
    expect(weightSide(100, 100, 5, 16)).toBe(16);
    expect(weightSide(25, 100, 5, 16)).toBeCloseTo(8, 9);
    expect(weightSide(1, 100, 5, 16)).toBe(5);
    expect(weightSide(null, 100, 5, 16)).toBeCloseTo(10.5, 9);
  });
  it('log ticks are 1, 2, 5 times powers of ten inside the range and thin out', () => {
    expect(logTicks(0.3, 12, 12)).toEqual([0.5, 1, 2, 5, 10]);
    expect(logTicks(0.5, 2, 12)).toEqual([0.5, 1, 2]);
    expect(logTicks(0, 10, 5)).toEqual([]);
    const wide = logTicks(0.001, 1e6, 5);
    expect(wide.length).toBeLessThanOrEqual(5);
    wide.forEach((v) => expect(Math.abs(Math.log10(v) - Math.round(Math.log10(v)))).toBeLessThan(1e-9));
  });
});

describe('marginal statistics', () => {
  it('quantiles and box stats', () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 9);
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 50])!;
    expect(b.median).toBe(5.5);
    expect(b.outliers).toEqual([50]);
    expect(b.hi).toBe(9);
    expect(b.lo).toBe(1);
    expect(boxStats([])).toBeNull();
    expect(boxStats([4])!.median).toBe(4);
  });
  it('histogram counts every value once, the maximum in the last bin', () => {
    const c = histCounts([0, 1, 2, 3, 4, 10, 11, -1], 0, 10, 5);
    expect(c).toEqual([2, 2, 1, 0, 1]);
    expect(histCounts([1, 2], 5, 5, 3)).toEqual([0, 0, 0]);
  });
  it('density integrates to about one', () => {
    const vals = Array.from({ length: 200 }, (_, i) => Math.sin(i * 12.9898) * 3 + 10);
    const cv = kdeCurve(vals, 0, 20, 200);
    let area = 0;
    for (let i = 1; i < cv.length; i++) area += ((cv[i][1] + cv[i - 1][1]) / 2) * (cv[i][0] - cv[i - 1][0]);
    expect(area).toBeGreaterThan(0.95);
    expect(area).toBeLessThan(1.02);
    expect(kdeCurve([1], 0, 2)).toEqual([]);
  });
});

describe('phase 4 strings', () => {
  it('have a Czech twin for every key and keep placeholders', () => {
    const keys = ['bubbleChart', 'mosaicPlot', 'radarChart', 'waterfallChart', 'forestPlot', 'treemap', 'bubbleSkipped', 'ariaAxes', 'ariaRows', 'ariaTiles', 'marginalHistogram', 'marginalDensity', 'marginalBox'] as const;
    for (const k of keys) {
      expect(chartStrings.en[k]).toBeTruthy();
      expect(chartStrings.cs[k]).toBeTruthy();
      expect(chartStrings.cs[k].match(/\{\w+\}/g)).toEqual(chartStrings.en[k].match(/\{\w+\}/g));
    }
  });
});
