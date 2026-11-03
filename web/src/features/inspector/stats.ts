/*
 * Quick client-side statistics for the variable inspector (no engine round trip).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Measure, Variable } from '../../engine/types';
import { isMissingValue, valueLabelFor } from '../../lib/format';

export interface FreqRow {
  value: number | string;
  label?: string;
  count: number;
  /** user-missing code */
  missing: boolean;
}

export interface HistBin {
  x0: number;
  x1: number;
  count: number;
}

export interface VarStats {
  /** number of cases */
  n: number;
  valid: number;
  /** system-missing (numeric) or empty (string) */
  sysmis: number;
  userMissing: number;
  distinct: number;
  /** every valid numeric value is an integer */
  integers: boolean;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** valid + user-missing values by frequency (descending), at most maxFreq */
  freqs: FreqRow[];
  /** number of distinct values not listed in freqs */
  otherDistinct: number;
  otherCount: number;
  hist: HistBin[];
}

function quantile(sorted: Float64Array, p: number): number {
  // HAVERAGE-like definition (PSPP default for percentiles): position (n+1)p
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n + 1) * p;
  if (pos <= 1) return sorted[0];
  if (pos >= n) return sorted[n - 1];
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return sorted[lo - 1] + frac * (sorted[lo] - sorted[lo - 1]);
}

/** "Nice" histogram bins (1, 2, 2.5, 5 × 10^k widths), about TARGET bins. */
export function histogram(values: Float64Array, target = 12): HistBin[] {
  if (!values.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const x of values) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (min === max) return [{ x0: min - 0.5, x1: max + 0.5, count: values.length }];
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const nb = Math.max(1, Math.ceil((max - start) / step + 1e-9));
  const bins: HistBin[] = Array.from({ length: nb }, (_, i) => ({ x0: start + i * step, x1: start + (i + 1) * step, count: 0 }));
  for (const x of values) {
    let i = Math.floor((x - start) / step);
    if (i >= nb) i = nb - 1;
    if (i < 0) i = 0;
    bins[i].count++;
  }
  return bins;
}

export function computeStats(v: Variable, col: readonly Cell[], opts: { maxFreq?: number; bins?: number } = {}): VarStats {
  const maxFreq = opts.maxFreq ?? 8;
  const n = col.length;
  let sysmis = 0;
  let userMissing = 0;
  const counts = new Map<number | string, { count: number; missing: boolean }>();
  const nums: number[] = [];
  const hasUserMissing = v.missing.values.length > 0 || !!v.missing.range;
  let integers = true;
  for (let i = 0; i < n; i++) {
    const c = col[i];
    if (c === null || c === undefined || (typeof c === 'string' && c.trim() === '')) {
      sysmis++;
      continue;
    }
    const miss = hasUserMissing && isMissingValue(c, v);
    if (miss) userMissing++;
    const key = typeof c === 'string' ? c.trimEnd() : c;
    const e = counts.get(key);
    if (e) e.count++;
    else counts.set(key, { count: 1, missing: miss });
    if (!miss && typeof c === 'number') {
      nums.push(c);
      if (integers && !Number.isInteger(c)) integers = false;
    }
  }
  const valid = n - sysmis - userMissing;
  let mean: number | null = null;
  let sd: number | null = null;
  let min: number | null = null;
  let max: number | null = null;
  let median: number | null = null;
  let q1: number | null = null;
  let q3: number | null = null;
  let hist: HistBin[] = [];
  if (nums.length) {
    const arr = Float64Array.from(nums);
    let sum = 0;
    for (const x of arr) sum += x;
    mean = sum / arr.length;
    let ss = 0;
    for (const x of arr) ss += (x - mean) ** 2;
    sd = arr.length > 1 ? Math.sqrt(ss / (arr.length - 1)) : null;
    const sorted = arr.slice().sort();
    min = sorted[0];
    max = sorted[sorted.length - 1];
    median = quantile(sorted, 0.5);
    q1 = quantile(sorted, 0.25);
    q3 = quantile(sorted, 0.75);
    hist = histogram(arr, opts.bins ?? 12);
  }
  const all: FreqRow[] = [...counts.entries()].map(([value, e]) => ({ value, count: e.count, missing: e.missing, label: valueLabelFor(value, v) }));
  all.sort((a, b) => b.count - a.count || (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
  const freqs = all.slice(0, maxFreq);
  const rest = all.slice(maxFreq);
  return {
    n,
    valid,
    sysmis,
    userMissing,
    distinct: counts.size,
    integers,
    mean,
    sd,
    min,
    max,
    median,
    q1,
    q3,
    freqs,
    otherDistinct: rest.length,
    otherCount: rest.reduce((s, r) => s + r.count, 0),
    hist,
  };
}

/** Whether the inspector shows a distribution as categories (bars per value) or a histogram. */
export function isCategorical(v: Variable, s: Pick<VarStats, 'distinct'>): boolean {
  if (v.type === 'string') return true;
  if (v.measure === 'nominal' || v.measure === 'ordinal') return true;
  return s.distinct <= 2;
}

export type MeasureHint = { measure: Measure; reason: 'twoValues' | 'labelled' | 'fewIntegers' | 'manyValues' };

/**
 * Suggests a measurement level when the current one looks wrong (audit VV-2), or null.
 * Conservative: only flags clear cases.
 */
export function suggestMeasure(v: Variable, s: Pick<VarStats, 'distinct' | 'integers' | 'valid'>): MeasureHint | null {
  if (v.type === 'string' || s.valid < 3) return null;
  if (v.measure === 'scale' || v.measure === 'unknown') {
    if (s.distinct <= 2) return { measure: 'nominal', reason: 'twoValues' };
    if (v.valueLabels.length >= 2 && s.integers && s.distinct <= Math.max(10, v.valueLabels.length + 1)) return { measure: v.valueLabels.length >= 4 ? 'ordinal' : 'nominal', reason: 'labelled' };
    if (s.integers && s.distinct <= 5 && s.valid >= 20) return { measure: 'ordinal', reason: 'fewIntegers' };
    return null;
  }
  // categorical with many distinct non-integer values → probably scale
  if (!s.integers && s.distinct > 15 && v.valueLabels.length < 2) return { measure: 'scale', reason: 'manyValues' };
  return null;
}
