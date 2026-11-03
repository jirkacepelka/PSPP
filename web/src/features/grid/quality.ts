/*
 * Data-quality flags (audit F4 / DV-6): values without a label in labelled categorical
 * variables, values outside the variable's valid range, and suspicious strings.
 * Pure functions, cheap per cell (O(1) after a per-variable setup).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Variable } from '../../engine/types';
import { isMissingValue, labelIndex } from '../../lib/format';

export type FlagKind = 'noLabel' | 'outOfRange' | 'whitespace' | 'caseVariant';

export type CellChecker = (cell: Cell) => FlagKind | null;

const NONE: CellChecker = () => null;
const checkerCache = new WeakMap<Variable, CellChecker>();

/** True when V is a categorical variable whose labels define the allowed codes. */
export function labelsDefineDomain(v: Variable): boolean {
  return v.valueLabels.length >= 2 && (v.measure === 'nominal' || v.measure === 'ordinal');
}

/** Builds (and caches per variable object) a function that flags one cell of V. */
export function cellChecker(v: Variable): CellChecker {
  const hit = checkerCache.get(v);
  if (hit) return hit;
  const domain = labelsDefineDomain(v);
  const range = v.validRange && Number.isFinite(v.validRange.min) && Number.isFinite(v.validRange.max) ? v.validRange : null;
  let fn: CellChecker = NONE;
  if (v.type === 'numeric') {
    if (domain || range) {
      const labels = labelIndex(v);
      const hasMissing = v.missing.values.length > 0 || !!v.missing.range;
      fn = (c) => {
        if (c === null || typeof c !== 'number') return null;
        if (hasMissing && isMissingValue(c, v)) return null;
        if (range && (c < range.min || c > range.max)) return 'outOfRange';
        if (domain && !labels.has(c)) return 'noLabel';
        return null;
      };
    }
  } else {
    const labels = labelIndex(v);
    const lower = new Map<string, string>();
    for (const k of labels.keys()) lower.set(String(k).toLowerCase(), String(k));
    fn = (c) => {
      if (typeof c !== 'string' || c === '') return null;
      const k = c.trimEnd();
      if (k === '') return null;
      if (/^\s/.test(c) || /\s{2,}/.test(k)) return 'whitespace';
      if (labels.size) {
        if (labels.has(k)) return null;
        if (isMissingValue(c, v)) return null;
        if (lower.has(k.toLowerCase())) return 'caseVariant';
        if (domain) return 'noLabel';
      }
      return null;
    };
  }
  checkerCache.set(v, fn);
  return fn;
}

export interface ColumnQuality {
  total: number;
  byKind: Partial<Record<FlagKind, number>>;
  /** distinct offending values (display order: first seen), at most `maxExamples` */
  examples: Cell[];
  /** row indices of flagged cells (at most `maxRows`) */
  rows: number[];
}

/** Scans one column. O(n); call from a memo keyed on the column array. */
export function columnQuality(v: Variable, col: readonly Cell[], maxExamples = 6, maxRows = 1000): ColumnQuality {
  const check = cellChecker(v);
  const out: ColumnQuality = { total: 0, byKind: {}, examples: [], rows: [] };
  if (check === NONE) return out;
  const seen = new Set<Cell>();
  for (let r = 0; r < col.length; r++) {
    const c = col[r];
    const k = check(c);
    if (!k) continue;
    out.total++;
    out.byKind[k] = (out.byKind[k] ?? 0) + 1;
    if (out.rows.length < maxRows) out.rows.push(r);
    const key = typeof c === 'string' ? c.trimEnd() : c;
    if (!seen.has(key) && out.examples.length < maxExamples) {
      seen.add(key);
      out.examples.push(c);
    }
  }
  return out;
}
