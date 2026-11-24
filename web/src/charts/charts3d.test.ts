/* Projection math and parsing of the 3D charts.  SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json';
import { parseChart } from './types';
import { chartStrings } from './strings';
import {
  DEFAULT_VIEW,
  backFaces,
  boxEdges,
  clipPlane,
  depthOrder,
  edgeInFront,
  evenIndices,
  faceVisible,
  fitPlane,
  gridOrder,
  makeCam,
  normalizeView,
  pickAxisEdges,
  project,
  rampStep,
  thinByGap,
  wrapAzimuth,
} from './proj3d';

const fx = fixtures as Record<string, unknown>;
const view = (azimuth: number, elevation: number, perspective = false, zoom = 1) => normalizeView({ azimuth, elevation, perspective, zoom });
const unit = { bx: 1, by: 1, bz: 1 };

describe('projection', () => {
  it('maps the origin to the centre of the plot', () => {
    const cam = makeCam(view(-35, 22), 400, 300, 1);
    const p = project(cam, 0, 0, 0);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
    expect(p.d).toBeCloseTo(0);
  });
  it('looks along +y at azimuth 0 and elevation 0: x right, z up, y into the screen', () => {
    const cam = makeCam(view(0, 0), 400, 400, 1);
    const right = project(cam, 1, 0, 0);
    const up = project(cam, 0, 0, 1);
    const far = project(cam, 0, 1, 0);
    expect(right.x).toBeGreaterThan(200);
    expect(right.y).toBeCloseTo(200);
    expect(up.y).toBeLessThan(200);
    expect(up.x).toBeCloseTo(200);
    expect(far.d).toBeCloseTo(1);
    expect(far.x).toBeCloseTo(200);
    expect(far.y).toBeCloseTo(200);
  });
  it('rotates about the vertical axis by the azimuth and keeps lengths (orthographic)', () => {
    const cam = makeCam(view(90, 0), 400, 400, 1);
    // at azimuth 90 the x axis points toward the camera or away from it, the y axis runs sideways
    const x = project(cam, 1, 0, 0);
    const y = project(cam, 0, 1, 0);
    expect(Math.abs(x.d)).toBeCloseTo(1);
    expect(x.x).toBeCloseTo(200);
    expect(Math.abs(y.x - 200)).toBeCloseTo(cam.scale);
    const r = [cam.m[0], cam.m[1], cam.m[2]];
    expect(Math.hypot(...r)).toBeCloseTo(1);
    // the three rows are orthonormal
    const dot = (a: number, b: number) => cam.m[a] * cam.m[b] + cam.m[a + 1] * cam.m[b + 1] + cam.m[a + 2] * cam.m[b + 2];
    expect(dot(0, 3)).toBeCloseTo(0);
    expect(dot(0, 6)).toBeCloseTo(0);
    expect(dot(3, 6)).toBeCloseTo(0);
    expect(dot(6, 6)).toBeCloseTo(1);
  });
  it('a top view (elevation 90) shows y upward on the screen and drops the height from the picture', () => {
    const cam = makeCam(view(0, 90), 400, 400, 1);
    expect(project(cam, 0, 1, 0).y).toBeLessThan(200);
    const a = project(cam, 0.3, 0.2, 0);
    const b = project(cam, 0.3, 0.2, 0.9);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    // the higher point is nearer to the camera
    expect(b.d).toBeLessThan(a.d);
  });
  it('perspective makes near points larger and keeps the centre fixed', () => {
    const cam = makeCam(view(0, 0, true), 400, 400, 1);
    const near = project(cam, 0.5, -0.8, 0);
    const far = project(cam, 0.5, 0.8, 0);
    expect(near.f).toBeGreaterThan(1);
    expect(far.f).toBeLessThan(1);
    expect(near.x - 200).toBeGreaterThan(far.x - 200);
    expect(project(cam, 0, 0, 0).x).toBeCloseTo(200);
  });
  it('zoom scales distances from the centre', () => {
    const a = project(makeCam(view(-35, 22, false, 1), 400, 400, 1), 0.4, 0.3, 0.2);
    const b = project(makeCam(view(-35, 22, false, 2), 400, 400, 1), 0.4, 0.3, 0.2);
    expect(b.x - 200).toBeCloseTo(2 * (a.x - 200));
    expect(b.y - 200).toBeCloseTo(2 * (a.y - 200));
  });
});

describe('depth order', () => {
  it('sorts the farthest first and keeps ties in input order', () => {
    expect(depthOrder([1, 5, -2, 5, 0])).toEqual([1, 3, 0, 4, 2]);
  });
  it('orders points of a diagonal by their distance from the camera', () => {
    const cam = makeCam(view(-35, 22), 400, 400, 1);
    const pts = [-0.5, 0, 0.5].map((v) => project(cam, v, v, 0).d);
    const order = depthOrder(pts);
    // along (1,1,0) at azimuth -35 the line of sight changes little; whichever end is farther comes first
    expect(pts[order[0]]).toBeGreaterThanOrEqual(pts[order[1]]);
    expect(pts[order[1]]).toBeGreaterThanOrEqual(pts[order[2]]);
  });
  it('grid order puts the far side first in both directions', () => {
    const cam = makeCam(view(-35, 22), 400, 400, 1);
    const { xDesc, yDesc } = gridOrder(cam);
    // x increases toward the camera at azimuth -35 (depth falls), y increases away from it
    expect(xDesc).toBe(false);
    expect(yDesc).toBe(true);
    const flipped = gridOrder(makeCam(view(145, 22), 400, 400, 1));
    expect(flipped.xDesc).toBe(true);
    expect(flipped.yDesc).toBe(false);
  });
});

describe('box faces and edges', () => {
  it('shows exactly three faces from a generic view and hides three', () => {
    const cam = makeCam(view(-35, 22), 400, 400, 1);
    expect(backFaces(cam, unit)).toHaveLength(3);
    for (const [az, el] of [[40, 30], [200, -20], [-120, 60]]) {
      expect(backFaces(makeCam(view(az, el), 400, 400, 1), unit).length).toBe(3);
    }
  });
  it('the floor is a back wall when seen from above and the ceiling when seen from below', () => {
    const above = backFaces(makeCam(view(-35, 22), 400, 400, 1), unit).find((f) => f.axis === 2);
    const below = backFaces(makeCam(view(-35, -22), 400, 400, 1), unit).find((f) => f.axis === 2);
    expect(above?.sign).toBe(-1);
    expect(below?.sign).toBe(1);
  });
  it('perspective agrees with the orthographic faces away from the grazing angle', () => {
    const o = makeCam(view(-35, 22), 400, 400, 1);
    const p = makeCam(view(-35, 22, true), 400, 400, 1);
    for (const f of [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][]) {
      const c = f.map((v) => v * 0.5) as [number, number, number];
      expect(faceVisible(p, c, f)).toBe(faceVisible(o, c, f));
    }
  });
  it('has twelve edges; a front edge touches two visible faces only', () => {
    const edges = boxEdges();
    expect(edges).toHaveLength(12);
    const cam = makeCam(view(-35, 22), 400, 400, 1);
    expect(edges.filter((e) => edgeInFront(cam, unit, e))).toHaveLength(3);
  });
});

describe('tick placement', () => {
  it('puts x and y labels on the lowest floor edges and the z labels on the leftmost vertical edge', () => {
    const p = pickAxisEdges(view(-35, 22));
    // x axis labels sit on the edge with y = -1 (nearer the camera at this azimuth), z = -1 (the floor)
    expect(p.x).toEqual([-1, -1]);
    expect(p.y[1]).toBe(-1);
    expect(p.z).toHaveLength(2);
  });
  it('moves the labels to the other side when the chart is rotated half a turn', () => {
    const a = pickAxisEdges(view(-35, 22));
    const b = pickAxisEdges(view(145, 22));
    expect(b.x[0]).toBe(-a.x[0]);
    expect(b.y[0]).toBe(-a.y[0]);
    expect(b.z).toEqual([-a.z[0], -a.z[1]]);
  });
  it('from below the floor the lowest edge is the far one', () => {
    expect(pickAxisEdges(view(-35, -22)).x).toEqual([1, -1]);
  });
  it('thins labels to a regular stride that clears the minimum gap', () => {
    const pos = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(thinByGap(pos, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(thinByGap(pos, 25)).toEqual([0, 3, 6, 9]);
    expect(thinByGap(pos, 1000)).toEqual([0]);
    expect(thinByGap([], 10)).toEqual([]);
  });
});

describe('data helpers', () => {
  it('spreads indices evenly and always keeps both ends', () => {
    expect(evenIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    const idx = evenIndices(10001, 4000);
    expect(idx).toHaveLength(4000);
    expect(idx[0]).toBe(0);
    expect(idx[3999]).toBe(10000);
    expect(new Set(idx).size).toBe(4000);
  });
  it('fits the least squares plane exactly on noise-free data', () => {
    const pts = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) pts.push({ x: i, y: j * 2, z: 3 + 2 * i - 0.5 * j * 2 });
    const f = fitPlane(pts)!;
    expect(f.a).toBeCloseTo(3);
    expect(f.b).toBeCloseTo(2);
    expect(f.c).toBeCloseTo(-0.5);
    expect(f.r2).toBeCloseTo(1);
  });
  it('gives no plane for too few or collinear points', () => {
    expect(fitPlane([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }])).toBeNull();
    expect(fitPlane([0, 1, 2, 3].map((i) => ({ x: i, y: 2 * i, z: i })))).toBeNull();
  });
  it('clips the plane to the box height', () => {
    const f = { a: 0, b: 1, c: 0, r2: 1 };
    const poly = clipPlane(f, 0, 10, 0, 5, 2, 6);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    for (const [, , z] of poly) {
      expect(z).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(z).toBeLessThanOrEqual(6 + 1e-9);
    }
    expect(clipPlane({ a: 100, b: 0, c: 0, r2: 1 }, 0, 1, 0, 1, 0, 1)).toEqual([]);
  });
  it('quantises a ramp into steps within range', () => {
    expect(rampStep(0, 0, 10, 16)).toBe(0);
    expect(rampStep(10, 0, 10, 16)).toBe(15);
    expect(rampStep(5, 0, 10, 16)).toBe(8);
    expect(rampStep(5, 3, 3, 16)).toBe(0);
  });
});

describe('view normalisation', () => {
  it('wraps the azimuth and clamps elevation and zoom', () => {
    expect(wrapAzimuth(190)).toBeCloseTo(-170);
    expect(wrapAzimuth(-540)).toBe(180);
    const v = normalizeView({ azimuth: 725, elevation: 120, zoom: 99 });
    expect(v.azimuth).toBeCloseTo(5);
    expect(v.elevation).toBe(90);
    expect(v.zoom).toBe(4);
  });
  it('falls back to the defaults for missing or non-finite input', () => {
    expect(normalizeView(undefined)).toEqual(DEFAULT_VIEW);
    expect(normalizeView({ azimuth: NaN, elevation: Infinity, zoom: -3 })).toEqual({ ...DEFAULT_VIEW, zoom: 0.4 });
  });
});

describe('parsing', () => {
  it('reads the fixtures', () => {
    const s = parseChart(fx['scatter3d']);
    expect(s.type).toBe('scatter3d');
    if (s.type === 'scatter3d') {
      expect(s.points).toHaveLength(120);
      expect(s.fit).toBe('plane');
      expect(s.groupLabel).toBe('Group');
    }
    expect(s.view3d).toBeUndefined();
    expect(parseChart(fx['scatter3d-simple']).view3d).toEqual({ azimuth: -50, elevation: 30, perspective: true, zoom: 1.1 });
    const b = parseChart(fx['bar3d']);
    expect(b.type).toBe('bar3d');
    if (b.type === 'bar3d') {
      expect(b.values).toHaveLength(3);
      expect(b.values[2][4]).toBeNull();
      expect(b.values[1][2]).toBe(-6.5);
    }
    const su = parseChart(fx['surface3d']);
    expect(su.type).toBe('surface3d');
    if (su.type === 'surface3d') expect(su.z[6][15]).toBeNull();
  });
  it('drops bad scatter points and falls back to no fit', () => {
    const s = parseChart({
      type: 'scatter3d',
      fit: 'cubic',
      points: [{ x: 1, y: 2, z: 3, group: 'a' }, { x: '1', y: 2, z: 3 }, { x: NaN, y: 1, z: 1 }, null, 7, { x: 1, y: 1, z: Infinity }, { x: 4, y: 5, z: 6 }],
    });
    expect(s.type).toBe('scatter3d');
    if (s.type === 'scatter3d') {
      expect(s.points).toEqual([{ x: 1, y: 2, z: 3, group: 'a' }, { x: 4, y: 5, z: 6, group: null }]);
      expect(s.fit).toBe('none');
    }
  });
  it('pads and cleans ragged bar grids', () => {
    const b = parseChart({ type: 'bar3d', xs: ['a', 'b', 3], ys: ['y'], values: [[1, 'x'], 5] });
    expect(b.type).toBe('bar3d');
    if (b.type === 'bar3d') {
      expect(b.xs).toEqual(['a', 'b', '3']);
      expect(b.values).toEqual([[1, null, null]]);
    }
  });
  it('uses the index when surface axes are not increasing', () => {
    const s = parseChart({ type: 'surface3d', xs: [3, 2, 1], ys: [0, 1], z: [[1, 2, 3], [4, 5, 6]] });
    if (s.type === 'surface3d') {
      expect(s.xs).toEqual([0, 1, 2]);
      expect(s.ys).toEqual([0, 1]);
    } else throw new Error('wrong type');
  });
  it('survives garbage', () => {
    for (const t of ['scatter3d', 'bar3d', 'surface3d']) {
      const s = parseChart({ type: t, points: 'x', xs: 5, ys: {}, values: null, z: 'q', view3d: 'no' });
      expect(s.type).toBe(t);
      expect(s.view3d).toBeUndefined();
    }
  });
  it('reads and clamps chart.view3d on any chart', () => {
    const s = parseChart({ type: 'surface3d', xs: [0, 1], ys: [0, 1], z: [[0, 1], [1, 2]], view3d: { azimuth: 400, elevation: -200, perspective: 'yes', zoom: 0 } });
    expect(s.view3d).toEqual({ azimuth: 40, elevation: -90, perspective: false, zoom: 0.4 });
  });
});

describe('strings', () => {
  it('has Czech twins with the same placeholders for every key', () => {
    for (const k of Object.keys(chartStrings.en) as (keyof typeof chartStrings.en)[]) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(chartStrings.cs[k], k).toBeTruthy();
      expect(ph(chartStrings.cs[k]), k).toBe(ph(chartStrings.en[k]));
    }
  });
});
