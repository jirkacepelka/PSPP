/*
 * Weighted descriptive statistics used by the mock engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface WV {
  x: number;
  w: number;
}

export interface Moments {
  n: number;
  mean: number;
  variance: number;
  sd: number;
  se: number;
  min: number;
  max: number;
  sum: number;
  skewness: number;
  seSkew: number;
  kurtosis: number;
  seKurt: number;
}

export function moments(data: WV[]): Moments {
  const W = data.reduce((s, d) => s + d.w, 0);
  const sum = data.reduce((s, d) => s + d.w * d.x, 0);
  const mean = W > 0 ? sum / W : NaN;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const d of data) {
    const dev = d.x - mean;
    m2 += d.w * dev * dev;
    m3 += d.w * dev ** 3;
    m4 += d.w * dev ** 4;
  }
  const variance = W > 1 ? m2 / (W - 1) : NaN;
  const sd = Math.sqrt(variance);
  const n = W;
  // SPSS/PSPP style sample skewness and kurtosis
  const skewness = n > 2 && variance > 0 ? (n * m3) / ((n - 1) * (n - 2) * sd ** 3) : NaN;
  const kurtosis =
    n > 3 && variance > 0 ? (n * (n + 1) * m4 - 3 * m2 * m2 * (n - 1)) / ((n - 1) * (n - 2) * (n - 3) * variance ** 2) : NaN;
  const seSkew = n > 2 ? Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3))) : NaN;
  const seKurt = n > 3 ? Math.sqrt((4 * (n * n - 1) * seSkew * seSkew) / ((n - 3) * (n + 5))) : NaN;
  return {
    n: W,
    mean,
    variance,
    sd,
    se: sd / Math.sqrt(W),
    min: data.length ? Math.min(...data.map((d) => d.x)) : NaN,
    max: data.length ? Math.max(...data.map((d) => d.x)) : NaN,
    sum,
    skewness,
    seSkew,
    kurtosis,
    seKurt,
  };
}

/** Weighted percentile using the HAVERAGE-like definition (as PSPP default). */
export function percentile(data: WV[], p: number): number {
  const sorted = [...data].sort((a, b) => a.x - b.x);
  const W = sorted.reduce((s, d) => s + d.w, 0);
  if (!sorted.length) return NaN;
  const pos = (p / 100) * (W + 1);
  if (pos < 1) return sorted[0].x;
  if (pos >= W) return sorted[sorted.length - 1].x;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = cum;
    cum += sorted[i].w;
    if (pos < cum + 1 - 1e-9) {
      if (pos <= cum || i + 1 >= sorted.length) return sorted[i].x;
      const frac = pos - cum;
      void prev;
      return sorted[i].x + frac * (sorted[i + 1].x - sorted[i].x);
    }
  }
  return sorted[sorted.length - 1].x;
}

export function mode(data: WV[]): number {
  const m = new Map<number, number>();
  for (const d of data) m.set(d.x, (m.get(d.x) ?? 0) + d.w);
  let best = NaN;
  let bw = -1;
  for (const [x, w] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
    if (w > bw) {
      best = x;
      bw = w;
    }
  }
  return best;
}
