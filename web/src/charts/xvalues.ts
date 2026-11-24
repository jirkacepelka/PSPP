/* Numeric x positions for category charts (the optional `xValues` of line, area and high-low specs):
   categories sit proportionally on a numeric axis with nice ticks instead of evenly spaced.
   SPDX-License-Identifier: GPL-3.0-or-later */

import { linearScale, padExtent, tickFormatter, ticksWithin, type LinearScale } from './scale';

/** `xValues` from untrusted JSON: one finite number per category, ascending; undefined otherwise. */
export function parseXValues(v: unknown, n: number): number[] | undefined {
  if (!Array.isArray(v) || n < 1 || v.length < n) return undefined;
  const out = v.slice(0, n);
  for (let i = 0; i < n; i++) {
    const x = out[i];
    if (typeof x !== 'number' || !isFinite(x) || (i > 0 && x < out[i - 1])) return undefined;
  }
  return out as number[];
}

export interface NumericAxis {
  scale: LinearScale;
  ticks: number[];
  step: number;
  format: (v: number) => string;
  /** pixel x of every category */
  xs: number[];
}

/** Axis over `xv` between pixel `left` and `left + width`; whole-number ticks (years) print without grouping. */
export function numericAxis(xv: number[], left: number, width: number, count: number, locale?: string, inset = 8): NumericAxis {
  const [d0, d1] = padExtent(xv[0], xv[xv.length - 1], 0.03);
  const t = ticksWithin(d0, d1, count);
  const scale = linearScale([d0, d1], [left + inset, left + width - inset]);
  const ints = t.ticks.every(Number.isInteger) && t.ticks.every((v) => Math.abs(v) < 1e5);
  return { scale, ticks: t.ticks, step: t.step, format: ints ? (v) => String(v) : tickFormatter(t.step, t.ticks, locale), xs: xv.map(scale) };
}

/** Index of the entry of ascending `xs` nearest to `px`. */
export function nearestIndex(xs: number[], px: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < px) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(xs[lo - 1] - px) <= Math.abs(xs[lo] - px) ? lo - 1 : lo;
}

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86400000;
const utc = (day: number) => new Date(Math.round(day) * DAY_MS);

/** A day number (days since 1970-01-01) as a date text, e.g. "14 Mar 2021". */
export function formatDay(day: number, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(utc(day));
  } catch {
    return utc(day).toISOString().slice(0, 10);
  }
}

/** Nice calendar ticks for a date axis over days [d0, d1] (days since 1970-01-01): whole years (1, 2, 5, 10 ...),
    quarters or months, or days and weeks, whichever gives about `count` ticks.  Returns the tick days and a formatter. */
export function dateTicks(d0: number, d1: number, count: number, locale?: string): { ticks: number[]; step: number; format: (v: number) => string } {
  const span = Math.max(1, d1 - d0);
  const want = Math.max(2, count);
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    let f: Intl.DateTimeFormat;
    try {
      f = new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' });
    } catch {
      f = new Intl.DateTimeFormat(undefined, { ...o, timeZone: 'UTC' });
    }
    return (v: number) => f.format(utc(v));
  };
  const ticks: number[] = [];
  // years
  const years = span / 365.25;
  if (years >= want * 0.9) {
    const raw = years / want;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const k = [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw) ?? 10 * p;
    const y0 = new Date(d0 * DAY_MS).getUTCFullYear();
    for (let y = Math.ceil(y0 / k) * k; ticks.length < 400; y += k) {
      const day = Date.UTC(y, 0, 1) / DAY_MS;
      if (day > d1) break;
      if (day >= d0) ticks.push(day);
    }
    return { ticks, step: k * 365.25, format: fmt({ year: 'numeric' }) };
  }
  // months
  const months = span / 30.4375;
  if (months >= want * 0.8) {
    const k = [1, 3, 6].find((m) => months / m <= want) ?? 12;
    const s = new Date(d0 * DAY_MS);
    const y = s.getUTCFullYear();
    let mo = Math.ceil(s.getUTCMonth() / k) * k;
    for (; ticks.length < 400; mo += k) {
      const day = Date.UTC(y, mo, 1) / DAY_MS;
      if (day > d1) break;
      if (day >= d0) ticks.push(day);
    }
    return { ticks, step: k * 30.4375, format: fmt({ year: 'numeric', month: 'short' }) };
  }
  // days and weeks
  const k = [1, 2, 3, 5, 7, 14, 28].find((m) => span / m <= want) ?? 28;
  for (let day = Math.ceil(d0 / k) * k; day <= d1 && ticks.length < 400; day += k) ticks.push(day);
  return { ticks, step: k, format: fmt({ day: 'numeric', month: 'short' }) };
}
