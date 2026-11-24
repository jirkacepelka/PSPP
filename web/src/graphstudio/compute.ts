/*
 * Graph Studio computation: GraphDef + Dataset -> chart JSON (the specs of src/charts), computed in
 * the browser. Pure and synchronous. Honours FILTER and WEIGHT of the dataset (frequency weights),
 * excludes cases with a missing value on any charted variable (listwise, per chart) and reports
 * what it did in `info` and `notes` so the UI can say it.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef, GraphKind } from '../charts/studioTypes';
import { activeRows, caseCount, isMissing, valueText, varTitle, weights, type Cell } from '../ext/data';
import { lgamma, normCdf, normInv, tInv } from '../ext/dist';
import { CATEGORY_CROWDED, CATEGORY_WARN, MAX_PANELS, MERGE_KINDS, needsVariable, slotsOf, missingSlots } from './model';

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
  | { ok: false; reason: 'nodata' }
  | { ok: false; reason: 'panels'; max: number };

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
      return vals.reduce((m, p) => Math.min(m, p.y), Infinity);
    case 'max':
      return vals.reduce((m, p) => Math.max(m, p.y), -Infinity);
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
  /** all drawn rows of the chart; equals `rows` except inside a panel, where categories and bins are shared */
  universe: number[];
  w: number[];
  cols: Record<string, Col[]>;
  info: ComputeInfo;
  /** number of categories each category variable ended up with (for the crowded notes) */
  seen: { name: string; count: number }[];
  /** merge values of the x slot into intervals */
  merge?: Merge;
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

/** Settings of "merge values into intervals" for the category (x) slot. */
export interface Merge {
  mode: 'width' | 'count';
  width: number;
  count: number;
}

/** The merge setting of DEF, or undefined when merging is off or the kind has no merge option. */
export function mergeOf(def: GraphDef): Merge | undefined {
  const mode = def.options.mergeMode;
  if (!MERGE_KINDS.includes(def.kind) || (mode !== 'width' && mode !== 'count')) return undefined;
  return { mode, width: optNum(def, 'mergeWidth', 0), count: optNum(def, 'mergeCount', 0) };
}

/** Interval width and aligned start for the sorted distinct values CELLS, or null when nothing merges. */
export function intervalsFor(cells: number[], m: Merge): { width: number; start: number; integer: boolean } | null {
  if (cells.length < 2) return null;
  const integer = cells.every(Number.isInteger);
  let width: number;
  if (m.mode === 'width') width = m.width;
  else {
    if (!(m.count >= 1) || cells.length <= m.count) return null;
    width = niceStep((cells[cells.length - 1] - cells[0]) / m.count);
  }
  if (!(width > 0)) return null;
  if (integer && width < 1) width = 1;
  return { width, start: Math.floor(cells[0] / width + 1e-9) * width, integer };
}

/**
 * Categories of column C over ROWS, ordered by value and named by value labels. With MERGE and a numeric
 * column the values are grouped into intervals [a, a + width) aligned to multiples of the width; an
 * interval holding one value keeps that value's label, others read "a-b" (integer data: "1900-1901").
 */
function categories(c: Col, rows: number[], universe: number[] = rows, merge?: Merge): CatSet {
  const uniq = new Map<string, Cell>();
  for (const r of universe) uniq.set(keyOf(c.col[r]), c.col[r]);
  const cells = [...uniq.values()].sort(cmpCells);
  const iv = merge && cells.every((x) => typeof x === 'number') ? intervalsFor(cells as number[], merge) : null;
  if (!iv) {
    const index = new Map(cells.map((x, i) => [keyOf(x), i]));
    return { cells, labels: cells.map((x) => valueText(c.v, x)), idx: rows.map((r) => index.get(keyOf(c.col[r])) ?? -1) };
  }
  const binOf = (x: number) => Math.floor((x - iv.start) / iv.width + 1e-9);
  const members = new Map<number, number[]>();
  for (const x of cells as number[]) {
    const b = binOf(x);
    const list = members.get(b);
    if (list) list.push(x);
    else members.set(b, [x]);
  }
  const order = [...members.keys()].sort((a, b) => a - b);
  const position = new Map(order.map((b, i) => [b, i]));
  const dec = Math.min(10, Math.max(0, 1 - Math.floor(Math.log10(iv.width))));
  const label = (b: number): string => {
    const m = members.get(b)!;
    if (m.length === 1) return valueText(c.v, m[0]);
    const lo = iv.start + b * iv.width;
    const hi = iv.integer && Number.isInteger(iv.width) ? lo + iv.width - 1 : lo + iv.width;
    return `${roundTo(lo, dec)}\u2013${roundTo(hi, dec)}`;
  };
  return {
    // the representative of an interval is the middle of the values it holds
    cells: order.map((b) => {
      const m = members.get(b)!;
      return (m[0] + m[m.length - 1]) / 2;
    }),
    labels: order.map(label),
    idx: rows.map((r) => {
      const x = c.col[r];
      return typeof x === 'number' ? (position.get(binOf(x)) ?? -1) : -1;
    }),
  };
}

/** Categories of C over the rows of P; inside a panel the category set comes from the whole chart. */
function cat(p: Prepared, c: Col): CatSet {
  const set = categories(c, p.rows, p.universe, c === p.cols.x?.[0] ? p.merge : undefined);
  p.seen.push({ name: varTitle(c.v), count: set.cells.length });
  return set;
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
  return { rows, universe: rows, w, cols, info, seen: [], merge: mergeOf(def) };
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
  return v ? t('graphstudio.chart.funcOf', { f, v: varTitle(v.v) }) : f;
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
  const x = cat(p, p.cols.x[0]);
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
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

/**
 * Values of the category variable as numbers when the numeric axis option is on (years, ages), so the
 * x axis can be proportional; null otherwise. The categories themselves stay in value order.
 */
function numericX(def: GraphDef, c: Cells, p: Prepared): number[] | null {
  if (def.options.numericAxis !== true || p.cols.x[0].v.type !== 'numeric') return null;
  return c.x.cells.every((x) => typeof x === 'number') ? (c.x.cells as number[]) : null;
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
  const xs = numericX(def, c, p);
  // a line over a numeric x without error bars is a sequence chart (x proportional to the value)
  if (xs && withLines && !hasInterval) return { type: 'sequence', title: byTitle(t, y, xTitle, gTitle), xlabel: xTitle, ylabel: y, x: xs, series: series.map((s) => ({ name: s.name, values: s.values })) };
  return {
    ...(xs ? { xValues: xs } : {}),
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
  const xs = numericX(def, c, p);
  return {
    ...(xs ? { xValues: xs } : {}),
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
  const sorted = sortedValues(col, p.universe);
  const { edges, integer } = binsFor(def, sorted);
  const nb = edges.length - 1;
  const counts = new Array<number>(nb).fill(0);
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
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
  const g = cat(p, p.cols.group[0]);
  const { edges } = binsFor(def, sortedValues(col, p.universe));
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
  const x = p.cols.x?.[0] ? cat(p, p.cols.x[0]) : null;
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
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
      // clustered: boxes with the same label form a cluster, `group` names the box inside it
      boxes.push({ ...boxStats(vals, x ? x.labels[xi] : varTitle(col.v), withOut), ...(g ? { group: g.labels[gi] } : {}) });
    }
  }
  const y = varTitle(col.v);
  return {
    type: 'boxplot',
    title: x ? byTitle(t, y, varTitle(p.cols.x[0].v), g ? varTitle(p.cols.group[0].v) : undefined) : y,
    ylabel: y,
    xlabel: x ? varTitle(p.cols.x[0].v) : '',
    yMin: null,
    yMax: null,
    boxes,
  };
}

function dotChart(def: GraphDef, p: Prepared): Record<string, unknown> {
  const col = p.cols.value[0];
  const sorted = sortedValues(col, p.universe);
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
  const distinct = new Set(sorted).size;
  const integer = sorted.every((x) => Number.isInteger(x));
  const bins: { x: number; count: number; group?: string | null }[] = [];
  const seen = new Map<string, { x: number; count: number }>();
  const add = (x: number, group: string | null, w: number) => {
    const key = `${x}|${group ?? ''}`;
    const hit = seen.get(key);
    if (hit) hit.count += w;
    else {
      const b = { x, count: w, ...(g ? { group } : {}) };
      seen.set(key, b);
      bins.push(b);
    }
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
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
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
    fitCi: fit !== 'none' && def.options.fitCi === true,
  };
}

function matrixChart(p: Prepared, t: Tf, notes: string[]): Record<string, unknown> {
  const vars = p.cols.vars;
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
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
    const s = sortedValues(c, p.universe);
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

/* ------------------------------------------------------------------ summaries over categories (phase 2) */

const VALUE_SUMMARIES = ['mean', 'median', 'sum', 'min', 'max', 'sd'];

/** The summary of column COL in each category of the x slot (one entry per category, in category order). */
function perCategory(def: GraphDef, p: Prepared, c: Cells, col: Col | undefined): (number | null)[] | null {
  if (!col) return null;
  const f = optStr(def, 'func', 'mean');
  const func = (VALUE_SUMMARIES.includes(f) ? f : 'mean') as Summary;
  return c.x.cells.map((_, xi) => summarize(func, c.at[xi][0].map((k) => ({ y: num(col, p.rows[k]), w: p.w[p.rows[k]] }))));
}

function highLowChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const c = cellsOf(p);
  const mode = def.variant === 'range' || def.variant === 'diff' ? def.variant : 'hlc';
  const high = perCategory(def, p, c, p.cols.high[0])!;
  const low = perCategory(def, p, c, p.cols.low[0])!;
  const close = mode === 'hlc' ? perCategory(def, p, c, p.cols.close?.[0]) : null;
  const keep = c.x.cells.map((_, i) => i).filter((i) => high[i] !== null || low[i] !== null);
  const pick = <T,>(a: T[]) => keep.map((i) => a[i]);
  const names = { x: varTitle(p.cols.x[0].v), high: varTitle(p.cols.high[0].v), low: varTitle(p.cols.low[0].v), close: p.cols.close?.[0] ? varTitle(p.cols.close[0].v) : '' };
  const key = mode === 'hlc' ? (close ? 'hlc' : 'hl') : mode;
  const xs = numericX(def, c, p);
  return {
    ...(xs ? { xValues: pick(xs) } : {}),
    type: 'highlow',
    title: t(`graphstudio.chart.highlow.${key}`, names),
    xlabel: names.x,
    ylabel: t(`graphstudio.func.${optStr(def, 'func', 'mean')}`),
    mode,
    categories: pick(c.x.labels),
    high: pick(high),
    low: pick(low),
    close: close ? pick(close) : null,
  };
}

function dualAxisChart(def: GraphDef, p: Prepared, t: Tf): Record<string, unknown> {
  const c = cellsOf(p);
  const func = optStr(def, 'func', 'mean');
  const kinds = (def.variant ?? 'barline').match(/bar|line/g) ?? ['bar', 'line'];
  const side = (slotId: string, kind: string) => {
    const col = p.cols[slotId][0];
    const name = funcLabel(t, func, col);
    return { name, ylabel: name, kind: kind === 'bar' ? 'bar' : 'line', values: perCategory(def, p, c, col)! };
  };
  const left = side('left', kinds[0]);
  const right = side('right', kinds[1]);
  const x = varTitle(p.cols.x[0].v);
  return { type: 'dualaxis', title: t('graphstudio.chart.dual', { left: left.name, right: right.name, x }), xlabel: x, categories: c.x.labels, left, right };
}

/* ------------------------------------------------------------------ probability plots */

type Dist = 'normal' | 'exponential' | 'uniform' | 'lognormal';

/** Blom plotting position of the I-th (0 based) of N ordered values: (i + 1 - 3/8) / (n + 1/4). */
export const blom = (i: number, n: number) => (i + 1 - 0.375) / (n + 0.25);

/** Quantile function of the standard member of DIST (the scale of the fitted one is absorbed by the quartile line). */
export function standardQuantile(dist: Dist, q: number): number {
  switch (dist) {
    case 'exponential':
      return -Math.log(1 - q);
    case 'uniform':
      return q;
    default:
      return normInv(q);
  }
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0;
};

const PLOT_MAX = 2000;
/** At most PLOT_MAX of the sorted points, always keeping the first and the last. */
function thin<T>(a: T[]): T[] {
  if (a.length <= PLOT_MAX) return a;
  return Array.from({ length: PLOT_MAX }, (_, k) => a[Math.round((k * (a.length - 1)) / (PLOT_MAX - 1))]);
}

/** These charts treat every case alike; say so when the dataset is weighted. */
function weightNote(p: Prepared, t: Tf, notes: string[]) {
  if (p.info.weight) notes.push(t('graphstudio.note.weightIgnored', { name: p.info.weight }));
}

function probChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> | null {
  const mode = def.kind === 'pp' ? 'pp' : 'qq';
  const dist = optStr(def, 'dist', 'normal') as Dist;
  const col = p.cols.value[0];
  weightNote(p, t, notes);
  const raw = sortedValues(col, p.rows);
  // exponential needs x >= 0, lognormal x > 0; other values cannot be drawn
  const ok = dist === 'lognormal' ? raw.filter((x) => x > 0) : dist === 'exponential' ? raw.filter((x) => x >= 0) : raw;
  const distName = t(`graphstudio.dist.${dist}`);
  if (ok.length < raw.length) notes.push(t('graphstudio.note.dropped', { count: raw.length - ok.length, dist: distName }));
  // a lognormal sample is a normal one on the log scale
  const ys = dist === 'lognormal' ? ok.map(Math.log) : ok;
  const n = ys.length;
  if (n < 2) return null;
  const x = varTitle(col.v);
  if (mode === 'qq') {
    const pts = ys.map((y, i) => [standardQuantile(dist, blom(i, n)), y] as [number, number]);
    const x1 = standardQuantile(dist, 0.25);
    const x3 = standardQuantile(dist, 0.75);
    const y1 = quantile(ys, 0.25);
    const y3 = quantile(ys, 0.75);
    // reference line through the quartiles of both distributions, drawn over the range of the points
    let reference: [[number, number], [number, number]] | null = null;
    if (x3 > x1 && y3 > y1) {
      const slope = (y3 - y1) / (x3 - x1);
      const [a, b] = [pts[0][0], pts[n - 1][0]];
      reference = [[a, y1 + slope * (a - x1)], [b, y1 + slope * (b - x1)]];
    }
    return {
      type: 'probplot',
      mode,
      title: t('graphstudio.chart.qq', { x }),
      xlabel: t('graphstudio.chart.theoretical', { dist: distName }),
      ylabel: t(dist === 'lognormal' ? 'graphstudio.chart.observedLog' : 'graphstudio.chart.observed', { v: x }),
      points: thin(pts),
      reference,
    };
  }
  // P-P: cumulative proportion of the fitted distribution at each value against the Blom position
  const m = mean(ys);
  const s = sd(ys);
  const lo = ys[0];
  const hi = ys[n - 1];
  if ((dist === 'exponential' && !(m > 0)) || (dist === 'uniform' && !(hi > lo)) || ((dist === 'normal' || dist === 'lognormal') && !(s > 0))) return null;
  const cdf = (y: number) => (dist === 'exponential' ? 1 - Math.exp(-y / m) : dist === 'uniform' ? (y - lo) / (hi - lo) : normCdf((y - m) / s));
  return {
    type: 'probplot',
    mode,
    title: t('graphstudio.chart.pp', { x }),
    xlabel: t('graphstudio.chart.expectedCum', { dist: distName }),
    ylabel: t('graphstudio.chart.observedCum'),
    points: thin(ys.map((y, i) => [cdf(y), blom(i, n)] as [number, number])),
    reference: [[0, 0], [1, 1]],
  };
}

/* ------------------------------------------------------------------ sequence and control charts */

function sequenceChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> {
  const xcol = p.cols.x?.[0];
  const transform = optStr(def, 'transform', 'none');
  const order = [...p.rows].sort((a, b) => (xcol ? num(xcol, a) - num(xcol, b) : a - b));
  const x = order.map((r) => (xcol ? num(xcol, r) : r + 1));
  let nonPositive = 0;
  const series = p.cols.value.map((col) => {
    const raw = order.map((r) => num(col, r));
    let values: (number | null)[] = raw;
    if (transform === 'diff') values = raw.map((v, i) => (i ? v - raw[i - 1] : null));
    if (transform === 'log')
      values = raw.map((v) => {
        if (v > 0) return Math.log(v);
        nonPositive++;
        return null;
      });
    return { name: varTitle(col.v), values };
  });
  if (nonPositive) notes.push(t('graphstudio.note.logDropped', { count: nonPositive }));
  const names = series.map((s) => s.name).join(', ');
  const y = p.cols.value.length > 1 ? t('graphstudio.chart.values') : names;
  return {
    type: 'sequence',
    title: t('graphstudio.chart.sequence', { y: names }),
    xlabel: xcol ? varTitle(xcol.v) : t('graphstudio.chart.caseNumber'),
    ylabel: transform === 'none' ? y : t(`graphstudio.transform.${transform}Of`, { v: y }),
    x,
    series,
  };
}

/** d2 of the range of a sample of size n (n = 2..10): the expected range of n standard normal values. */
export const D2 = [NaN, NaN, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.97, 3.078];
/** d3 for n = 2: the standard deviation of the range of two standard normal values. */
export const D3_2 = 0.853;
/** c4(n) = sqrt(2 / (n - 1)) * Gamma(n / 2) / Gamma((n - 1) / 2): E[s] = c4 * sigma for normal data. */
export const c4 = (n: number) => Math.sqrt(2 / (n - 1)) * Math.exp(lgamma(n / 2) - lgamma((n - 1) / 2));

interface ControlParts {
  title: string;
  ylabel: string;
  labels: string[];
  values: (number | null)[];
  center: number;
  ucl: number[];
  lcl: number[];
}

function controlSpec(c: ControlParts, xlabel: string): Record<string, unknown> {
  return {
    type: 'control',
    title: c.title,
    xlabel,
    ylabel: c.ylabel,
    labels: c.labels,
    values: c.values,
    center: c.center,
    ucl: c.ucl,
    lcl: c.lcl,
    flags: c.values.map((v, i) => v !== null && (v > c.ucl[i] || v < c.lcl[i])),
  };
}

/**
 * Individuals chart (I) and moving range chart (MR), moving range of span 2: MR_i = |x_i - x_(i-1)|.
 *   sigma-hat = MRbar / d2,  d2(2) = 1.128
 *   I:   centre = mean(x),   limits = centre +- k * MRbar / d2           (k = 3: centre +- 2.66 MRbar)
 *   MR:  centre = MRbar,     UCL = MRbar * (1 + k * d3 / d2), LCL = max(0, MRbar * (1 - k * d3 / d2)),  d3(2) = 0.853
 *        (k = 3: UCL = D4 * MRbar with D4 = 3.267, LCL = 0)
 */
export function individualsParts(def: GraphDef, p: Prepared, t: Tf): { i: ControlParts; mr: ControlParts } | null {
  const col = p.cols.value[0];
  const k = optNum(def, 'limitK', 3);
  const vals = p.rows.map((r) => num(col, r));
  if (vals.length < 2) return null;
  const labels = p.rows.map((r) => String(r + 1));
  const mrs = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
  const mrBar = mean(mrs);
  const center = mean(vals);
  const half = (k * mrBar) / D2[2];
  const y = varTitle(col.v);
  const mrUcl = mrBar * (1 + (k * D3_2) / D2[2]);
  const mrLcl = Math.max(0, mrBar * (1 - (k * D3_2) / D2[2]));
  return {
    i: { title: t('graphstudio.chart.control.individuals', { y }), ylabel: t('graphstudio.chart.individual'), labels, values: vals, center, ucl: vals.map(() => center + half), lcl: vals.map(() => center - half) },
    mr: { title: t('graphstudio.chart.control.movingrange', { y }), ylabel: t('graphstudio.chart.movingRange'), labels, values: [null, ...mrs], center: mrBar, ucl: vals.map(() => mrUcl), lcl: vals.map(() => mrLcl) },
  };
}

/**
 * X-bar chart for subgroups (the categories of the subgroup slot), subgroup i with n_i cases.
 *   centre = grand mean (mean of the subgroup means weighted by n_i = mean of all cases)
 *   sigma-hat, 'sd' method:    mean over subgroups with n_i >= 2 of s_i / c4(n_i)
 *   sigma-hat, 'range' method: mean over subgroups with 2 <= n_i <= 10 of R_i / d2(n_i); larger subgroups use the 'sd' estimate
 *   limits of subgroup i: centre +- k * sigma-hat / sqrt(n_i)   (k = 3; with equal n this is centre +- A2 * Rbar, A2 = 3 / (d2 sqrt n))
 * With no subgroup of two or more cases sigma-hat comes from the moving range of the subgroup means (MRbar / 1.128).
 */
export function xbarParts(def: GraphDef, p: Prepared, t: Tf): ControlParts | null {
  const col = p.cols.value[0];
  const sg = cat(p, p.cols.subgroup[0]);
  const k = optNum(def, 'limitK', 3);
  const byRange = optStr(def, 'sigma', 'sd') === 'range';
  const groups = sg.cells.map(() => [] as number[]);
  p.rows.forEach((r, i) => {
    if (sg.idx[i] >= 0) groups[sg.idx[i]].push(num(col, r));
  });
  const used = groups.map((g, i) => ({ g, label: sg.labels[i] })).filter((x) => x.g.length);
  if (used.length < 2) return null;
  const means = used.map((x) => mean(x.g));
  const ns = used.map((x) => x.g.length);
  const center = mean(used.flatMap((x) => x.g));
  const estimates: number[] = [];
  for (const { g } of used) {
    if (g.length < 2) continue;
    if (byRange && g.length <= 10) estimates.push((Math.max(...g) - Math.min(...g)) / D2[g.length]);
    else estimates.push(sd(g) / c4(g.length));
  }
  const sigma = estimates.length ? mean(estimates) : mean(means.slice(1).map((m, i) => Math.abs(m - means[i]))) / D2[2];
  const half = ns.map((n) => (k * sigma) / Math.sqrt(n));
  const y = varTitle(col.v);
  return {
    title: t('graphstudio.chart.control.xbar', { y, x: varTitle(p.cols.subgroup[0].v) }),
    ylabel: t('graphstudio.chart.subgroupMean'),
    labels: used.map((x) => x.label),
    values: means,
    center,
    ucl: half.map((h) => center + h),
    lcl: half.map((h) => center - h),
  };
}

function controlChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> | null {
  weightNote(p, t, notes);
  if (def.variant === 'xbar') {
    const x = xbarParts(def, p, t);
    return x && controlSpec(x, varTitle(p.cols.subgroup[0].v));
  }
  const parts = individualsParts(def, p, t);
  if (!parts) return null;
  const caseNo = t('graphstudio.chart.caseNumber');
  if (def.variant === 'individuals') return controlSpec(parts.i, caseNo);
  if (def.variant === 'movingrange') return controlSpec(parts.mr, caseNo);
  const y = varTitle(p.cols.value[0].v);
  return {
    type: 'panels',
    title: t('graphstudio.chart.control.imr', { y }),
    columns: 1,
    sharedAxes: false,
    panels: [parts.i, parts.mr].map((c) => ({ title: c.ylabel, chart: controlSpec(c, caseNo) })),
  };
}

/* ------------------------------------------------------------------ density and violin */

/** Silverman's rule of thumb: h = 0.9 * min(sd, IQR / 1.34) * n^(-1/5); 0 when the sample has no spread. */
export function silverman(sorted: number[]): number {
  const n = sorted.length;
  if (n < 2) return 0;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const s = sd(sorted);
  return 0.9 * (iqr > 0 ? Math.min(s, iqr / 1.34) : s) * n ** -0.2;
}

/** Gaussian kernel density estimate of SORTED with bandwidth H at COUNT points from LO to HI. */
export function kde(sorted: number[], h: number, lo: number, hi: number, count: number): [number, number][] {
  const norm = 1 / (sorted.length * h * Math.sqrt(2 * Math.PI));
  return Array.from({ length: count }, (_, j) => {
    const x = lo + ((hi - lo) * j) / (count - 1);
    let s = 0;
    for (const v of sorted) {
      const z = (x - v) / h;
      if (z > -8 && z < 8) s += Math.exp(-0.5 * z * z);
    }
    return [x, s * norm];
  });
}

const VIOLIN_POINTS = 64;
const DENSITY_POINTS = 100;

/** Values of the value slot per category of CATS (one bucket without categories), sorted. */
function bucketValues(p: Prepared, col: Col, cats: CatSet | null): number[][] {
  const out = (cats ? cats.cells : [null]).map(() => [] as number[]);
  p.rows.forEach((r, k) => {
    const i = cats ? cats.idx[k] : 0;
    if (i >= 0) out[i].push(num(col, r));
  });
  return out.map((a) => a.sort((x, y) => x - y));
}

function violinChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> | null {
  weightNote(p, t, notes);
  const col = p.cols.value[0];
  const x = p.cols.x?.[0] ? cat(p, p.cols.x[0]) : null;
  const factor = optNum(def, 'bwFactor', 1);
  const violins: { label: string; points: [number, number][]; median: number; q1: number; q3: number }[] = [];
  let skipped = 0;
  bucketValues(p, col, x).forEach((g, i) => {
    const h = silverman(g) * factor;
    if (g.length < 2 || !(h > 0)) {
      if (g.length) skipped++;
      return;
    }
    // clipped to the data range, so the shape never reaches beyond the observed values
    violins.push({ label: x ? x.labels[i] : varTitle(col.v), points: kde(g, h, g[0], g[g.length - 1], VIOLIN_POINTS), median: quantile(g, 0.5), q1: quantile(g, 0.25), q3: quantile(g, 0.75) });
  });
  if (skipped) notes.push(t('graphstudio.note.groupsSkipped', { count: skipped }));
  if (!violins.length) return null;
  const y = varTitle(col.v);
  return { type: 'violin', title: x ? byTitle(t, y, varTitle(p.cols.x[0].v)) : y, ylabel: y, xlabel: x ? varTitle(p.cols.x[0].v) : '', violins };
}

function densityChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> | null {
  weightNote(p, t, notes);
  const col = p.cols.value[0];
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
  const factor = optNum(def, 'bwFactor', 1);
  const curves: { name: string; points: [number, number][] }[] = [];
  let skipped = 0;
  bucketValues(p, col, g).forEach((vals, i) => {
    const h = silverman(vals) * factor;
    if (vals.length < 2 || !(h > 0)) {
      if (vals.length) skipped++;
      return;
    }
    // the curve runs 3 bandwidths past the data so it comes down to (almost) zero
    curves.push({ name: g ? g.labels[i] : varTitle(col.v), points: kde(vals, h, vals[0] - 3 * h, vals[vals.length - 1] + 3 * h, DENSITY_POINTS) });
  });
  if (skipped) notes.push(t('graphstudio.note.groupsSkipped', { count: skipped }));
  if (!curves.length) return null;
  const x = varTitle(col.v);
  return {
    type: 'density',
    title: g ? t('graphstudio.chart.densityBy', { x, g: varTitle(p.cols.group[0].v) }) : t('graphstudio.chart.densityOf', { x }),
    xlabel: x,
    ylabel: t('graphstudio.chart.density'),
    curves,
    fill: def.options.fill !== false,
    legendTitle: g ? varTitle(p.cols.group[0].v) : '',
  };
}

/* ------------------------------------------------------------------ panels */

type Range = [number, number];
interface Extent {
  x?: Range;
  y?: Range;
  /** true when the value axis should include zero (bars, areas, histograms, densities) */
  zero?: boolean;
}

const rangeOf = (vals: unknown[]): Range | undefined => {
  const f = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return f.length ? [f.reduce((m, v) => Math.min(m, v), Infinity), f.reduce((m, v) => Math.max(m, v), -Infinity)] : undefined;
};
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []); // eslint-disable-line @typescript-eslint/no-explicit-any

/** The data extent of the axes of a chart spec (the kinds a panel can hold). */
export function chartExtent(c: Obj): Extent {
  switch (c.type) {
    case 'bar': {
      let vals: number[];
      if (c.stack === 'stack100') vals = [0, 100];
      else if (c.stack === 'stack') {
        const sums = new Map<string, number>();
        for (const b of list(c.bars)) sums.set(b.x, (sums.get(b.x) ?? 0) + b.count);
        vals = [...sums.values()];
      } else vals = [...list(c.bars).map((b) => b.count), ...list(c.err).flatMap((e) => (e ? [e.lo, e.hi] : []))];
      const r = rangeOf(vals);
      return c.horizontal ? { x: r, zero: true } : { y: r, zero: true };
    }
    case 'line':
      return { y: rangeOf(list(c.series).flatMap((s) => [...list(s.values), ...list(s.lo), ...list(s.hi)])) };
    case 'area': {
      const ser = list(c.series);
      if (c.stack === 'stack100') return { y: [0, 100], zero: true };
      if (c.stack === 'stack') return { y: rangeOf(list(c.categories).map((_, i) => ser.reduce((s, x) => s + (x.values[i] ?? 0), 0))), zero: true };
      return { y: rangeOf(ser.flatMap((s) => list(s.values))), zero: true };
    }
    case 'histogram': {
      const bins = list(c.bins);
      return { x: rangeOf(bins.flatMap((b) => [b[0], b[1]])), y: rangeOf(bins.map((b) => b[2])), zero: true };
    }
    case 'boxplot':
      return { y: rangeOf(list(c.boxes).flatMap((b) => [...list(b.whiskers), ...list(b.outliers).map((o) => o.value), ...list(b.hinges)])) };
    case 'scatter':
      return { x: rangeOf(list(c.points).map((q) => q[0])), y: rangeOf(list(c.points).map((q) => q[1])) };
    case 'dot':
      return { x: rangeOf(list(c.bins).map((b) => b.x)) };
    case 'highlow':
      return { y: rangeOf([...list(c.high), ...list(c.low), ...list(c.close)]) };
    case 'probplot':
      return { x: rangeOf([...list(c.points).map((q) => q[0]), ...list(c.reference).map((q) => q[0])]), y: rangeOf([...list(c.points).map((q) => q[1]), ...list(c.reference).map((q) => q[1])]) };
    case 'sequence':
      return { x: rangeOf(list(c.x)), y: rangeOf(list(c.series).flatMap((s) => list(s.values))) };
    case 'control':
      return { y: rangeOf([...list(c.values), ...list(c.ucl), ...list(c.lcl), c.center]) };
    case 'density':
      return { x: rangeOf(list(c.curves).flatMap((k) => list(k.points).map((q) => q[0]))), y: rangeOf(list(c.curves).flatMap((k) => list(k.points).map((q) => q[1]))), zero: true };
    case 'violin':
      return { y: rangeOf(list(c.violins).flatMap((v) => list(v.points).map((q) => q[0]))) };
    default:
      return {};
  }
}

/** A range widened to round numbers (and to zero when asked), so shared axes look tidy. */
export function niceRange(r: Range, zero: boolean): Range {
  let [lo, hi] = r;
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (!(hi > lo)) return [lo - 1, hi + 1];
  const step = niceStep((hi - lo) / 5);
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}

const union = (a: Range | undefined, b: Range | undefined): Range | undefined => (a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : (a ?? b));

/** Common axis ranges of CHARTS, written into each chart's style so the panels can be compared. */
export function shareAxes(charts: Obj[]) {
  let x: Range | undefined;
  let y: Range | undefined;
  let zeroX = false;
  let zeroY = false;
  for (const c of charts) {
    const e = chartExtent(c);
    x = union(x, e.x);
    y = union(y, e.y);
    if (e.zero) {
      zeroX ||= !!e.x;
      zeroY ||= !!e.y;
    }
  }
  const nx = x && niceRange(x, zeroX);
  const ny = y && niceRange(y, zeroY);
  for (const c of charts) {
    const style: Record<string, unknown> = { ...(c.style as Obj | undefined) };
    if (nx) [style.xMin, style.xMax] = nx;
    if (ny) [style.yMin, style.yMax] = ny;
    c.style = style;
  }
}

const panelColumns = (n: number) => (n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4);

/** The chart of DEF once per level of the panel variable; { tooMany } when there are too many levels. */
function panelsChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Record<string, unknown> | { tooMany: number } | null {
  const pc = p.cols.panel[0];
  const lv = cat(p, pc);
  if (lv.cells.length > MAX_PANELS) return { tooMany: lv.cells.length };
  const g = varTitle(pc.v);
  let base = '';
  const panels: { title: string; chart: Obj }[] = [];
  lv.cells.forEach((_, li) => {
    const rows = p.rows.filter((__, k) => lv.idx[k] === li);
    if (!rows.length) return;
    const sub: Prepared = { ...p, rows, info: { ...p.info, used: rows.length, usedWeight: rows.reduce((s, r) => s + p.w[r], 0) } };
    const chart = buildOne(def, sub, t, notes);
    if (!chart) return;
    base = base || String(chart.title ?? '');
    // the chart keeps its own title (some renderers use it as the axis title); the panel heading is `title`
    panels.push({ title: t('graphstudio.chart.panel', { g, level: lv.labels[li] }), chart });
  });
  if (!panels.length) return null;
  const shared = def.options.sharedAxes !== false;
  if (shared) shareAxes(panels.map((x) => x.chart));
  const wanted = optNum(def, 'panelCols', 0);
  return {
    type: 'panels',
    title: t('graphstudio.chart.panelBy', { title: base, g }),
    columns: wanted >= 1 ? Math.min(6, Math.round(wanted)) : panelColumns(panels.length),
    sharedAxes: shared,
    panels,
  };
}

/* ------------------------------------------------------------------ reference statistics */

export interface QuickStats {
  /** the axis that carries the values */
  axis: 'x' | 'y';
  n: number;
  mean: number;
  median: number;
  sd: number | null;
}

/** Where the numeric variable of a kind sits: the slot and the axis it is drawn on. */
const VALUE_AXIS: Partial<Record<GraphKind, { slot: string; axis: 'x' | 'y' }>> = {
  bar: { slot: 'value', axis: 'y' },
  line: { slot: 'value', axis: 'y' },
  area: { slot: 'value', axis: 'y' },
  errorbar: { slot: 'value', axis: 'y' },
  boxplot: { slot: 'value', axis: 'y' },
  violin: { slot: 'value', axis: 'y' },
  histogram: { slot: 'value', axis: 'x' },
  dot: { slot: 'value', axis: 'x' },
  density: { slot: 'value', axis: 'x' },
  scatter: { slot: 'y', axis: 'y' },
  sequence: { slot: 'value', axis: 'y' },
  control: { slot: 'value', axis: 'y' },
  qq: { slot: 'value', axis: 'y' },
};

/**
 * Mean, median and SD for the quick reference lines: of the numeric variable drawn on the value axis
 * (weighted), or, for charts of counts, of the plotted values. Null when the chart has no such axis.
 */
export function quickStats(def: GraphDef, ds: Dataset, chart?: Record<string, unknown> | null): QuickStats | null {
  const p = prepare(def, ds);
  if (!isPrepared(p)) return null;
  const where = VALUE_AXIS[def.kind];
  const col = where ? p.cols[where.slot]?.[0] : undefined;
  let obs: Obs[] | null = null;
  let axis: 'x' | 'y' = where?.axis ?? 'y';
  if (col) {
    obs = p.rows.map((r) => ({ y: num(col, r), w: p.w[r] }));
    if (def.kind === 'qq' && optStr(def, 'dist', 'normal') === 'lognormal') obs = obs.filter((o) => o.y > 0).map((o) => ({ y: Math.log(o.y), w: o.w }));
    if (def.kind === 'bar' && (def.variant === 'horizontal' || def.options.horizontal === true)) axis = 'x';
  } else if (chart && chart.type === 'bar' && Array.isArray(chart.bars)) {
    obs = (chart.bars as { count: number }[]).map((b) => ({ y: b.count, w: 1 }));
    axis = chart.horizontal === true ? 'x' : 'y';
  } else if (chart && (chart.type === 'line' || chart.type === 'area') && Array.isArray(chart.series)) {
    obs = ((chart.series as { values: (number | null)[] }[])[0]?.values ?? []).filter((v): v is number => v !== null).map((y) => ({ y, w: 1 }));
  }
  if (!obs || !obs.length) return null;
  const m = summarize('mean', obs);
  const med = summarize('median', obs);
  if (m === null || med === null) return null;
  return { axis, n: obs.reduce((s, o) => s + o.w, 0), mean: m, median: med, sd: summarize('sd', obs) };
}

/* ------------------------------------------------------------------ entry point */

/** One chart (no panels) from prepared data; null when it cannot be drawn. */
function buildOne(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  switch (def.kind) {
    case 'bar':
      return barChart(def, p, t);
    case 'line':
      return lineSeries(def, p, t, true);
    case 'errorbar': {
      const c = lineSeries(def, p, t, false);
      c.connect = false;
      return c;
    }
    case 'area':
      return areaChart(def, p, t);
    case 'pie':
      return pieChart(def, p, t);
    case 'histogram':
      return histogramChart(def, p);
    case 'pyramid':
      return pyramidChart(def, p, t, notes);
    case 'boxplot':
      return boxplotChart(def, p, t);
    case 'scatter':
      return scatterChart(def, p, t);
    case 'dot':
      return dotChart(def, p);
    case 'pareto':
      return paretoChart(p, t);
    case 'scattermatrix':
      return matrixChart(p, t, notes);
    case 'heatmap':
      return heatmapChart(def, p, t);
    case 'highlow':
      return highLowChart(def, p, t);
    case 'dualaxis':
      return dualAxisChart(def, p, t);
    case 'qq':
    case 'pp':
      return probChart(def, p, t, notes);
    case 'sequence':
      return sequenceChart(def, p, t, notes);
    case 'control':
      return controlChart(def, p, t, notes);
    case 'violin':
      return violinChart(def, p, t, notes);
    case 'density':
      return densityChart(def, p, t, notes);
    default:
      return null;
  }
}

/**
 * Computes the chart JSON of DEF over DS. T translates graphstudio.* keys (titles and labels are
 * stored in the spec already translated, like the engine does). The result carries no `studio` or
 * `style` members; the caller adds them. With a panel variable the result is a PanelsSpec.
 */
export function computeChart(def: GraphDef, ds: Dataset, t: Tf): ComputeResult {
  const p = prepare(def, ds);
  if (!isPrepared(p)) return p;
  const notes: string[] = [];
  let chart: Record<string, unknown> | null;
  if (p.cols.panel?.length) {
    const r = panelsChart(def, p, t, notes);
    if (r && 'tooMany' in r) return { ok: false, reason: 'panels', max: MAX_PANELS };
    chart = r;
  } else chart = buildOne(def, p, t, notes);
  if (!chart) return { ok: false, reason: 'nodata' };
  // one message per variable: the stronger one (above 500 categories a warning, above 50 a hint)
  const most = new Map<string, number>();
  for (const x of p.seen) most.set(x.name, Math.max(most.get(x.name) ?? 0, x.count));
  for (const [name, count] of most) {
    if (count > CATEGORY_CROWDED) notes.push(t('graphstudio.note.crowdedWarn', { name, count }));
    else if (count > CATEGORY_WARN) notes.push(t('graphstudio.note.manyCategories', { name, count }));
  }
  return { ok: true, chart, info: p.info, notes: [...new Set(notes)] };
}
