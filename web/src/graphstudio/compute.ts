/*
 * Graph Studio computation: GraphDef + Dataset -> chart JSON (the specs of src/charts), computed in
 * the browser. Pure and synchronous. Honours FILTER and WEIGHT of the dataset (frequency weights),
 * excludes cases with a missing value on any charted variable (listwise, per chart) and reports
 * what it did in `info` and `notes` so the UI can say it.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef } from '../charts/studioTypes';
import { activeRows, caseCount, isMissing, valueText, varTitle, weights, type Cell } from '../ext/data';
import { tInv } from '../ext/dist';
import { needsVariable, slotsOf, missingSlots } from './model';

export type Tf = (key: string, args?: Record<string, unknown>) => string;

export interface ComputeInfo {
  /** cases in the dataset */
  total: number;
  /** cases drawn */
  used: number;
  /** sum of weights of the drawn cases */
  usedWeight: number;
  /** cases dropped because a charted variable is missing */
  excluded: number;
  /** cases dropped by the dataset filter or a zero/missing weight */
  filtered: number;
  filter: string | null;
  weight: string | null;
}

export type ComputeResult =
  | { ok: true; chart: Record<string, unknown>; info: ComputeInfo; notes: string[] }
  | { ok: false; reason: 'missing'; slots: string[] }
  | { ok: false; reason: 'novar'; names: string[] }
  | { ok: false; reason: 'nodata' };

/* ------------------------------------------------------------------ numeric helpers */

export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

const roundTo = (x: number, dec: number) => Number(x.toFixed(dec));

/** Bin edges covering [min, max] with a nice step; WIDTH forces a step. The last bin is closed. */
export function binEdges(min: number, max: number, wanted: number, opts: { width?: number | null; integer?: boolean } = {}): number[] {
  if (!(max > min)) return [min - 0.5, min + 0.5];
  let step = opts.width && opts.width > 0 ? opts.width : niceStep((max - min) / Math.max(1, wanted));
  if (opts.integer && step < 1) step = 1;
  const dec = Math.min(10, Math.max(0, 1 - Math.floor(Math.log10(step))));
  const start = Math.floor(min / step + 1e-9) * step;
  const edges = [roundTo(start, dec)];
  let i = 1;
  while (edges[edges.length - 1] < max - 1e-9 * step && i < 500) edges.push(roundTo(start + i++ * step, dec));
  if (edges.length < 2) edges.push(roundTo(start + step, dec));
  return edges;
}

/** Index of the bin holding X (the last bin is closed on the right). */
export function binIndex(edges: number[], x: number): number {
  if (x < edges[0] || x > edges[edges.length - 1]) return -1;
  let lo = 0;
  let hi = edges.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
}

/** Bin count by rule: Freedman-Diaconis (default), Sturges, or a fixed count. */
export function binCountByRule(sorted: number[], rule: string, fixed: number): number {
  const n = sorted.length;
  const sturges = Math.ceil(Math.log2(Math.max(n, 1)) + 1);
  if (rule === 'count') return Math.max(2, Math.min(200, Math.round(fixed) || 10));
  if (rule === 'fd' && n > 3) {
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    const width = (2 * iqr) / Math.cbrt(n);
    if (width > 0) return Math.max(2, Math.min(100, Math.ceil((sorted[n - 1] - sorted[0]) / width)));
  }
  return Math.max(2, Math.min(100, sturges));
}

export interface Obs {
  y: number;
  w: number;
}

export type Summary = 'mean' | 'median' | 'sum' | 'min' | 'max' | 'sd';

const sumW = (vals: Obs[]) => vals.reduce((s, p) => s + p.w, 0);

/** Weighted summary of VALS (frequency weights); null when it is undefined. */
export function summarize(func: Summary, vals: Obs[]): number | null {
  const W = sumW(vals);
  if (!vals.length || W <= 0) return null;
  switch (func) {
    case 'mean':
      return vals.reduce((s, p) => s + p.y * p.w, 0) / W;
    case 'sum':
      return vals.reduce((s, p) => s + p.y * p.w, 0);
    case 'min':
      return Math.min(...vals.map((p) => p.y));
    case 'max':
      return Math.max(...vals.map((p) => p.y));
    case 'sd': {
      if (W <= 1) return null;
      const m = vals.reduce((s, p) => s + p.y * p.w, 0) / W;
      return Math.sqrt(vals.reduce((s, p) => s + p.w * (p.y - m) ** 2, 0) / (W - 1));
    }
    case 'median': {
      const s = [...vals].sort((a, b) => a.y - b.y);
      let c = 0;
      for (let i = 0; i < s.length; i++) {
        c += s[i].w;
        if (Math.abs(c - W / 2) < 1e-9 && i + 1 < s.length) return (s[i].y + s[i + 1].y) / 2;
        if (c > W / 2) return s[i].y;
      }
      return s[s.length - 1].y;
    }
  }
}

/** Half width of the interval around the mean of VALS: CI (t distribution, LEVEL percent), SE or SD multiples. */
export function intervalHalf(kind: 'ci' | 'se' | 'sd', level: number, mult: number, vals: Obs[]): number | null {
  const W = sumW(vals);
  const sd = summarize('sd', vals);
  if (sd === null || W <= 1) return null;
  const se = sd / Math.sqrt(W);
  if (kind === 'ci') return tInv(1 - (1 - level / 100) / 2, W - 1) * se;
  return kind === 'se' ? mult * se : mult * sd;
}

/* ------------------------------------------------------------------ data access */

interface Col {
  v: Variable;
  col: Cell[];
}

interface Prepared {
  rows: number[];
  w: number[];
  cols: Record<string, Col[]>;
  info: ComputeInfo;
}

const keyOf = (x: Cell) => (typeof x === 'number' ? `n${x}` : `s${String(x).trimEnd()}`);
const cmpCells = (a: Cell, b: Cell) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

interface CatSet {
  labels: string[];
  /** category index per row (parallel to the rows array), -1 when none */
  idx: number[];
  /** raw value of each category */
  cells: Cell[];
}

/** Categories of column C over ROWS, ordered by value and named by value labels. */
function categories(c: Col, rows: number[]): CatSet {
  const uniq = new Map<string, Cell>();
  for (const r of rows) uniq.set(keyOf(c.col[r]), c.col[r]);
  const cells = [...uniq.values()].sort(cmpCells);
  const index = new Map(cells.map((x, i) => [keyOf(x), i]));
  return { cells, labels: cells.map((x) => valueText(c.v, x)), idx: rows.map((r) => index.get(keyOf(c.col[r])) ?? -1) };
}

function prepare(def: GraphDef, ds: Dataset): Prepared | ComputeResult {
  const slots = slotsOf(def);
  const missing = missingSlots(def);
  if (missing.length) return { ok: false, reason: 'missing', slots: missing.map((s) => s.id) };
  const cols: Record<string, Col[]> = {};
  const unknown: string[] = [];
  for (const s of slots) {
    cols[s.id] = [];
    for (const name of def.bind[s.id] ?? []) {
      const i = ds.variables.findIndex((x) => x.name.toUpperCase() === name.toUpperCase());
      if (i < 0) unknown.push(name);
      else cols[s.id].push({ v: ds.variables[i], col: (ds.columns[i] ?? []) as Cell[] });
    }
  }
  if (unknown.length) return { ok: false, reason: 'novar', names: unknown };
  let active: number[];
  let w: number[];
  try {
    active = activeRows(ds);
    w = weights(ds);
  } catch {
    active = Array.from({ length: caseCount(ds) }, (_, r) => r);
    w = new Array(active.length).fill(1);
  }
  const all = Object.values(cols).flat();
  const rows = active.filter((r) => all.every((c) => !isMissing(c.v, c.col[r])));
  const total = caseCount(ds);
  const info: ComputeInfo = {
    total,
    used: rows.length,
    usedWeight: rows.reduce((s, r) => s + w[r], 0),
    excluded: active.length - rows.length,
    filtered: total - active.length,
    filter: ds.filter ?? null,
    weight: ds.weight ?? null,
  };
  if (!rows.length) return { ok: false, reason: 'nodata' };
  return { rows, w, cols, info };
}

const isPrepared = (p: Prepared | ComputeResult): p is Prepared => 'rows' in p;
const num = (c: Col, r: number) => c.col[r] as number;
const optNum = (def: GraphDef, id: string, d: number): number => {
  const x = def.options[id];
  return typeof x === 'number' && Number.isFinite(x) ? x : d;
};
const optStr = (def: GraphDef, id: string, d: string): string => (typeof def.options[id] === 'string' ? (def.options[id] as string) : d);

function funcLabel(t: Tf, func: string, v?: Col): string {
  const f = t(`graphstudio.func.${func}`);
  return v ? `${f} ${varTitle(v.v)}` : f;
}

/** Title "Y by X [and G]". */
function byTitle(t: Tf, y: string, x: string, g?: string): string {
  return g ? t('graphstudio.chart.byGroup', { y, x, g }) : t('graphstudio.chart.by', { y, x });
}

/* ------------------------------------------------------------------ summary charts */

interface Cells {
  x: CatSet;
  g: CatSet | null;
  /** row positions (indexes into rows) per [xi][gi] */
  at: number[][][];
}

function cellsOf(p: Prepared): Cells {
  const x = categories(p.cols.x[0], p.rows);
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const ng = g ? g.cells.length : 1;
  const at: number[][][] = x.cells.map(() => Array.from({ length: ng }, () => [] as number[]));
  p.rows.forEach((_, k) => {
    if (x.idx[k] >= 0) at[x.idx[k]][g ? g.idx[k] : 0].push(k);
  });
  return { x, g, at };
}

interface Cell2 {
  value: number | null;
  lo: number | null;
  hi: number | null;
}

/** The summary of one cell (category x group). */
function cellValue(def: GraphDef, p: Prepared, positions: number[], total: number, valueCol: Col | undefined): Cell2 {
  const func = optStr(def, 'func', 'count');
  const W = positions.reduce((s, k) => s + p.w[p.rows[k]], 0);
  if (func === 'count') return { value: positions.length ? W : null, lo: null, hi: null };
  if (func === 'pct') return { value: positions.length ? (100 * W) / total : null, lo: null, hi: null };
  const vals = positions.map((k) => ({ y: num(valueCol!, p.rows[k]), w: p.w[p.rows[k]] }));
  const value = summarize(func as Summary, vals);
  const kind = optStr(def, 'interval', 'none');
  let lo: number | null = null;
  let hi: number | null = null;
  if (func === 'mean' && value !== null && (kind === 'ci' || kind === 'se' || kind === 'sd')) {
    const half = intervalHalf(kind, optNum(def, 'level', 95), optNum(def, 'mult', 2), vals);
    if (half !== null) {
      lo = value - half;
      hi = value + half;
    }
  }
  return { value, lo, hi };
}

function errorLabel(def: GraphDef, t: Tf): string {
  const kind = optStr(def, 'interval', 'none');
  if (kind === 'ci') return t('graphstudio.chart.ci', { level: optNum(def, 'level', 95) });
  if (kind === 'se') return t('graphstudio.chart.se', { mult: optNum(def, 'mult', 2) });
  if (kind === 'sd') return t('graphstudio.chart.sd', { mult: optNum(def, 'mult', 2) });
  return '';
}

function barChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const func = optStr(def, 'func', 'count');
  const c = cellsOf(p);
  const total = p.info.usedWeight;
  const val = p.cols.value?.[0];
  const stack = def.variant === 'stacked' ? 'stack' : def.variant === 'stacked100' ? 'stack100' : 'none';
  const showErr = func === 'mean' && stack === 'none' && optStr(def, 'interval', 'none') !== 'none';
  let order = c.x.cells.map((_, i) => i);
  const grid = c.at.map((row) => row.map((pos) => cellValue(def, p, pos, total, val)));
  const sort = optStr(def, 'sort', 'category');
  if (sort !== 'category') {
    const tot = (i: number) => grid[i].reduce((s, x) => s + (x.value ?? 0), 0);
    order = [...order].sort((a, b) => (sort === 'asc' ? tot(a) - tot(b) : tot(b) - tot(a)));
  }
  const bars: { x: string; group: string | null; count: number }[] = [];
  const err: ({ lo: number; hi: number } | null)[] = [];
  for (const xi of order) {
    for (let gi = 0; gi < (c.g ? c.g.cells.length : 1); gi++) {
      const cell = grid[xi][gi];
      if (cell.value === null) continue;
      bars.push({ x: c.x.labels[xi], group: c.g ? c.g.labels[gi] : null, count: cell.value });
      err.push(cell.lo !== null && cell.hi !== null ? { lo: cell.lo, hi: cell.hi } : null);
    }
  }
  const y = funcLabel(t, func, needsVariable(func) ? val : undefined);
  const xTitle = varTitle(p.cols.x[0].v);
  const horizontal = def.variant === 'horizontal' || def.options.horizontal === true;
  return {
    type: 'bar',
    title: byTitle(t, y, xTitle, p.cols.group?.[0] ? varTitle(p.cols.group[0].v) : undefined),
    percent: func === 'pct',
    ylabel: y,
    xlabel: xTitle,
    total,
    bars,
    stack,
    horizontal,
    ...(showErr ? { err, errorLabel: errorLabel(def, t) } : {}),
  };
}

function lineSeries(def: GraphDef, p: Prepared, t: Tf, withLines: boolean): Record<string, unknown> {
  const func = withLines ? optStr(def, 'func', 'mean') : 'mean';
  const c = cellsOf(p);
  const val = p.cols.value?.[0];
  const d2: GraphDef = withLines ? def : { ...def, options: { ...def.options, func } };
  const total = p.info.usedWeight;
  const hasInterval = func === 'mean' && optStr(d2, 'interval', 'none') !== 'none';
  const y = funcLabel(t, func, needsVariable(func) ? val : undefined);
  const series = (c.g ? c.g.cells : [null]).map((_, gi) => {
    const cells = c.x.cells.map((__, xi) => cellValue(d2, p, c.at[xi][gi], total, val));
    return {
      name: c.g ? c.g.labels[gi] : y,
      values: cells.map((x) => x.value),
      ...(hasInterval ? { lo: cells.map((x) => x.lo), hi: cells.map((x) => x.hi) } : {}),
    };
  });
  const xTitle = varTitle(p.cols.x[0].v);
  const gTitle = p.cols.group?.[0] ? varTitle(p.cols.group[0].v) : undefined;
  return {
    type: 'line',
    title: byTitle(t, y, xTitle, gTitle),
    xlabel: xTitle,
    ylabel: y,
    legendTitle: gTitle ?? '',
    errorLabel: hasInterval ? errorLabel(d2, t) : '',
    categories: c.x.labels,
    series,
    markers: withLines ? def.options.markers !== false : true,
    connect: withLines,
  };
}

function areaChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const func = optStr(def, 'func', 'count');
  const c = cellsOf(p);
  const val = p.cols.value?.[0];
  const y = funcLabel(t, func, needsVariable(func) ? val : undefined);
  const gTitle = p.cols.group?.[0] ? varTitle(p.cols.group[0].v) : '';
  return {
    type: 'area',
    title: byTitle(t, y, varTitle(p.cols.x[0].v), gTitle || undefined),
    xlabel: varTitle(p.cols.x[0].v),
    ylabel: y,
    legendTitle: gTitle,
    categories: c.x.labels,
    series: (c.g ? c.g.cells : [null]).map((_, gi) => ({
      name: c.g ? c.g.labels[gi] : y,
      values: c.x.cells.map((__, xi) => cellValue(def, p, c.at[xi][gi], p.info.usedWeight, val).value),
    })),
    stack: def.variant === 'stacked' ? 'stack' : def.variant === 'stacked100' ? 'stack100' : 'none',
  };
}

function pieChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const func = optStr(def, 'func', 'count');
  const c = cellsOf(p);
  const val = p.cols.value?.[0];
  let slices = c.x.cells.map((_, xi) => ({ label: c.x.labels[xi], value: Math.max(0, cellValue(def, p, c.at[xi][0], p.info.usedWeight, val).value ?? 0) }));
  slices = slices.filter((s) => s.value > 0);
  const sort = optStr(def, 'sort', 'category');
  if (sort !== 'category') slices.sort((a, b) => (sort === 'asc' ? a.value - b.value : b.value - a.value));
  const y = funcLabel(t, func, needsVariable(func) ? val : undefined);
  return { type: 'pie', title: t('graphstudio.chart.of', { y, x: varTitle(p.cols.x[0].v) }), slices };
}

/* ------------------------------------------------------------------ distributions */

function sortedValues(c: Col, rows: number[]): number[] {
  return rows.map((r) => num(c, r)).sort((a, b) => a - b);
}

function binsFor(def: GraphDef, sorted: number[]): { edges: number[]; integer: boolean } {
  const integer = sorted.every((x) => Number.isInteger(x));
  const rule = optStr(def, 'binRule', 'fd');
  const width = rule === 'width' ? optNum(def, 'binWidth', 0) : 0;
  const wanted = binCountByRule(sorted, rule, optNum(def, 'bins', 10));
  return { edges: binEdges(sorted[0], sorted[sorted.length - 1], wanted, { width, integer }), integer };
}

function histogramChart(def: GraphDef, p: Prepared): Record<string, unknown> {
  const col = p.cols.value[0];
  const sorted = sortedValues(col, p.rows);
  const { edges, integer } = binsFor(def, sorted);
  const nb = edges.length - 1;
  const counts = new Array<number>(nb).fill(0);
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const per = g ? g.cells.map(() => new Array<number>(nb).fill(0)) : [];
  let W = 0;
  let sum = 0;
  p.rows.forEach((r, k) => {
    const x = num(col, r);
    const w = p.w[r];
    const b = binIndex(edges, x);
    if (b >= 0) {
      counts[b] += w;
      if (g) per[g.idx[k]][b] += w;
    }
    W += w;
    sum += w * x;
  });
  const mean = W > 0 ? sum / W : null;
  const ss = p.rows.reduce((s, r) => s + p.w[r] * (num(col, r) - (mean ?? 0)) ** 2, 0);
  const title = varTitle(col.v);
  return {
    type: 'histogram',
    title,
    xlabel: title,
    n: W,
    mean,
    stddev: W > 1 ? Math.sqrt(ss / (W - 1)) : null,
    showNormal: def.variant === 'simple' && def.options.normal === true,
    integer: integer && edges[1] - edges[0] === 1,
    mode: def.variant === 'polygon' ? 'polygon' : 'bars',
    bins: edges.slice(0, -1).map((lo, i) => [lo, edges[i + 1], counts[i]]),
    ...(g ? { series: g.labels.map((name, gi) => ({ name, counts: per[gi] })), legendTitle: varTitle(p.cols.group[0].v) } : {}),
  };
}

function pyramidChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> {
  const col = p.cols.value[0];
  const g = categories(p.cols.group[0], p.rows);
  const { edges } = binsFor(def, sortedValues(col, p.rows));
  const nb = edges.length - 1;
  const swap = def.options.swap === true;
  const [li, ri] = swap ? [1, 0] : [0, 1];
  if (g.cells.length > 2) notes.push(t('graphstudio.note.pyramidTwo', { count: g.cells.length, a: g.labels[0], b: g.labels[1] }));
  const bins = Array.from({ length: nb }, (_, i) => [edges[i], edges[i + 1], 0, 0] as [number, number, number, number]);
  p.rows.forEach((r, k) => {
    const b = binIndex(edges, num(col, r));
    if (b < 0) return;
    if (g.idx[k] === li) bins[b][2] += p.w[r];
    else if (g.idx[k] === ri) bins[b][3] += p.w[r];
  });
  const x = varTitle(col.v);
  return { type: 'pyramid', title: t('graphstudio.chart.pyramid', { x, g: varTitle(p.cols.group[0].v) }), xlabel: x, leftName: g.labels[li], rightName: g.labels[ri], bins };
}

/** Tukey's hinges, whiskers (1.5 hinge spreads) and outliers of ROWS, as SPSS draws boxplots. */
export function boxStats(vals: { y: number; row: number }[], label: string, withOutliers = true) {
  const s = [...vals].sort((a, b) => a.y - b.y);
  const ys = s.map((x) => x.y);
  const n = ys.length;
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const half = Math.ceil(n / 2);
  const q1 = med(ys.slice(0, half));
  const q3 = med(ys.slice(n - half));
  const spread = q3 - q1;
  const fenceLo = q1 - 1.5 * spread;
  const fenceHi = q3 + 1.5 * spread;
  const inside = ys.filter((y) => y >= fenceLo && y <= fenceHi);
  return {
    label,
    hinges: [q1, med(ys), q3] as [number, number, number],
    whiskers: [inside[0] ?? null, inside[inside.length - 1] ?? null] as [number | null, number | null],
    outliers: withOutliers
      ? s.filter((x) => x.y < fenceLo || x.y > fenceHi).map((x) => ({ value: x.y, label: String(x.row + 1), extreme: x.y < q1 - 3 * spread || x.y > q3 + 3 * spread }))
      : [],
  };
}

function boxplotChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const col = p.cols.value[0];
  const withOut = def.options.outliers !== false;
  const x = p.cols.x?.[0] ? categories(p.cols.x[0], p.rows) : null;
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const key = (k: number) => `${x ? x.idx[k] : 0}|${g ? g.idx[k] : 0}`;
  const buckets = new Map<string, { y: number; row: number }[]>();
  p.rows.forEach((r, k) => {
    const b = buckets.get(key(k)) ?? [];
    b.push({ y: num(col, r), row: r });
    buckets.set(key(k), b);
  });
  const boxes = [];
  for (let xi = 0; xi < (x ? x.cells.length : 1); xi++) {
    for (let gi = 0; gi < (g ? g.cells.length : 1); gi++) {
      const vals = buckets.get(`${xi}|${gi}`);
      if (!vals?.length) continue;
      const label = [x ? x.labels[xi] : varTitle(col.v), g ? g.labels[gi] : ''].filter(Boolean).join(', ');
      boxes.push(boxStats(vals, label, withOut));
    }
  }
  const y = varTitle(col.v);
  return {
    type: 'boxplot',
    title: x ? t('graphstudio.chart.by', { y, x: [varTitle(p.cols.x[0].v), g ? varTitle(p.cols.group[0].v) : ''].filter(Boolean).join(' / ') }) : y,
    ylabel: y,
    xlabel: x ? varTitle(p.cols.x[0].v) : '',
    yMin: null,
    yMax: null,
    boxes,
  };
}

function dotChart(def: GraphDef, p: Prepared): Record<string, unknown> {
  const col = p.cols.value[0];
  const sorted = sortedValues(col, p.rows);
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const distinct = new Set(sorted).size;
  const integer = sorted.every((x) => Number.isInteger(x));
  const bins: { x: number; count: number; group?: string | null }[] = [];
  const add = (x: number, group: string | null, w: number) => {
    const hit = bins.find((b) => b.x === x && (b.group ?? null) === group);
    if (hit) hit.count += w;
    else bins.push({ x, count: w, ...(g ? { group } : {}) });
  };
  const width = optNum(def, 'binWidth', 0);
  if (!width && integer && distinct <= 60) {
    p.rows.forEach((r, k) => add(num(col, r), g ? g.labels[g.idx[k]] : null, p.w[r]));
  } else {
    const edges = binEdges(sorted[0], sorted[sorted.length - 1], 30, { width, integer: false });
    p.rows.forEach((r, k) => {
      const b = binIndex(edges, num(col, r));
      if (b >= 0) add(roundTo((edges[b] + edges[b + 1]) / 2, 8), g ? g.labels[g.idx[k]] : null, p.w[r]);
    });
  }
  bins.sort((a, b) => a.x - b.x);
  return { type: 'dot', title: varTitle(col.v), xlabel: varTitle(col.v), bins };
}

function paretoChart(p: Prepared, t: Tf): Record<string, unknown> {
  const c = cellsOf(p);
  const val = p.cols.value?.[0];
  const bars = c.x.cells.map((_, xi) => {
    const pos = c.at[xi][0];
    const count = pos.reduce((s, k) => s + (val ? num(val, p.rows[k]) * p.w[p.rows[k]] : p.w[p.rows[k]]), 0);
    return { label: c.x.labels[xi], count };
  });
  const sorted = bars.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  return {
    type: 'pareto',
    title: t('graphstudio.chart.pareto', { x: varTitle(p.cols.x[0].v) }),
    xlabel: varTitle(p.cols.x[0].v),
    ylabel: val ? `${t('graphstudio.func.sum')} ${varTitle(val.v)}` : t('graphstudio.func.count'),
    bars: sorted,
    total: sorted.reduce((s, b) => s + b.count, 0),
  };
}

/* ------------------------------------------------------------------ relations */

export const MATRIX_MAX_CASES = 2000;

function scatterChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const [X, Y] = [p.cols.x[0], p.cols.y[0]];
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const points = p.rows.map((r, k) => (g ? [num(X, r), num(Y, r), g.labels[g.idx[k]]] : [num(X, r), num(Y, r)]));
  const fit = optStr(def, 'fit', 'none');
  return {
    type: 'scatter',
    title: t('graphstudio.chart.vs', { y: varTitle(Y.v), x: varTitle(X.v) }),
    xlabel: varTitle(X.v),
    ylabel: varTitle(Y.v),
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    byvar: g ? varTitle(p.cols.group[0].v) : null,
    points,
    fit,
    fitByGroup: !!g && def.options.fitByGroup === true,
    showR2: fit !== 'none' && def.options.showR2 !== false,
  };
}

function matrixChart(p: Prepared, t: Tf, notes: string[]): Record<string, unknown> {
  const vars = p.cols.vars;
  const g = p.cols.group?.[0] ? categories(p.cols.group[0], p.rows) : null;
  const n = p.rows.length;
  const stride = Math.max(1, Math.ceil(n / MATRIX_MAX_CASES));
  const picked = p.rows.map((_, k) => k).filter((k) => k % stride === 0).slice(0, MATRIX_MAX_CASES);
  if (picked.length < n) notes.push(t('graphstudio.note.sampled', { used: picked.length, total: n }));
  return {
    type: 'matrix',
    title: t('graphstudio.chart.matrix'),
    vars: vars.map((c) => varTitle(c.v)),
    rows: picked.map((k) => vars.map((c) => num(c, p.rows[k]))),
    groups: g ? picked.map((k) => g.labels[g.idx[k]]) : null,
    byvar: g ? varTitle(p.cols.group[0].v) : null,
  };
}

function heatmapChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const [X, Y] = [p.cols.x[0], p.cols.y[0]];
  const edgesOf = (c: Col, n: number) => {
    const s = sortedValues(c, p.rows);
    return binEdges(s[0], s[s.length - 1], n, { integer: s.every((x) => Number.isInteger(x)) });
  };
  const xEdges = edgesOf(X, optNum(def, 'xBins', 20));
  const yEdges = edgesOf(Y, optNum(def, 'yBins', 20));
  const counts = yEdges.slice(0, -1).map(() => new Array<number>(xEdges.length - 1).fill(0));
  for (const r of p.rows) {
    const xi = binIndex(xEdges, num(X, r));
    const yi = binIndex(yEdges, num(Y, r));
    if (xi >= 0 && yi >= 0) counts[yi][xi] += p.w[r];
  }
  return { type: 'heatmap', title: t('graphstudio.chart.vs', { y: varTitle(Y.v), x: varTitle(X.v) }), xlabel: varTitle(X.v), ylabel: varTitle(Y.v), xEdges, yEdges, counts };
}

/* ------------------------------------------------------------------ entry point */

/**
 * Computes the chart JSON of DEF over DS. T translates graphstudio.* keys (titles and labels are
 * stored in the spec already translated, like the engine does). The result carries no `studio` or
 * `style` members; the caller adds them.
 */
export function computeChart(def: GraphDef, ds: Dataset, t: Tf): ComputeResult {
  const p = prepare(def, ds);
  if (!isPrepared(p)) return p;
  const notes: string[] = [];
  let chart: Record<string, unknown> | null = null;
  switch (def.kind) {
    case 'bar':
      chart = barChart(def, p, t);
      break;
    case 'line':
      chart = lineSeries(def, p, t, true);
      break;
    case 'errorbar':
      chart = lineSeries(def, p, t, false);
      chart.connect = false;
      break;
    case 'area':
      chart = areaChart(def, p, t);
      break;
    case 'pie':
      chart = pieChart(def, p, t);
      break;
    case 'histogram':
      chart = histogramChart(def, p);
      break;
    case 'pyramid':
      chart = pyramidChart(def, p, t, notes);
      break;
    case 'boxplot':
      chart = boxplotChart(def, p, t);
      break;
    case 'scatter':
      chart = scatterChart(def, p, t);
      break;
    case 'dot':
      chart = dotChart(def, p);
      break;
    case 'pareto':
      chart = paretoChart(p, t);
      break;
    case 'scattermatrix':
      chart = matrixChart(p, t, notes);
      break;
    case 'heatmap':
      chart = heatmapChart(def, p, t);
      break;
  }
  if (!chart) return { ok: false, reason: 'missing', slots: [] };
  return { ok: true, chart, info: p.info, notes };
}
