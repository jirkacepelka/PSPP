/*
 * Graph Studio phase 3 tests: 3D scatter, 3D bars, surface (grid, hole filling), the stored view,
 * and the options that do not apply to 3D kinds.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef } from '../charts/studioTypes';
import students from '../samples/students.json';
import { computeChart, fillHoles, gridEdges, SCATTER3D_MAX_CASES } from './compute';
import { defaultDef, GALLERY, is3d, optionsOf, slotsOf } from './model';
import { restyleChart, studioChart } from './outputBridge';
import { seriesNames, view3dOf } from './series';

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

const def = (kind: GraphDef['kind'], bind: GraphDef['bind'], options: Record<string, unknown> = {}): GraphDef => {
  const d = defaultDef(kind);
  return { ...d, bind, options: { ...d.options, ...options } };
};

function ok(d: GraphDef, data: Dataset) {
  const r = computeChart(d, data, t);
  if (!r.ok) throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r;
}

describe('gallery and model', () => {
  it('offers the three 3D kinds in the 3d group, without panels', () => {
    expect(GALLERY.filter((e) => e.group === '3d').map((e) => e.kind).sort()).toEqual(['bar3d', 'scatter3d', 'surface3d']);
    for (const k of ['scatter3d', 'bar3d', 'surface3d'] as const) {
      expect(is3d(k)).toBe(true);
      const d = defaultDef(k);
      expect(slotsOf(d).some((s) => s.id === 'panel')).toBe(false);
      expect(optionsOf(d).some((o) => o.id === 'sharedAxes' || o.id === 'panelCols')).toBe(false);
    }
    expect(is3d('bar')).toBe(false);
  });
  it('bar3d asks for a value variable only for variable summaries; grid is 10..60', () => {
    expect(slotsOf(def('bar3d', {})).map((s) => s.id)).toEqual(['x', 'y']);
    expect(slotsOf(def('bar3d', {}, { func: 'mean' })).map((s) => s.id)).toEqual(['x', 'y', 'value']);
    const g = optionsOf(def('surface3d', {})).find((o) => o.id === 'grid')!;
    expect([g.min, g.max, defaultDef('surface3d').options.grid]).toEqual([10, 60, 25]);
  });
});

describe('scatter3d', () => {
  const data = ds([['g', [1, 1, 2, 2, 2]], ['x', [1, 2, 3, 4, 5]], ['y', [5, 4, 3, 2, 1]], ['z', [1, 4, 9, null, 25]]]);
  it('keeps complete cases, groups and the plane option', () => {
    const r = ok(def('scatter3d', { x: ['x'], y: ['y'], z: ['z'], group: ['g'] }, { fit: 'plane' }), data);
    const c = r.chart as { type: string; fit: string; groupLabel: string; points: { x: number; z: number; group: string | null }[] };
    expect(c.type).toBe('scatter3d');
    expect(c.fit).toBe('plane');
    expect(c.points).toHaveLength(4);
    expect(c.points[3]).toMatchObject({ x: 5, z: 25 });
    expect(c.points.every((p) => p.group !== null)).toBe(true);
    expect(r.info.excluded).toBe(1);
  });
  it('has no group without the slot, and samples deterministically above the limit', () => {
    const n = SCATTER3D_MAX_CASES + 5000;
    const col = Array.from({ length: n }, (_, i) => i);
    const big = ds([['x', col], ['y', col], ['z', col]]);
    const d = def('scatter3d', { x: ['x'], y: ['y'], z: ['z'] });
    const a = ok(d, big);
    const b = ok(d, big);
    const pts = (a.chart as { points: { group: unknown; x: number }[] }).points;
    expect(pts.length).toBeLessThanOrEqual(SCATTER3D_MAX_CASES);
    expect(pts[0].group).toBeNull();
    expect(a.notes.some((x) => x.startsWith('graphstudio.note.sampled'))).toBe(true);
    expect(b.chart).toEqual(a.chart);
    // up to the limit every case is passed up
    const edge = ds([['x', col.slice(0, SCATTER3D_MAX_CASES)], ['y', col.slice(0, SCATTER3D_MAX_CASES)], ['z', col.slice(0, SCATTER3D_MAX_CASES)]]);
    const e = ok(d, edge);
    expect((e.chart as { points: unknown[] }).points).toHaveLength(SCATTER3D_MAX_CASES);
    expect(e.notes).toEqual([]);
  });
});

describe('bar3d', () => {
  const data = ds([['a', [1, 1, 2, 2, 2, 3]], ['b', [1, 2, 1, 1, 2, 1]], ['v', [10, 20, 30, 50, 60, 70]], ['w', [1, 1, 2, 1, 1, 1]]]);
  it('counts per cell and leaves empty cells null (nothing is dropped)', () => {
    const c = ok(def('bar3d', { x: ['a'], y: ['b'] }), data).chart as { xs: string[]; ys: string[]; values: (number | null)[][] };
    expect(c.xs).toEqual(['1', '2', '3']);
    expect(c.ys).toEqual(['1', '2']);
    // values[yi][xi]
    expect(c.values).toEqual([[1, 2, 1], [1, 1, null]]);
  });
  it('summarises a variable and honours the weight', () => {
    const c = ok(def('bar3d', { x: ['a'], y: ['b'], value: ['v'] }, { func: 'mean' }), data).chart as { values: (number | null)[][] };
    expect(c.values[0]).toEqual([10, 40, 70]);
    const w = ok(def('bar3d', { x: ['a'], y: ['b'] }), { ...data, weight: 'w' }).chart as { values: (number | null)[][] };
    expect(w.values[0][1]).toBe(3);
  });
  it('percent uses the total weight', () => {
    const c = ok(def('bar3d', { x: ['a'], y: ['b'] }, { func: 'pct' }), data).chart as { values: (number | null)[][] };
    expect(c.values[0][0]).toBeCloseTo(100 / 6);
  });
  it('merges numeric category values into intervals', () => {
    const col = Array.from({ length: 40 }, (_, i) => i);
    const c = ok(def('bar3d', { x: ['a'], y: ['b'] }, { mergeMode: 'width', mergeWidth: 10 }), ds([['a', col], ['b', col.map((i) => i % 2)]])).chart as { xs: string[] };
    expect(c.xs).toHaveLength(4);
  });
  it('filters like every chart', () => {
    const filtered = { ...data, filter: 'f', columns: [...data.columns, [1, 1, 1, 0, 0, 0]], variables: [...data.variables, num('f')] };
    const r = ok(def('bar3d', { x: ['a'], y: ['b'] }), filtered);
    expect(r.info.used).toBe(3);
  });
});

describe('surface3d', () => {
  it('fillHoles weights neighbours by inverse squared distance within two cells only', () => {
    const g: (number | null)[][] = [
      [10, null, null, null, null, null],
      [null, null, null, null, null, null],
      [null, null, null, null, null, 7],
    ];
    const filled = fillHoles(g);
    expect(g[0][1]).toBe(10);
    expect(g[0][2]).toBe(10);
    // (0,3) is two cells from the 7 diagonally and three from the 10: only the 7 counts
    expect(g[0][3]).toBe(7);
    // a cell with no data within two cells stays a hole
    const far: (number | null)[][] = [[1, null, null, null]];
    fillHoles(far);
    expect(far[0][3]).toBeNull();
    expect(g[1][1]).toBe(10);
    // cell (1,4) reaches only (2,5) at distance sqrt 2 and nothing else
    expect(g[1][4]).toBe(7);
    expect(filled).toBeGreaterThan(5);
    // a cell with data on both sides is a weighted average
    const h: (number | null)[][] = [[0, null, 4]];
    fillHoles(h);
    expect(h[0][1]).toBe(2);
    const k: (number | null)[][] = [[0, null, null, 8]];
    fillHoles(k);
    // weights 1/1 (from 0 at distance... cell 1: 0 at d=1, 8 at d=2) -> (0 + 8/4) / (1 + 1/4)
    expect(k[0][1]).toBeCloseTo(1.6);
  });
  it('grid edges are exactly n cells', () => {
    const e = gridEdges(0, 10, 25);
    expect(e).toHaveLength(26);
    expect(e[25]).toBe(10);
    expect(gridEdges(3, 3, 25)).toHaveLength(2);
  });
  it('means of z per cell with a z variable, counts without', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 10];
    const y = x.map((v) => 10 - v);
    const z = x.map((v) => v * 2);
    const data = ds([['x', x], ['y', y], ['z', z]]);
    const withZ = ok(def('surface3d', { x: ['x'], y: ['y'], z: ['z'] }, { grid: 10 }), data);
    const s = withZ.chart as { xs: number[]; ys: number[]; z: (number | null)[][] };
    expect(s.xs).toHaveLength(10);
    expect(s.z).toHaveLength(10);
    expect(s.z.flat().some((v) => v === null)).toBe(true);
    const nonNull = s.z.flat().filter((v): v is number => v !== null);
    expect(Math.max(...nonNull)).toBeLessThanOrEqual(20);
    expect(Math.min(...nonNull)).toBeGreaterThanOrEqual(0);
    const counts = ok(def('surface3d', { x: ['x'], y: ['y'] }, { grid: 10 }), data).chart as { z: number[][]; zlabel: string };
    expect(counts.z.flat().reduce((a, b) => a + b, 0)).toBe(13);
    expect(counts.z.flat().every((v) => v !== null)).toBe(true);
  });
  it('clamps the grid size', () => {
    const data = ds([['x', [0, 1, 2]], ['y', [0, 1, 2]]]);
    expect((ok(def('surface3d', { x: ['x'], y: ['y'] }, { grid: 500 }), data).chart as { xs: number[] }).xs).toHaveLength(60);
    expect((ok(def('surface3d', { x: ['x'], y: ['y'] }, { grid: 2 }), data).chart as { xs: number[] }).xs).toHaveLength(10);
  });
});

describe('students sample', () => {
  const data = students as unknown as Dataset;
  it('builds every 3D kind', () => {
    expect((ok(def('scatter3d', { x: ['hours'], y: ['sleep'], z: ['gpa'], group: ['faculty'] }), data).chart as { points: unknown[] }).points.length).toBeGreaterThan(50);
    expect((ok(def('bar3d', { x: ['faculty'], y: ['year'] }), data).chart as { values: unknown[][] }).values.length).toBeGreaterThan(1);
    expect((ok(def('surface3d', { x: ['hours'], y: ['sleep'], z: ['gpa'] }), data).chart as { z: unknown[][] }).z.length).toBe(25);
  });
});

describe('stored view', () => {
  const view = { azimuth: 33, elevation: 21, perspective: true, zoom: 1.2 };
  const data = ds([['x', [1, 2, 3]], ['y', [1, 2, 3]], ['z', [1, 4, 9]]]);
  const d = def('scatter3d', { x: ['x'], y: ['y'], z: ['z'] });
  it('is written into the chart object and read back', () => {
    const chart = studioChart(ok(d, data).chart, d, {}, view);
    expect(chart.view3d).toEqual(view);
    expect(view3dOf(chart)).toEqual(view);
    expect(view3dOf(JSON.parse(JSON.stringify(chart)))).toEqual(view);
    expect(view3dOf({ chart })).toEqual(view);
  });
  it('is not stored on 2D charts, nor without a view, and malformed views are ignored', () => {
    const bar = def('bar', { x: ['x'] });
    expect(studioChart(ok(bar, data).chart, bar, {}, view).view3d).toBeUndefined();
    expect(studioChart(ok(d, data).chart, d, {}).view3d).toBeUndefined();
    expect(view3dOf({ view3d: { azimuth: 'x' } })).toBeNull();
  });
  it('restyleChart keeps or replaces the view', () => {
    const chart = studioChart(ok(d, data).chart, d, {}, view);
    expect((restyleChart(chart, { grid: false }) as { view3d: unknown }).view3d).toEqual(view);
    expect((restyleChart(chart, {}, { ...view, azimuth: 5 }) as { view3d: { azimuth: number } }).view3d.azimuth).toBe(5);
  });
  it('drops reference lines and annotations on 3D charts', () => {
    const chart = studioChart(ok(d, data).chart, d, { grid: false, refLines: [{ axis: 'y', value: 1 }], annotations: [{ x: 1, y: 1, text: 'a' }] });
    expect(chart.style).toEqual({ grid: false });
  });
  it('series names for the palette', () => {
    expect(seriesNames(ok(d, data).chart)).toEqual(['z']);
    const g = def('scatter3d', { x: ['x'], y: ['y'], z: ['z'], group: ['z'] });
    expect(seriesNames(ok(g, data).chart)).toHaveLength(3);
  });
});

describe('3D axis style', () => {
  const data = ds([['x', [1, 2, 3]], ['y', [1, 2, 3]], ['z', [1, 4, 9]]]);
  const d = def('scatter3d', { x: ['x'], y: ['y'], z: ['z'] });
  const style = { zTitle: 'Height', zMin: 0, zMax: 10, xMin: null };
  it('passes z title and range through studioChart and restyleChart', () => {
    const chart = studioChart(ok(d, data).chart, d, style);
    expect(chart.style).toEqual({ zTitle: 'Height', zMin: 0, zMax: 10 });
    const r = restyleChart(chart, { zMax: 5, zMin: null }) as { style: unknown };
    expect(r.style).toEqual({ zMax: 5 });
  });
});
