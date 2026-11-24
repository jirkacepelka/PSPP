/* Defensive parsing of the studio-only chart types (area, dot, pareto, matrix, heatmap, pyramid).
   The shapes are declared in studioTypes.ts.  SPDX-License-Identifier: GPL-3.0-or-later */

import type { AreaSpec, DotSpec, HeatmapSpec, MatrixSpec, ParetoSpec, PyramidSpec } from './studioTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v));

export function parseArea(c: Obj, title: string): AreaSpec {
  const categories = arr(c.categories).map(str);
  const n = categories.length;
  return {
    type: 'area',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    legendTitle: str(c.legendTitle),
    categories,
    stack: c.stack === 'stack' || c.stack === 'stack100' ? c.stack : 'none',
    series: arr(c.series)
      .filter(isObj)
      .map((s) => ({ name: str(s.name), values: Array.from({ length: n }, (_, i) => num(arr(s.values)[i])) })),
  };
}

export function parseDot(c: Obj, title: string): DotSpec {
  return {
    type: 'dot',
    title,
    xlabel: str(c.xlabel),
    bins: arr(c.bins)
      .filter(isObj)
      .flatMap((b) => {
        const x = num(b.x);
        const count = num(b.count);
        return x === null || count === null || count < 0 ? [] : [{ x, count: Math.floor(count), group: strOrNull(b.group) }];
      }),
  };
}

export function parsePareto(c: Obj, title: string): ParetoSpec {
  const bars = arr(c.bars)
    .filter(isObj)
    .map((b) => ({ label: str(b.label), count: Math.max(0, num(b.count) ?? 0) }));
  const total = num(c.total);
  return { type: 'pareto', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), bars, total: total !== null && total > 0 ? total : bars.reduce((s, b) => s + b.count, 0) };
}

export function parseMatrix(c: Obj, title: string): MatrixSpec {
  const vars = arr(c.vars).map(str).slice(0, 6);
  const k = vars.length;
  const rows: (number | null)[][] = [];
  const groups: (string | null)[] = [];
  const rawG = Array.isArray(c.groups) ? c.groups : null;
  arr(c.rows).forEach((r, i) => {
    const a = arr(r);
    rows.push(Array.from({ length: k }, (_, j) => num(a[j])));
    groups.push(rawG ? strOrNull(rawG[i]) : null);
  });
  return { type: 'matrix', title, vars, rows, groups: rawG ? groups : null, byvar: typeof c.byvar === 'string' ? c.byvar : null };
}

export function parseHeatmap(c: Obj, title: string): HeatmapSpec {
  const edges = (v: unknown) => arr(v).map(num).filter((x): x is number => x !== null);
  const xEdges = edges(c.xEdges);
  const yEdges = edges(c.yEdges);
  const nx = Math.max(0, xEdges.length - 1);
  const ny = Math.max(0, yEdges.length - 1);
  const counts = Array.from({ length: ny }, (_, yi) => Array.from({ length: nx }, (_, xi) => Math.max(0, num(arr(arr(c.counts)[yi])[xi]) ?? 0)));
  return { type: 'heatmap', title, xlabel: str(c.xlabel), ylabel: str(c.ylabel), xEdges, yEdges, counts };
}

export function parsePyramid(c: Obj, title: string): PyramidSpec {
  const bins: PyramidSpec['bins'] = [];
  for (const b of arr(c.bins)) {
    const a = arr(b);
    const lo = num(a[0]);
    const hi = num(a[1]);
    if (lo !== null && hi !== null) bins.push([lo, hi, Math.max(0, num(a[2]) ?? 0), Math.max(0, num(a[3]) ?? 0)]);
  }
  return { type: 'pyramid', title, xlabel: str(c.xlabel), leftName: str(c.leftName), rightName: str(c.rightName), bins };
}
