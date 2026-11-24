/* Defensive parsing of the 3D chart types (scatter3d, bar3d, surface3d) and of `chart.view3d`.
   The shapes are declared in studioTypes.ts.  SPDX-License-Identifier: GPL-3.0-or-later */

import { normalizeView } from './proj3d';
import type { Bar3dSpec, Scatter3dSpec, Surface3dSpec, View3d } from './studioTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Hard limits against hostile or accidental huge input (the renderers decimate further for drawing). */
export const MAX_POINTS_3D = 200000;
export const MAX_GRID_3D = 400;

/** `chart.view3d`: undefined when absent or not an object, otherwise a complete, clamped view. */
export function parseView3d(v: unknown): Required<View3d> | undefined {
  if (!isObj(v)) return undefined;
  return normalizeView({ azimuth: num(v.azimuth) ?? undefined, elevation: num(v.elevation) ?? undefined, perspective: typeof v.perspective === 'boolean' ? v.perspective : undefined, zoom: num(v.zoom) ?? undefined });
}

export function parseScatter3d(c: Obj, title: string): Scatter3dSpec {
  const points: Scatter3dSpec['points'] = [];
  for (const p of arr(c.points)) {
    if (!isObj(p)) continue;
    const x = num(p.x);
    const y = num(p.y);
    const z = num(p.z);
    if (x === null || y === null || z === null) continue;
    points.push({ x, y, z, group: p.group === null || p.group === undefined ? null : str(p.group) });
    if (points.length >= MAX_POINTS_3D) break;
  }
  return {
    type: 'scatter3d',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    zlabel: str(c.zlabel),
    points,
    fit: c.fit === 'plane' ? 'plane' : 'none',
    groupLabel: typeof c.groupLabel === 'string' ? str(c.groupLabel) : null,
  };
}

export function parseBar3d(c: Obj, title: string): Bar3dSpec {
  const xs = arr(c.xs).slice(0, MAX_GRID_3D).map(str);
  const ys = arr(c.ys).slice(0, MAX_GRID_3D).map(str);
  const rows = arr(c.values);
  const values = ys.map((_, yi) => xs.map((__, xi) => num(arr(rows[yi])[xi])));
  return { type: 'bar3d', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), zlabel: str(c.zlabel), xs, ys, values };
}

export function parseSurface3d(c: Obj, title: string): Surface3dSpec {
  // axis values must be finite and strictly increasing; anything else falls back to the index
  const axis = (v: unknown): number[] => {
    const raw = arr(v).slice(0, MAX_GRID_3D);
    const nums = raw.map(num);
    const ok = nums.every((x) => x !== null) && nums.every((x, i) => i === 0 || (x as number) > (nums[i - 1] as number));
    return ok ? (nums as number[]) : raw.map((_, i) => i);
  };
  const xs = axis(c.xs);
  const ys = axis(c.ys);
  const rows = arr(c.z);
  const z = ys.map((_, yi) => xs.map((__, xi) => num(arr(rows[yi])[xi])));
  return { type: 'surface3d', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), zlabel: str(c.zlabel), xs, ys, z };
}
