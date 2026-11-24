/* Pure math behind the studio charts: fit lines, stacking, Pareto cumulation, colour ramps.
   No DOM, no React.  SPDX-License-Identifier: GPL-3.0-or-later */

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

/** Least squares polynomial; returns a predictor (coefficients in the centred, scaled x), or null
    when there are too few distinct x values. */
export function polyFit(pts: P2[], degree: number): ((x: number) => number) | null {
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
  if (!coef) return null;
  return (x) => {
    const zz = z(x);
    let s = 0;
    for (let i = coef.length - 1; i >= 0; i--) s = s * zz + coef[i];
    return s;
  };
}

/** Local linear regression (tricube weights); `span` is the fraction of points in each window. */
export function loessAt(pts: P2[], x0: number, span = 0.75): number | null {
  const n = pts.length;
  if (n < 3) return null;
  const q = Math.min(n, Math.max(3, Math.ceil(span * n)));
  const d = pts.map((p) => Math.abs(p[0] - x0)).sort((a, b) => a - b);
  const h = Math.max(d[q - 1], 1e-12);
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (const [x, y] of pts) {
    const u = Math.abs(x - x0) / h;
    if (u >= 1) continue;
    const w = (1 - u ** 3) ** 3;
    sw += w;
    swx += w * x;
    swy += w * y;
    swxx += w * x * x;
    swxy += w * x * y;
  }
  if (sw <= 0) return null;
  const det = sw * swxx - swx * swx;
  if (Math.abs(det) < 1e-12 * Math.max(1, sw * swxx)) return swy / sw;
  const b = (sw * swxy - swx * swy) / det;
  const a = (swy - b * swx) / sw;
  return a + b * x0;
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
