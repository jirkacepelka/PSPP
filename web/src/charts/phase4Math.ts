/* Pure math of the phase 4 chart types: squarified treemap, radar geometry, Pearson residuals and mosaic
   layout, ridge offsets, bubble radii, waterfall running totals, forest rows, log ticks, marginal plot
   statistics.  No DOM.  SPDX-License-Identifier: GPL-3.0-or-later */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ---------------------------------------------------------------- treemap */

/** Squarified treemap (Bruls, Huizing, van Wijk): rectangles aligned with `values`, areas proportional to the
    values, filling `rect`.  Values that are not positive and finite get an empty rectangle. */
export function squarify(values: number[], rect: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const order = values.map((_, i) => i).filter((i) => values[i] > 0 && isFinite(values[i])).sort((a, b) => values[b] - values[a] || a - b);
  const total = order.reduce((s, i) => s + values[i], 0);
  if (!order.length || !(rect.w > 0) || !(rect.h > 0) || !(total > 0)) return out;
  const k = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect;
  // worst aspect ratio of a row with the given areas laid along a side of length `side`
  const worst = (areas: number[], side: number): number => {
    const s = areas.reduce((a, b) => a + b, 0);
    const mx = Math.max(...areas);
    const mn = Math.min(...areas);
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  let row: number[] = [];
  let areas: number[] = [];
  const flush = () => {
    if (!row.length) return;
    const s = areas.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // a column on the left edge
      const thick = s / h;
      let cy = y;
      row.forEach((idx, j) => {
        const hh = areas[j] / thick;
        out[idx] = { x, y: cy, w: thick, h: hh };
        cy += hh;
      });
      x += thick;
      w -= thick;
    } else {
      // a row along the top edge
      const thick = s / w;
      let cx = x;
      row.forEach((idx, j) => {
        const ww = areas[j] / thick;
        out[idx] = { x: cx, y, w: ww, h: thick };
        cx += ww;
      });
      y += thick;
      h -= thick;
    }
    row = [];
    areas = [];
  };
  for (const idx of order) {
    const a = values[idx] * k;
    const side = Math.min(w, h);
    if (!row.length || worst([...areas, a], side) <= worst(areas, side)) {
      row.push(idx);
      areas.push(a);
    } else {
      flush();
      row.push(idx);
      areas.push(a);
    }
  }
  flush();
  return out;
}

export interface TreemapTile {
  label: string;
  value: number;
  group?: string | null;
}

export interface TreemapLayout {
  /** one rectangle per input tile (same order) */
  tiles: Rect[];
  /** one rectangle per group, in first-appearance order (empty without groups) */
  groups: { name: string; rect: Rect; total: number }[];
}

/** Two levels when tiles carry groups (groups squarified by their totals, tiles inside each group), else one level.
    `pad` is the gap kept between tiles and around the groups. */
export function treemapLayout(tiles: TreemapTile[], rect: Rect, pad = 0): TreemapLayout {
  const inset = (r: Rect, p: number): Rect => (r.w > 2 * p && r.h > 2 * p ? { x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p } : r);
  const names: string[] = [];
  tiles.forEach((t) => t.group && !names.includes(t.group) && names.push(t.group));
  const pos = (v: number) => (v > 0 && isFinite(v) ? v : 0);
  if (names.length < 2) {
    const rs = squarify(tiles.map((t) => pos(t.value)), rect);
    return { tiles: rs.map((r) => inset(r, pad / 2)), groups: [] };
  }
  // tiles without a group form one more group, shown last
  const key = (t: TreemapTile) => t.group || '';
  const all = tiles.some((t) => !t.group) ? [...names, ''] : names;
  const totals = all.map((g) => tiles.reduce((s, t) => (key(t) === g ? s + pos(t.value) : s), 0));
  const grects = squarify(totals, rect);
  const outTiles: Rect[] = tiles.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  all.forEach((g, gi) => {
    const members = tiles.map((t, i) => (key(t) === g ? i : -1)).filter((i) => i >= 0);
    const inner = inset(grects[gi], pad);
    const rs = squarify(members.map((i) => pos(tiles[i].value)), inner);
    members.forEach((i, j) => (outTiles[i] = inset(rs[j], pad / 2)));
  });
  return { tiles: outTiles, groups: all.map((g, gi) => ({ name: g, rect: grects[gi], total: totals[gi] })) };
}

/** Fits `lines` of label text into a tile: how many characters-worth of room there is is decided by the renderer, this
    only says whether the tile is big enough for a label at all, and for a second (value) line. */
export function tileLabelRoom(w: number, h: number, fontPx: number): { label: boolean; value: boolean } {
  const label = w >= fontPx * 2.6 && h >= fontPx * 1.5;
  return { label, value: label && h >= fontPx * 3 && w >= fontPx * 3 };
}

/* ------------------------------------------------------------------ radar */

/** Angle of axis `i` of `n`, in radians: the first axis points up, the rest follow clockwise. */
export const radarAngle = (i: number, n: number): number => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);

/** Position on axis `i` of `n` at fraction `frac` (0 centre, 1 rim) of radius `r` around (cx, cy). */
export function radarPoint(cx: number, cy: number, r: number, i: number, n: number, frac: number): [number, number] {
  const a = radarAngle(i, n);
  return [cx + r * frac * Math.cos(a), cy + r * frac * Math.sin(a)];
}

/** Fraction of the radius for a value (clamped to 0..1); null maps to the centre. */
export function radarFraction(v: number | null, min: number, max: number): number {
  if (v === null || !isFinite(v) || !(max > min)) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** Axis range: the explicit bounds, otherwise 0 (or the data minimum when negative) to the data maximum. */
export function radarRange(series: (number | null)[][], min: number | null, max: number | null): [number, number] {
  const flat = series.flat().filter((v): v is number => v !== null && isFinite(v));
  let lo = min ?? Math.min(0, ...flat);
  let hi = max ?? Math.max(...(flat.length ? flat : [1]));
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = lo + 1;
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

/** Polygon outline (SVG path) of one series. */
export function radarPath(cx: number, cy: number, r: number, values: (number | null)[], min: number, max: number): string {
  const n = values.length;
  return (
    values
      .map((v, i) => {
        const [x, y] = radarPoint(cx, cy, r, i, n, radarFraction(v, min, max));
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join('') + 'Z'
  );
}

/* ----------------------------------------------------------------- mosaic */

export interface Residuals {
  /** expected counts [yi][xi] under independence */
  expected: number[][];
  /** Pearson residuals (observed - expected) / sqrt(expected), 0 where expected is 0 */
  resid: number[][];
  chi2: number;
  df: number;
  total: number;
}

/** Pearson residuals of a contingency table counts[yi][xi]. */
export function pearsonResiduals(counts: number[][]): Residuals {
  const ny = counts.length;
  const nx = ny ? counts[0].length : 0;
  const rowT = counts.map((r) => r.reduce((s, v) => s + v, 0));
  const colT = Array.from({ length: nx }, (_, xi) => counts.reduce((s, r) => s + r[xi], 0));
  const total = rowT.reduce((s, v) => s + v, 0);
  const expected = counts.map((_, yi) => colT.map((c) => (total > 0 ? (rowT[yi] * c) / total : 0)));
  let chi2 = 0;
  const resid = counts.map((r, yi) =>
    r.map((o, xi) => {
      const e = expected[yi][xi];
      if (!(e > 0)) return 0;
      const z = (o - e) / Math.sqrt(e);
      chi2 += z * z;
      return z;
    }),
  );
  const rows = rowT.filter((v) => v > 0).length;
  const cols = colT.filter((v) => v > 0).length;
  return { expected, resid, chi2, df: Math.max(0, (rows - 1) * (cols - 1)), total };
}

/** Shading level of a residual: 0 within +-2, 1 up to +-4, 2 beyond (signed). */
export function residualLevel(z: number): -2 | -1 | 0 | 1 | 2 {
  const a = Math.abs(z);
  const l = a >= 4 ? 2 : a >= 2 ? 1 : 0;
  return (l === 0 ? 0 : z < 0 ? -l : l) as -2 | -1 | 0 | 1 | 2;
}

export interface MosaicCell {
  xi: number;
  yi: number;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  /** share of the column */
  colShare: number;
  /** share of all */
  share: number;
}

export interface MosaicLayout {
  cells: MosaicCell[];
  /** column rectangles (x, w) for the labels; w = 0 for empty columns */
  columns: { xi: number; x: number; w: number; total: number }[];
}

/** Variable width columns (width by column total), cells stacked by their share of the column, `gap` px between
    columns and between cells.  The first y category is at the top. */
export function mosaicLayout(counts: number[][], width: number, height: number, gap: number): MosaicLayout {
  const ny = counts.length;
  const nx = ny ? counts[0].length : 0;
  const colT = Array.from({ length: nx }, (_, xi) => counts.reduce((s, r) => s + Math.max(0, r[xi]), 0));
  const total = colT.reduce((s, v) => s + v, 0);
  const live = colT.filter((v) => v > 0).length;
  const cells: MosaicCell[] = [];
  const columns: MosaicLayout['columns'] = [];
  if (!(total > 0)) return { cells, columns: colT.map((t, xi) => ({ xi, x: 0, w: 0, total: t })) };
  const avail = Math.max(0, width - gap * Math.max(0, live - 1));
  let x = 0;
  colT.forEach((ct, xi) => {
    if (!(ct > 0)) {
      columns.push({ xi, x, w: 0, total: ct });
      return;
    }
    const w = (avail * ct) / total;
    columns.push({ xi, x, w, total: ct });
    const liveCells = counts.filter((r) => r[xi] > 0).length;
    const availH = Math.max(0, height - gap * Math.max(0, liveCells - 1));
    let y = 0;
    for (let yi = 0; yi < ny; yi++) {
      const c = Math.max(0, counts[yi][xi]);
      if (!(c > 0)) continue;
      const h = (availH * c) / ct;
      cells.push({ xi, yi, x, y, w, h, count: c, colShare: c / ct, share: c / total });
      y += h + gap;
    }
    x += w + gap;
  });
  return { cells, columns };
}

/* ------------------------------------------------------------------ ridge */

/** Offsets of the ridge baselines: row 0 at the top.  A curve peaks `overlap` row steps above its baseline, so the
    first peak touches `top` and the last baseline sits at `top + height`.  `unit` is the px per density unit. */
export function ridgeOffsets(n: number, top: number, height: number, overlap: number, maxDensity: number): { baselines: number[]; step: number; peak: number; unit: number } {
  const rows = Math.max(1, n);
  const step = height / (rows - 1 + overlap);
  const peak = overlap * step;
  return {
    baselines: Array.from({ length: rows }, (_, i) => top + peak + i * step),
    step,
    peak,
    unit: maxDensity > 0 ? peak / maxDensity : 0,
  };
}

/** Linear interpolation of a curve (sorted by x) at x; null outside its range. */
export function interpolate(points: [number, number][], x: number): number | null {
  if (!points.length || x < points[0][0] || x > points[points.length - 1][0]) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points[lo];
  const [x1, y1] = points[hi];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/* ----------------------------------------------------------------- bubble */

/** Radius of a bubble whose area is proportional to `size`; `maxSize` gets `rMax`. */
export function bubbleRadius(size: number, maxSize: number, rMax: number): number {
  if (!(size > 0) || !(maxSize > 0)) return 0;
  return rMax * Math.sqrt(Math.min(size, maxSize) / maxSize);
}

/** Three reference sizes for the size legend: the largest 1, 2 or 5 x 10^k not above the maximum, its half and
    its tenth (duplicates removed, descending). */
export function sizeReferences(maxSize: number): number[] {
  if (!(maxSize > 0) || !isFinite(maxSize)) return [];
  const p = Math.pow(10, Math.floor(Math.log10(maxSize)));
  const lead = [5, 2, 1].map((m) => m * p).find((v) => v <= maxSize * 1.0000001) ?? p;
  const refs = [lead, lead / 2, lead / 10];
  return refs.filter((v, i) => refs.indexOf(v) === i);
}

/* -------------------------------------------------------------- waterfall */

export interface WaterfallBar {
  label: string;
  /** start and end level of the bar */
  from: number;
  to: number;
  /** the change (end - start); for a total bar the cumulative sum */
  delta: number;
  kind: 'increase' | 'decrease' | 'total';
}

/** Running totals: a step moves from the level before it; a total step draws the cumulative sum as a full bar from 0. */
export function waterfallBars(steps: { label: string; value: number; total?: boolean }[]): WaterfallBar[] {
  let level = 0;
  return steps.map((s) => {
    if (s.total) {
      const bar: WaterfallBar = { label: s.label, from: 0, to: level, delta: level, kind: 'total' };
      return bar;
    }
    const from = level;
    level += s.value;
    return { label: s.label, from, to: level, delta: s.value, kind: s.value < 0 ? 'decrease' : 'increase' };
  });
}

/* ----------------------------------------------------------------- forest */

export type ForestItem<R> = { kind: 'header'; label: string } | { kind: 'row'; row: R; index: number };

/** Rows in display order: rows of a group are kept together (groups in order of first appearance) behind a header;
    rows without a group come first, without a header when no group exists at all. */
export function forestItems<R extends { group?: string | null }>(rows: R[]): ForestItem<R>[] {
  const names: string[] = [];
  rows.forEach((r) => r.group && !names.includes(r.group) && names.push(r.group));
  const items: ForestItem<R>[] = [];
  rows.forEach((row, index) => !row.group && items.push({ kind: 'row', row, index }));
  for (const g of names) {
    items.push({ kind: 'header', label: g });
    rows.forEach((row, index) => row.group === g && items.push({ kind: 'row', row, index }));
  }
  return items;
}

/** Side of a weight marker (area proportional to the weight), between `min` and `max` px. */
export function weightSide(weight: number | null | undefined, maxWeight: number, min: number, max: number): number {
  if (weight === null || weight === undefined || !(weight > 0) || !(maxWeight > 0)) return (min + max) / 2;
  return Math.max(min, max * Math.sqrt(Math.min(1, weight / maxWeight)));
}

/** Ticks of a log axis: 1, 2 and 5 times powers of ten inside [lo, hi] (thinned to 1 and 5 / only powers when crowded). */
export function logTicks(lo: number, hi: number, count: number): number[] {
  if (!(lo > 0) || !(hi > lo)) return [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  const all = (mults: number[]) => {
    const out: number[] = [];
    for (let e = e0; e <= e1; e++) for (const m of mults) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.999999 && v <= hi * 1.000001) out.push(v);
    }
    return out;
  };
  for (const mults of [[1, 2, 5], [1, 5], [1]]) {
    const t = all(mults);
    if (t.length <= count) return t;
  }
  // many decades: every k-th power
  const decades = all([1]);
  const k = Math.ceil(decades.length / Math.max(1, count));
  return decades.filter((_, i) => i % k === 0);
}

/* ------------------------------------------------------------ marginals */

/** Type 7 quantile of sorted values. */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  lo: number;
  hi: number;
  outliers: number[];
  n: number;
}

/** Tukey box: whiskers reach the most extreme values within 1.5 IQR of the quartiles. */
export function boxStats(values: number[]): BoxStats | null {
  const v = values.filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quantileSorted(v, 0.25);
  const q3 = quantileSorted(v, 0.75);
  const iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return { q1, median: quantileSorted(v, 0.5), q3, lo: inside[0], hi: inside[inside.length - 1], outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr), n: v.length };
}

/** Histogram counts over [lo, hi] in `bins` equal bins (values outside are ignored; hi belongs to the last bin). */
export function histCounts(values: number[], lo: number, hi: number, bins: number): number[] {
  const out = new Array<number>(Math.max(1, bins)).fill(0);
  if (!(hi > lo)) return out;
  for (const v of values) {
    if (!(v >= lo && v <= hi)) continue;
    out[Math.min(out.length - 1, Math.floor(((v - lo) / (hi - lo)) * out.length))]++;
  }
  return out;
}

/** Number of bins for a marginal histogram (Sturges, 5..24). */
export const marginalBins = (n: number): number => Math.min(24, Math.max(5, Math.ceil(Math.log2(Math.max(1, n))) + 1));

/** Gaussian kernel density of `values` on `samples` points over [lo, hi] (Silverman bandwidth). */
export function kdeCurve(values: number[], lo: number, hi: number, samples = 64): [number, number][] {
  const v = values.filter((x) => isFinite(x));
  const n = v.length;
  if (n < 2 || !(hi > lo)) return [];
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1));
  const sorted = [...v].sort((a, b) => a - b);
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const spread = Math.min(sd, iqr > 0 ? iqr / 1.34 : sd);
  const bw = 0.9 * (spread > 0 ? spread : sd > 0 ? sd : (hi - lo) / 10) * Math.pow(n, -0.2);
  const out: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const x = lo + ((hi - lo) * i) / (samples - 1);
    let s = 0;
    for (const xi of v) {
      const z = (x - xi) / bw;
      s += Math.exp(-0.5 * z * z);
    }
    out.push([x, s / (n * bw * Math.sqrt(2 * Math.PI))]);
  }
  return out;
}
