/* Defensive parsing of the phase 4 studio-only chart types (bubble, mosaic, radar, waterfall, forest, treemap).
   The shapes are declared in studioTypes.ts.  SPDX-License-Identifier: GPL-3.0-or-later */

import type { BubbleSpec, ForestSpec, MosaicSpec, RadarSpec, TreemapSpec, WaterfallSpec } from './studioTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v));

/** Upper limits keep a hostile or huge definition from freezing the page. */
export const MAX_BUBBLES = 5000;
export const MAX_TILES = 600;
export const MAX_ROWS = 300;
export const MAX_STEPS = 200;
export const MAX_AXES = 40;
export const MAX_SERIES = 12;
export const MAX_MOSAIC = 60;

export function parseBubble(c: Obj, title: string): BubbleSpec {
  const points: BubbleSpec['points'] = [];
  for (const p of arr(c.points)) {
    if (!isObj(p) || points.length >= MAX_BUBBLES) continue;
    const x = num(p.x);
    const y = num(p.y);
    const size = num(p.size);
    if (x === null || y === null || size === null) continue;
    const label = str(p.label);
    points.push({ x, y, size, group: strOrNull(p.group), ...(label ? { label } : {}) });
  }
  return { type: 'bubble', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), sizeLabel: str(c.sizeLabel), ...(str(c.byvar) ? { byvar: str(c.byvar) } : {}), points };
}

export function parseMosaic(c: Obj, title: string): MosaicSpec {
  const xs = arr(c.xs).map(str).slice(0, MAX_MOSAIC);
  const ys = arr(c.ys).map(str).slice(0, MAX_MOSAIC);
  const counts = ys.map((_, yi) => xs.map((_, xi) => Math.max(0, num(arr(arr(c.counts)[yi])[xi]) ?? 0)));
  return { type: 'mosaic', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), xs, ys, counts, shade: c.shade === true };
}

export function parseRadar(c: Obj, title: string): RadarSpec {
  const axes = arr(c.axes).map(str).slice(0, MAX_AXES);
  const series = arr(c.series)
    .filter(isObj)
    .slice(0, MAX_SERIES)
    .map((s) => ({ name: str(s.name), values: axes.map((_, i) => num(arr(s.values)[i])) }));
  const min = num(c.min);
  const max = num(c.max);
  // an inverted explicit range is ignored
  const ok = min === null || max === null || max > min;
  return { type: 'radar', title, axes, series, min: ok ? min : null, max: ok ? max : null };
}

export function parseWaterfall(c: Obj, title: string): WaterfallSpec {
  const steps: WaterfallSpec['steps'] = [];
  for (const s of arr(c.steps)) {
    if (!isObj(s) || steps.length >= MAX_STEPS) continue;
    const total = s.total === true;
    const value = num(s.value);
    // a total step needs no value
    if (value === null && !total) continue;
    steps.push({ label: str(s.label), value: value ?? 0, ...(total ? { total: true } : {}) });
  }
  return { type: 'waterfall', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), steps };
}

export function parseForest(c: Obj, title: string): ForestSpec {
  const rows: ForestSpec['rows'] = [];
  for (const r of arr(c.rows)) {
    if (!isObj(r) || rows.length >= MAX_ROWS) continue;
    const est = num(r.est);
    const a = num(r.lo);
    const b = num(r.hi);
    if (est === null || a === null || b === null) continue;
    const w = num(r.weight);
    rows.push({ label: str(r.label), est, lo: Math.min(a, b), hi: Math.max(a, b), weight: w !== null && w > 0 ? w : null, group: strOrNull(r.group) || null });
  }
  return { type: 'forest', title, xlabel: str(c.xlabel), refValue: num(c.refValue) ?? (c.log === true ? 1 : 0), log: c.log === true, rows };
}

export function parseTreemap(c: Obj, title: string): TreemapSpec {
  const tiles: TreemapSpec['tiles'] = [];
  for (const t of arr(c.tiles)) {
    if (!isObj(t) || tiles.length >= MAX_TILES) continue;
    const value = num(t.value);
    // tiles without area cannot be drawn
    if (value === null || value <= 0) continue;
    tiles.push({ label: str(t.label), value, group: strOrNull(t.group) || null });
  }
  return { type: 'treemap', title, tiles };
}
