/* Software 3D projection and the pure math of the 3D charts: rotation, perspective, depth order, box
   edges and tick placement, least squares plane, decimation.  No DOM, no React.
   SPDX-License-Identifier: GPL-3.0-or-later

   Conventions: world x runs right, y runs into the screen, z points up; the scene is centred on the
   origin.  A view is an azimuth (rotation about z, degrees) and an elevation (tilt above the floor).
   Depth `d` is the distance from the camera along the line of sight: smaller = nearer, so the
   painter's algorithm draws in descending `d`. */

import type { View3d } from './studioTypes';

export const DEFAULT_VIEW: Required<View3d> = { azimuth: -35, elevation: 22, perspective: false, zoom: 1 };
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;
/** Camera distance of the perspective view, in units where the unit cube has radius ~0.9. */
export const CAM_DIST = 4;

const RAD = Math.PI / 180;

export const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Azimuth wrapped into (-180, 180]. */
export function wrapAzimuth(a: number): number {
  let r = ((a % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r === -180 ? 180 : r;
}

/** Complete a (possibly partial or hostile) view: finite numbers, elevation within +-90, zoom within limits. */
export function normalizeView(v?: Partial<View3d> | null): Required<View3d> {
  const fin = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
  return {
    azimuth: wrapAzimuth(fin(v?.azimuth, DEFAULT_VIEW.azimuth)),
    elevation: clampNum(fin(v?.elevation, DEFAULT_VIEW.elevation), -90, 90),
    perspective: typeof v?.perspective === 'boolean' ? v.perspective : DEFAULT_VIEW.perspective,
    zoom: clampNum(fin(v?.zoom, DEFAULT_VIEW.zoom), ZOOM_MIN, ZOOM_MAX),
  };
}

export const sameView = (a: Required<View3d>, b: Required<View3d>): boolean =>
  Math.abs(a.azimuth - b.azimuth) < 1e-6 && Math.abs(a.elevation - b.elevation) < 1e-6 && a.perspective === b.perspective && Math.abs(a.zoom - b.zoom) < 1e-6;

/* ---------------------------------------------------------------- camera */

export interface Cam {
  /** rotation rows: screen x, screen y (up), depth */
  m: [number, number, number, number, number, number, number, number, number];
  persp: boolean;
  /** pixels per world unit at depth 0 */
  scale: number;
  cx: number;
  cy: number;
}

/** Camera for a view in a w x h plot area; `radius` is the radius of the bounding sphere of the scene
    (the scale is constant during a rotation, so the picture does not pulse). */
export function makeCam(view: Required<View3d>, w: number, h: number, radius: number): Cam {
  const a = view.azimuth * RAD;
  const e = view.elevation * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const r = Math.max(1e-6, radius);
  const fit = Math.min(h * 0.5 * 0.94, w * 0.5 * 0.8) / r;
  return { m: [ca, -sa, 0, sa * se, ca * se, ce, sa * ce, ca * ce, -se], persp: view.perspective, scale: fit * view.zoom, cx: w / 2, cy: h / 2 };
}

export interface Pt3 {
  /** screen pixels */
  x: number;
  y: number;
  /** depth, smaller = nearer */
  d: number;
  /** perspective factor (1 when orthographic) */
  f: number;
}

export function project(c: Cam, x: number, y: number, z: number, out?: Pt3): Pt3 {
  const m = c.m;
  const sx = m[0] * x + m[1] * y + m[2] * z;
  const sy = m[3] * x + m[4] * y + m[5] * z;
  const d = m[6] * x + m[7] * y + m[8] * z;
  const f = c.persp ? CAM_DIST / Math.max(0.2, CAM_DIST + d) : 1;
  const o = out ?? { x: 0, y: 0, d: 0, f: 1 };
  o.x = c.cx + c.scale * sx * f;
  o.y = c.cy - c.scale * sy * f;
  o.d = d;
  o.f = f;
  return o;
}

/** Back to front: indices of `depths` in descending depth (the farthest first); ties keep input order. */
export function depthOrder(depths: ArrayLike<number>): number[] {
  const idx = Array.from({ length: depths.length }, (_, i) => i);
  idx.sort((a, b) => depths[b] - depths[a] || a - b);
  return idx;
}

/** Whether a face with outward normal `n` (world) through world point `p` faces the camera. */
export function faceVisible(c: Cam, p: [number, number, number], n: [number, number, number]): boolean {
  const m = c.m;
  const nd = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
  if (!c.persp) return nd < -1e-9;
  // perspective: the camera sits at view-space (0, 0, -CAM_DIST); compare the normal with the direction to it
  const nx = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
  const ny = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
  const px = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
  const py = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
  const pd = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
  return nx * -px + ny * -py + nd * (-CAM_DIST - pd) > 1e-9;
}

/* ------------------------------------------------------------------- box */

/** Half extents of the box: the scene spans [-bx/2, bx/2] x [-by/2, by/2] x [-bz/2, bz/2]. */
export interface Box3 {
  bx: number;
  by: number;
  bz: number;
}

export const boxRadius = (b: Box3): number => 0.5 * Math.sqrt(b.bx * b.bx + b.by * b.by + b.bz * b.bz);

/** Corner i has x = bit 0, y = bit 1, z = bit 2 (0 = low, 1 = high). */
export const corner = (b: Box3, i: number): [number, number, number] => [(i & 1 ? 0.5 : -0.5) * b.bx, (i & 2 ? 0.5 : -0.5) * b.by, (i & 4 ? 0.5 : -0.5) * b.bz];

export interface Face3 {
  axis: 0 | 1 | 2;
  /** -1 = low side, +1 = high side */
  sign: -1 | 1;
  normal: [number, number, number];
  centre: [number, number, number];
}

export function boxFaces(b: Box3): Face3[] {
  const half = [b.bx / 2, b.by / 2, b.bz / 2];
  const out: Face3[] = [];
  for (const axis of [0, 1, 2] as const)
    for (const sign of [-1, 1] as const) {
      const normal: [number, number, number] = [0, 0, 0];
      normal[axis] = sign;
      const centre: [number, number, number] = [0, 0, 0];
      centre[axis] = sign * half[axis];
      out.push({ axis, sign, normal, centre });
    }
  return out;
}

/** Faces turned away from the camera: the back walls that carry the gridlines. */
export function backFaces(c: Cam, b: Box3): Face3[] {
  return boxFaces(b).filter((f) => !faceVisible(c, f.centre, f.normal));
}

export interface Edge3 {
  /** the axis the edge runs along */
  axis: 0 | 1 | 2;
  /** position on the two other axes (-1 / +1), in ascending axis order */
  at: [-1 | 1, -1 | 1];
  a: number;
  b: number;
}

/** The 12 edges of the box. */
export function boxEdges(): Edge3[] {
  const out: Edge3[] = [];
  for (const axis of [0, 1, 2] as const) {
    const others = ([0, 1, 2] as const).filter((k) => k !== axis);
    for (const s0 of [-1, 1] as const)
      for (const s1 of [-1, 1] as const) {
        let a = 0;
        if (s0 > 0) a |= 1 << others[0];
        if (s1 > 0) a |= 1 << others[1];
        out.push({ axis, at: [s0, s1], a, b: a | (1 << axis) });
      }
  }
  return out;
}

/** Whether the edge touches only front faces (it is drawn over the data) rather than the silhouette or a back wall. */
export function edgeInFront(c: Cam, b: Box3, e: Edge3): boolean {
  const others = ([0, 1, 2] as const).filter((k) => k !== e.axis);
  const half = [b.bx / 2, b.by / 2, b.bz / 2];
  return others.every((ax, i) => {
    const normal: [number, number, number] = [0, 0, 0];
    normal[ax] = e.at[i];
    const centre: [number, number, number] = [0, 0, 0];
    centre[ax] = e.at[i] * half[ax];
    return faceVisible(c, centre, normal);
  });
}

/** Where tick labels go: for x and y the floor-side edge that lies lowest on screen, for z the leftmost
    vertical edge.  Returned as the signs of the two other axes. */
export function pickAxisEdges(view: Required<View3d>): { x: [-1 | 1, -1 | 1]; y: [-1 | 1, -1 | 1]; z: [-1 | 1, -1 | 1] } {
  const cam = makeCam(view, 100, 100, 1);
  const m = cam.m;
  const screenY = (x: number, y: number, z: number) => m[3] * x + m[4] * y + m[5] * z;
  const screenX = (x: number, y: number, z: number) => m[0] * x + m[1] * y + m[2] * z;
  const depth = (x: number, y: number, z: number) => m[6] * x + m[7] * y + m[8] * z;
  const edges = boxEdges();
  const pick = (axis: 0 | 1 | 2, score: (mid: [number, number, number]) => number): [-1 | 1, -1 | 1] => {
    let best: Edge3 | null = null;
    let bestScore = -Infinity;
    for (const e of edges) {
      if (e.axis !== axis) continue;
      const mid: [number, number, number] = [0, 0, 0];
      const others = ([0, 1, 2] as const).filter((k) => k !== axis);
      mid[others[0]] = e.at[0];
      mid[others[1]] = e.at[1];
      const s = score(mid);
      if (s > bestScore + 1e-9) (best = e), (bestScore = s);
    }
    return best!.at;
  };
  // lowest on screen, nearer wins a tie
  const lowest = (mid: [number, number, number]) => -screenY(...mid) * 10 - depth(...mid);
  const leftmost = (mid: [number, number, number]) => -screenX(...mid) * 10 - depth(...mid);
  return { x: pick(0, lowest), y: pick(1, lowest), z: pick(2, leftmost) };
}

/** Indices of the labels to keep so that neighbouring ones are at least `minGap` pixels apart: the smallest
    even stride that works, so the picked ticks stay regular. */
export function thinByGap(pos: { x: number; y: number }[], minGap: number): number[] {
  for (let k = 1; k <= pos.length; k++) {
    const idx: number[] = [];
    let ok = true;
    for (let i = 0; i < pos.length; i += k) {
      const last = idx.length ? pos[idx[idx.length - 1]] : null;
      if (last && Math.hypot(pos[i].x - last.x, pos[i].y - last.y) < minGap) {
        ok = false;
        break;
      }
      idx.push(i);
    }
    if (ok) return idx;
  }
  return pos.length ? [0] : [];
}

/* --------------------------------------------------------- data helpers */

/** `max` items spread evenly over `n` (always the first and last when max >= 2). */
export function evenIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  if (max < 2) return [0];
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(Math.round((i * (n - 1)) / (max - 1)));
  return out;
}

/** Least squares plane z = a + b x + c y.  null when fewer than 3 points or the points are collinear. */
export interface PlaneFit {
  a: number;
  b: number;
  c: number;
  r2: number | null;
}

export function fitPlane(pts: { x: number; y: number; z: number }[]): PlaneFit | null {
  const n = pts.length;
  if (n < 3) return null;
  // centre the data for conditioning, then solve the 2x2 normal equations for (b, c)
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of pts) (mx += p.x), (my += p.y), (mz += p.z);
  mx /= n;
  my /= n;
  mz /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  let szz = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const dz = p.z - mz;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxz += dx * dz;
    syz += dy * dz;
    szz += dz * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(Math.abs(det) > 1e-12 * Math.max(1, sxx * syy))) return null;
  const b = (sxz * syy - syz * sxy) / det;
  const c = (syz * sxx - sxz * sxy) / det;
  const a = mz - b * mx - c * my;
  // explained sum of squares of the fit: b*sxz + c*syz
  const r2 = szz > 0 ? clampNum((b * sxz + c * syz) / szz, 0, 1) : null;
  return { a, b, c, r2 };
}

/** The plane clipped to the box [x0,x1] x [y0,y1] x [z0,z1]: a convex polygon in world data coordinates (empty if it misses). */
export function clipPlane(f: PlaneFit, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): [number, number, number][] {
  let poly: [number, number, number][] = [
    [x0, y0, f.a + f.b * x0 + f.c * y0],
    [x1, y0, f.a + f.b * x1 + f.c * y0],
    [x1, y1, f.a + f.b * x1 + f.c * y1],
    [x0, y1, f.a + f.b * x0 + f.c * y1],
  ];
  // Sutherland-Hodgman against z >= z0 and z <= z1, intersecting along the polygon edges (the plane stays flat)
  const clip = (keep: (p: [number, number, number]) => number) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = keep(p);
      const dq = keep(q);
      if (dp >= 0) out.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        const x = p[0] + t * (q[0] - p[0]);
        const y = p[1] + t * (q[1] - p[1]);
        out.push([x, y, f.a + f.b * x + f.c * y]);
      }
    }
    poly = out;
  };
  clip((p) => p[2] - z0);
  clip((p) => z1 - p[2]);
  return poly;
}

/** Sequential colour step 0..steps-1 for a value in [lo, hi]. */
export function rampStep(v: number, lo: number, hi: number, steps: number): number {
  if (!(hi > lo)) return 0;
  return clampNum(Math.floor(((v - lo) / (hi - lo)) * steps), 0, steps - 1);
}

/** Mix percentage of the accent for ramp step `i` of `steps` (never fully pale, so low values stay visible). */
export const rampMix = (i: number, steps: number): number => Math.round(26 + (74 * i) / Math.max(1, steps - 1));

export const rampCss = (i: number, steps: number, accent = 'var(--c-series-1)'): string => `color-mix(in srgb, ${accent} ${rampMix(i, steps)}%, var(--c-surface))`;

/** Loop order of a regular grid for the painter's algorithm: for each of the two grid axes, whether to
    iterate from the high index down (the far side first).  Exact for height fields. */
export function gridOrder(c: Cam): { xDesc: boolean; yDesc: boolean } {
  return { xDesc: c.m[6] > 0, yDesc: c.m[7] > 0 };
}
