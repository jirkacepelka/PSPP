/* Parsing of `chart.style` (ChartStyle, see studioTypes.ts) from untrusted JSON, plus the pure
   helpers that apply an axis override.  SPDX-License-Identifier: GPL-3.0-or-later */

import type { Annotation, ChartStyle, RefLine } from './studioTypes';
import { ticksWithin, type Ticks } from './scale';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : undefined);

/** A CSS colour we are willing to hand to the style system: no declarations, no url(). */
export function safeColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 80 || /[;{}<>\\]|url\(|expression\(/i.test(s)) return null;
  return s;
}

/** Axis bound: a finite number, or explicit null ("automatic"), or absent. */
const bound = (v: unknown): number | null | undefined => (v === null ? null : fin(v));

export function parseStyle(input: unknown): ChartStyle | undefined {
  if (!isObj(input)) return undefined;
  const s: ChartStyle = {};
  const title = text(input.title);
  if (title !== undefined) s.title = title;
  const subtitle = text(input.subtitle);
  if (subtitle !== undefined) s.subtitle = subtitle;
  const xTitle = text(input.xTitle);
  if (xTitle !== undefined) s.xTitle = xTitle;
  const yTitle = text(input.yTitle);
  if (yTitle !== undefined) s.yTitle = yTitle;
  const zTitle = text(input.zTitle);
  if (zTitle !== undefined) s.zTitle = zTitle;
  if (typeof input.showTitle === 'boolean') s.showTitle = input.showTitle;
  if (input.legend === 'auto' || input.legend === 'none') s.legend = input.legend;
  const legendTitle = text(input.legendTitle);
  if (legendTitle !== undefined) s.legendTitle = legendTitle;
  if (Array.isArray(input.palette)) s.palette = input.palette.slice(0, 8).map(safeColor);
  if (typeof input.grid === 'boolean') s.grid = input.grid;
  for (const k of ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const) {
    const b = bound(input[k]);
    if (b !== undefined) s[k] = b;
  }
  if (Array.isArray(input.refLines)) {
    const lines: RefLine[] = [];
    for (const l of input.refLines) {
      if (!isObj(l)) continue;
      const value = fin(l.value);
      if (value === undefined || (l.axis !== 'x' && l.axis !== 'y')) continue;
      const line: RefLine = { axis: l.axis, value };
      const label = text(l.label);
      if (label) line.label = label;
      if (l.color === null) line.color = null;
      else if (safeColor(l.color)) line.color = safeColor(l.color);
      if (typeof l.dash === 'boolean') line.dash = l.dash;
      lines.push(line);
    }
    s.refLines = lines;
  }
  if (Array.isArray(input.annotations)) {
    const notes: Annotation[] = [];
    for (const a of input.annotations) {
      if (!isObj(a)) continue;
      const x = fin(a.x);
      const y = fin(a.y);
      const t = text(a.text);
      if (x !== undefined && y !== undefined && t) notes.push({ x, y, text: t });
    }
    s.annotations = notes;
  }
  if (typeof input.valueLabels === 'boolean') s.valueLabels = input.valueLabels;
  const fs = fin(input.fontScale);
  if (fs !== undefined && fs > 0) s.fontScale = Math.min(2, Math.max(0.6, fs));
  return s;
}

export const fontScaleOf = (s?: ChartStyle): number => s?.fontScale ?? 1;

/** Apply an axis min/max override to ticks computed from the data. Without an override the
    ticks are returned unchanged; with one, the domain is exactly the requested range. */
export function applyDomain(t: Ticks, lo: number | null | undefined, hi: number | null | undefined, count: number): Ticks {
  const a = lo ?? t.domain[0];
  const b = hi ?? t.domain[1];
  if ((lo == null && hi == null) || !(a < b)) return t;
  return ticksWithin(a, b, count);
}
