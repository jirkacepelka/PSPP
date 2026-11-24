/* Defensive parsing of the phase 2 studio chart types (high-low, dual axis, probability plot, sequence,
   control, density, violin, panels).  The shapes are declared in studioTypes.ts.
   SPDX-License-Identifier: GPL-3.0-or-later */

import { parseXValues } from './xvalues';
import type { ControlSpec, DensitySpec, DualAxisSpec, HighLowSpec, PanelsSpec, ProbPlotSpec, SequenceSpec, ViolinSpec } from './studioTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A list padded or cut to `n` entries, bad values as null. */
const nums = (v: unknown, n: number): (number | null)[] => Array.from({ length: n }, (_, i) => num(arr(v)[i]));

/** Points [a, b] with both finite; everything else is dropped. */
function pairs(v: unknown): [number, number][] {
  const out: [number, number][] = [];
  for (const p of arr(v)) {
    const a = arr(p);
    const x = num(a[0]);
    const y = num(a[1]);
    if (x !== null && y !== null) out.push([x, y]);
  }
  return out;
}

export function parseHighLow(c: Obj, title: string): HighLowSpec {
  const categories = arr(c.categories).map(str);
  const n = categories.length;
  const close = Array.isArray(c.close) ? nums(c.close, n) : null;
  return {
    type: 'highlow',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    mode: c.mode === 'range' || c.mode === 'diff' ? c.mode : 'hlc',
    categories,
    ...(parseXValues(c.xValues, n) ? { xValues: parseXValues(c.xValues, n) } : {}),
    high: nums(c.high, n),
    low: nums(c.low, n),
    close,
  };
}

function side(v: unknown, n: number): DualAxisSpec['left'] {
  const o = isObj(v) ? v : {};
  return { name: str(o.name), ylabel: str(o.ylabel), kind: o.kind === 'line' ? 'line' : 'bar', values: nums(o.values, n) };
}

export function parseDualAxis(c: Obj, title: string): DualAxisSpec {
  const categories = arr(c.categories).map(str);
  return { type: 'dualaxis', title, xlabel: str(c.xlabel), categories, left: side(c.left, categories.length), right: side(c.right, categories.length) };
}

export function parseProbPlot(c: Obj, title: string): ProbPlotSpec {
  const ref = arr(c.reference);
  const a = arr(ref[0]);
  const b = arr(ref[1]);
  const [ax, ay, bx, by] = [num(a[0]), num(a[1]), num(b[0]), num(b[1])];
  const reference = ax !== null && ay !== null && bx !== null && by !== null && (ax !== bx || ay !== by) ? ([[ax, ay], [bx, by]] as [[number, number], [number, number]]) : null;
  return {
    type: 'probplot',
    title,
    mode: c.mode === 'pp' ? 'pp' : 'qq',
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    points: pairs(c.points).sort((p, q) => p[0] - q[0]),
    reference,
  };
}

export function parseSequence(c: Obj, title: string): SequenceSpec {
  const x = arr(c.x).map(num);
  // keep only positions with a finite x; every series follows the same positions
  const keep = x.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  return {
    type: 'sequence',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    ...(c.xFormat === 'date' ? { xFormat: 'date' as const } : c.xFormat === 'number' ? { xFormat: 'number' as const } : {}),
    x: keep.map((i) => x[i] as number),
    series: arr(c.series)
      .filter(isObj)
      .map((s) => ({ name: str(s.name), values: keep.map((i) => num(arr(s.values)[i])), ...(s.dash === true ? { dash: true } : {}) })),
    ...(Array.isArray(c.bands)
      ? {
          bands: arr(c.bands)
            .filter(isObj)
            .slice(0, 12)
            .map((b) => {
              const ref = num(b.series);
              return {
                name: str(b.name),
                lo: keep.map((i) => num(arr(b.lo)[i])),
                hi: keep.map((i) => num(arr(b.hi)[i])),
                ...(ref !== null && ref >= 0 ? { series: Math.floor(ref) } : {}),
              };
            }),
        }
      : {}),
  };
}

export function parseControl(c: Obj, title: string): ControlSpec {
  const values = arr(c.values).map(num);
  const n = values.length;
  const center = num(c.center) ?? (values.filter((v): v is number => v !== null).reduce((s, v, _i, a) => s + v / a.length, 0) || 0);
  const limit = (v: unknown, fallback: number) => Array.from({ length: n }, (_, i) => num(arr(v)[i]) ?? fallback);
  const ucl = limit(c.ucl, center);
  const lcl = limit(c.lcl, center);
  return {
    type: 'control',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    labels: Array.from({ length: n }, (_, i) => (arr(c.labels)[i] !== undefined ? str(arr(c.labels)[i]) : String(i + 1))),
    values,
    center,
    ucl,
    lcl,
    // a flag is only trusted when the point exists; a missing flags list is computed from the limits
    flags: Array.isArray(c.flags) ? Array.from({ length: n }, (_, i) => values[i] !== null && arr(c.flags)[i] === true) : values.map((v, i) => v !== null && (v > ucl[i] || v < lcl[i])),
  };
}

export function parseDensity(c: Obj, title: string): DensitySpec {
  return {
    type: 'density',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    curves: arr(c.curves)
      .filter(isObj)
      .map((cv) => ({ name: str(cv.name), points: pairs(cv.points).sort((p, q) => p[0] - q[0]) })),
    fill: c.fill !== false,
    ...(c.layout === 'ridge' || c.layout === 'overlay' ? { layout: c.layout } : {}),
  };
}

export function parseViolin(c: Obj, title: string): ViolinSpec {
  return {
    type: 'violin',
    title,
    ylabel: str(c.ylabel),
    violins: arr(c.violins)
      .filter(isObj)
      .flatMap((v) => {
        const points = pairs(v.points)
          .map(([y, d]): [number, number] => [y, Math.max(0, d)])
          .sort((p, q) => p[0] - q[0]);
        const median = num(v.median);
        const q1 = num(v.q1);
        const q3 = num(v.q3);
        if (points.length < 2 || median === null || q1 === null || q3 === null) return [];
        return [{ label: str(v.label), points, median, q1: Math.min(q1, q3), q3: Math.max(q1, q3) }];
      }),
  };
}

const MAX_PANELS = 36;

export function parsePanels(c: Obj, title: string): PanelsSpec {
  const panels: PanelsSpec['panels'] = [];
  for (const p of arr(c.panels)) {
    if (!isObj(p) || panels.length >= MAX_PANELS) continue;
    const inner = isObj(p.chart) && isObj(p.chart.chart) ? p.chart.chart : p.chart;
    // panels do not nest
    if (!isObj(inner) || inner.type === 'panels') continue;
    panels.push({ title: str(p.title), chart: p.chart });
  }
  const cols = num(c.columns);
  return { type: 'panels', title, columns: cols !== null && cols >= 1 ? Math.min(6, Math.floor(cols)) : 2, sharedAxes: c.sharedAxes === true, panels };
}
