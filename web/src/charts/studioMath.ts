/* Pure math behind the studio charts: fit lines, stacking, Pareto cumulation, colour ramps.
   No DOM, no React.  SPDX-License-Identifier: GPL-3.0-or-later */

import { niceStep, safeExtent, type Ticks } from './scale';

export type FitKind = 'linear' | 'quadratic' | 'cubic' | 'loess';
export type P2 = [number, number];

const DEGREE: Record<Exclude<FitKind, 'loess'>, number> = { linear: 1, quadratic: 2, cubic: 3 };

/** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

interface PolyDesign {
  k: number;
  z: (x: number) => number;
  ata: number[][];
  coef: number[];
}

/** Normal equations of a least squares polynomial in the centred, scaled x; null when degenerate. */
function polyDesign(pts: P2[], degree: number): PolyDesign | null {
  const n = pts.length;
  if (n <= degree) return null;
  const xs = pts.map((p) => p[0]);
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (!(sd > 0)) return null;
  const z = (x: number) => (x - mean) / sd;
  const k = degree + 1;
  const ata = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb = new Array<number>(k).fill(0);
  for (const [x, y] of pts) {
    const zz = z(x);
    const pw = [1];
    for (let i = 1; i < 2 * k; i++) pw.push(pw[i - 1] * zz);
    for (let i = 0; i < k; i++) {
      atb[i] += pw[i] * y;
      for (let j = 0; j < k; j++) ata[i][j] += pw[i + j];
    }
  }
  const coef = solve(ata, atb);
  return coef ? { k, z, ata, coef } : null;
}

const evalPoly = (d: PolyDesign, x: number): number => {
  const zz = d.z(x);
  let s = 0;
  for (let i = d.coef.length - 1; i >= 0; i--) s = s * zz + d.coef[i];
  return s;
};

/** Least squares polynomial; returns a predictor (coefficients in the centred, scaled x), or null
    when there are too few distinct x values. */
export function polyFit(pts: P2[], degree: number): ((x: number) => number) | null {
  const d = polyDesign(pts, degree);
  return d ? (x) => evalPoly(d, x) : null;
}

/** The weights l_i with yhat(x0) = sum l_i y_i for local linear regression (tricube weights, `span` is
    the fraction of points in each window); null when there are too few points. */
export function loessWeights(pts: P2[], x0: number, span = 0.75): number[] | null {
  const n = pts.length;
  if (n < 3) return null;
  const q = Math.min(n, Math.max(3, Math.ceil(span * n)));
  const d = pts.map((p) => Math.abs(p[0] - x0)).sort((a, b) => a - b);
  const h = Math.max(d[q - 1], 1e-12);
  const w = new Array<number>(n).fill(0);
  let sw = 0;
  let swx = 0;
  let swxx = 0;
  for (let i = 0; i < n; i++) {
    const u = Math.abs(pts[i][0] - x0) / h;
    if (u >= 1) continue;
    const wi = (1 - u ** 3) ** 3;
    w[i] = wi;
    sw += wi;
    swx += wi * pts[i][0];
    swxx += wi * pts[i][0] * pts[i][0];
  }
  if (sw <= 0) return null;
  const det = sw * swxx - swx * swx;
  if (Math.abs(det) < 1e-12 * Math.max(1, sw * swxx)) return w.map((wi) => wi / sw);
  return w.map((wi, i) => {
    const bi = (wi * (sw * pts[i][0] - swx)) / det;
    return (wi - bi * swx) / sw + bi * x0;
  });
}

/** Local linear regression at x0 (see loessWeights). */
export function loessAt(pts: P2[], x0: number, span = 0.75): number | null {
  const l = loessWeights(pts, x0, span);
  if (!l) return null;
  let s = 0;
  for (let i = 0; i < l.length; i++) s += l[i] * pts[i][1];
  return s;
}

export interface FitResult {
  /** curve samples, ascending in x */
  curve: P2[];
  /** coefficient of determination of the fit on the points (null when not defined) */
  r2: number | null;
}

/** Fit `kind` through the points and sample the curve over [x0, x1].  Null when it cannot be fitted. */
export function fitCurve(points: P2[], kind: FitKind, x0: number, x1: number, samples = 80): FitResult | null {
  const pts = points.filter((p) => isFinite(p[0]) && isFinite(p[1]));
  let f: ((x: number) => number | null) | null;
  if (kind === 'loess') f = (x) => loessAt(pts, x);
  else f = polyFit(pts, DEGREE[kind]);
  if (!f || !(x1 > x0 || (x1 === x0 && samples === 1))) return null;
  const curve: P2[] = [];
  for (let i = 0; i < samples; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, samples - 1);
    const y = f(x);
    if (y !== null && isFinite(y)) curve.push([x, y]);
  }
  if (curve.length < 2) return null;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const [x, y] of pts) {
    const fy = f(x);
    ssTot += (y - my) ** 2;
    if (fy !== null) ssRes += (y - fy) ** 2;
  }
  return { curve, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : null };
}

/* ---------------------------------------------------------------- stacking */

export interface Segment {
  cat: number;
  series: number;
  /** value range covered (v0 <= v1 for positives, v0 >= v1 for negatives); in percent for stack100 */
  v0: number;
  v1: number;
  /** the unscaled value */
  raw: number;
}

/** Stack `values[series][category]` per category.  Positives stack upward, negatives downward.
    'stack100' scales each category to 100 (by the sum of absolute values). */
export function stackSegments(values: (number | null)[][], mode: 'stack' | 'stack100'): Segment[] {
  const out: Segment[] = [];
  const nCat = values.reduce((m, s) => Math.max(m, s.length), 0);
  for (let c = 0; c < nCat; c++) {
    const total = values.reduce((s, ser) => s + Math.abs(ser[c] ?? 0), 0);
    let pos = 0;
    let neg = 0;
    values.forEach((ser, si) => {
      const raw = ser[c];
      if (raw === null || raw === undefined || !isFinite(raw)) return;
      const v = mode === 'stack100' ? (total > 0 ? (raw * 100) / total : 0) : raw;
      if (v >= 0) {
        out.push({ cat: c, series: si, v0: pos, v1: pos + v, raw });
        pos += v;
      } else {
        out.push({ cat: c, series: si, v0: neg, v1: neg + v, raw });
        neg += v;
      }
    });
  }
  return out;
}

/* ------------------------------------------------------------------ pareto */

/** Cumulative percentage (0..100) after each bar, relative to `total`. */
export function cumulativePercent(counts: number[], total: number): number[] {
  const t = total > 0 ? total : counts.reduce((s, v) => s + v, 0);
  let acc = 0;
  return counts.map((c) => {
    acc += c;
    return t > 0 ? Math.min(100, (acc * 100) / t) : 0;
  });
}

/* -------------------------------------------------------- dot plot stacking */

/** Largest number of dots in one stack and the dot radius that lets every stack fit in `height`. */
export function dotRadius(maxStack: number, binPx: number, height: number): number {
  const byWidth = binPx / 2 - 0.5;
  const byHeight = maxStack > 0 ? height / (2 * maxStack) : byWidth;
  return Math.max(1.5, Math.min(byWidth, byHeight, 9));
}

/* ----------------------------------------------------------------- heatmap */

/** Mix percentage (4..100) of the accent colour for a count; sqrt keeps sparse cells visible. */
export function rampPercent(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.round(18 + 82 * Math.sqrt(count / max));
}

/** Sequential colour for a cell: the accent mixed into the chart surface. */
export function rampColor(count: number, max: number, accent = 'var(--c-series-1)'): string {
  const p = rampPercent(count, max);
  return p === 0 ? 'transparent' : `color-mix(in srgb, ${accent} ${p}%, var(--c-surface))`;
}

/* ------------------------------------------------------- confidence band of a fit */

const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** 97.5 % quantile of Student's t with `df` degrees of freedom (table up to 30, Cornish-Fisher beyond;
    fractional df interpolate). */
export function tQuantile975(df: number): number {
  if (!(df > 1)) return T975[0];
  if (df <= 30) {
    const i = Math.floor(df);
    const f = df - i;
    return i >= 30 ? T975[29] : T975[i - 1] * (1 - f) + T975[i] * f;
  }
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

export interface BandPoint {
  x: number;
  fit: number;
  lo: number;
  hi: number;
}

/** 95 % confidence band for the mean response of a polynomial fit of degree p-1 (k = p parameters):
        yhat(x0) +- t(0.975, n-k) * s * sqrt(phi(x0)' (X'X)^-1 phi(x0))
    with s^2 = SSE / (n-k) and phi(x0) = (1, z, z^2, ...) the basis in the centred, scaled x.  Null when n <= k. */
export function polyBand(points: P2[], degree: number, x0: number, x1: number, samples = 80): BandPoint[] | null {
  const pts = points.filter((p) => isFinite(p[0]) && isFinite(p[1]));
  const d = polyDesign(pts, degree);
  if (!d || pts.length <= d.k) return null;
  const df = pts.length - d.k;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - evalPoly(d, x)) ** 2;
  const s2 = sse / df;
  const t = tQuantile975(df);
  const out: BandPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, samples - 1);
    const zz = d.z(x);
    const phi = [1];
    for (let j = 1; j < d.k; j++) phi.push(phi[j - 1] * zz);
    const v = solve(d.ata, phi);
    if (!v) return null;
    const h = phi.reduce((s, p, j) => s + p * v[j], 0);
    const half = t * Math.sqrt(Math.max(0, s2 * h));
    const fit = evalPoly(d, x);
    out.push({ x, fit, lo: fit - half, hi: fit + half });
  }
  return out;
}

const LOESS_EXACT_MAX = 600;

/** 95 % band around a loess fit.  loess is linear in y, yhat(x0) = sum l_i(x0) y_i, so
        se(x0) = s * sqrt(sum l_i(x0)^2),  s^2 = SSE / d1,  d1 = n - 2 tr(L) + tr(L'L)
    (L the smoother matrix at the data points) and the t quantile uses d1 degrees of freedom.  For more than
    600 points d1 and s are estimated on an evenly thinned subset.  Null when it cannot be computed. */
export function loessBand(points: P2[], x0: number, x1: number, samples = 80, span = 0.75): BandPoint[] | null {
  const all = points.filter((p) => isFinite(p[0]) && isFinite(p[1]));
  if (all.length < 5) return null;
  let sub = all;
  if (all.length > LOESS_EXACT_MAX) {
    const sorted = [...all].sort((a, b) => a[0] - b[0]);
    sub = Array.from({ length: LOESS_EXACT_MAX }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / (LOESS_EXACT_MAX - 1))]);
  }
  const n = sub.length;
  let tr = 0;
  let trLtL = 0;
  let sse = 0;
  for (let j = 0; j < n; j++) {
    const l = loessWeights(sub, sub[j][0], span);
    if (!l) return null;
    tr += l[j];
    let fit = 0;
    for (let i = 0; i < n; i++) {
      trLtL += l[i] * l[i];
      fit += l[i] * sub[i][1];
    }
    sse += (sub[j][1] - fit) ** 2;
  }
  const d1 = n - 2 * tr + trLtL;
  if (!(d1 > 1)) return null;
  const s = Math.sqrt(sse / d1);
  const t = tQuantile975(d1);
  const out: BandPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, samples - 1);
    const l = loessWeights(sub, x, span);
    const fit = loessAt(all, x, span);
    if (!l || fit === null) continue;
    const half = t * s * Math.sqrt(l.reduce((a, v) => a + v * v, 0));
    out.push({ x, fit, lo: fit - half, hi: fit + half });
  }
  return out.length > 1 ? out : null;
}

/** 95 % confidence band of a fit over [x0, x1]; null when it cannot be computed. */
export function fitBand(points: P2[], kind: FitKind, x0: number, x1: number, samples = 80): BandPoint[] | null {
  if (!(x1 > x0)) return null;
  return kind === 'loess' ? loessBand(points, x0, x1, samples) : polyBand(points, DEGREE[kind], x0, x1, samples);
}

/* ------------------------------------------------------------- ticks and paths */

/** Ticks with exactly `intervals` equal intervals on a nice step (so two axes of one plot can share
    their gridlines); the domain starts on a multiple of the step and covers [min, max]. */
export function alignedTicks(min: number, max: number, intervals: number): Ticks {
  [min, max] = safeExtent(min, max);
  const raw = (max - min) / Math.max(1, intervals);
  let p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = p;
  for (let guard = 0; guard < 60; guard++, p *= 10) {
    let found = false;
    for (const m of [1, 2, 2.5, 5]) {
      step = m * p;
      if (step < raw * (1 - 1e-9)) continue;
      const lo = Math.floor(min / step + 1e-9) * step;
      if (lo + intervals * step >= max - step * 1e-9) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const r = (v: number) => Number(v.toFixed(Math.min(20, dec + 1))) + 0;
  const lo = r(Math.floor(min / step + 1e-9) * step);
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => r(lo + i * step));
  return { ticks, step, domain: [lo, ticks[intervals]] };
}

/** Whole-number ticks 1..n (about `count` of them) for a case-number axis. */
export function intTicks(n: number, count: number): Ticks {
  const step = Math.max(1, Math.round(niceStep(n, Math.max(2, count))));
  const ticks: number[] = step === 1 ? [] : [1];
  for (let i = step; i <= n; i += step) ticks.push(i);
  if (step === 1 && n >= 1 && !ticks.length) ticks.push(1);
  return { ticks, step, domain: [0.5, n + 0.5] };
}

/** A per point limit as a stepped line: each value holds over [x - half, x + half]. */
export function stepPoints(xs: number[], vals: number[], half = 0.5): P2[] {
  const out: P2[] = [];
  xs.forEach((x, i) => {
    if (!isFinite(vals[i])) return;
    out.push([x - half, vals[i]], [x + half, vals[i]]);
  });
  return out;
}

/** Closed path of a mirrored density: the curve at cx + w(d) and back at cx - w(d); `px` maps the
    density to a half width, `py` the value to a pixel row. */
export function mirrorPath(points: P2[], cx: number, px: (d: number) => number, py: (v: number) => number): string {
  if (points.length < 2) return '';
  const f = (v: number) => v.toFixed(1);
  let d = '';
  points.forEach(([v, dens], i) => {
    d += `${i ? 'L' : 'M'}${f(cx + px(dens))},${f(py(v))}`;
  });
  for (let i = points.length - 1; i >= 0; i--) d += `L${f(cx - px(points[i][1]))},${f(py(points[i][0]))}`;
  return d + 'Z';
}

/* ------------------------------------------------------------ clustered boxes */

export interface BoxCluster {
  labels: string[];
  groups: string[];
  /** per input box: its label index and group index (0 when there is no group) */
  cell: { li: number; gi: number }[];
  clustered: boolean;
}

/** Boxes with the same label form a cluster (one slot per group inside it).  Without any group the
    layout is one box per label in input order. */
export function clusterBoxes(boxes: { label: string; group?: string | null }[]): BoxCluster {
  const clustered = boxes.some((b) => b.group != null);
  if (!clustered) return { labels: boxes.map((b) => b.label), groups: [], cell: boxes.map((_, i) => ({ li: i, gi: 0 })), clustered: false };
  const labels: string[] = [];
  const groups: string[] = [];
  const cell = boxes.map((b) => {
    if (!labels.includes(b.label)) labels.push(b.label);
    const g = b.group ?? '';
    if (!groups.includes(g)) groups.push(g);
    return { li: labels.indexOf(b.label), gi: groups.indexOf(g) };
  });
  return { labels, groups, cell, clustered };
}
