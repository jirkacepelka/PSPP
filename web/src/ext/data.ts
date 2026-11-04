/*
 * Case access for extension analyses, honouring FILTER, WEIGHT, SPLIT FILE and missing values
 * the way PSPP procedures do.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, Variable } from '../engine/types';
import { ExtError } from './types';

export type Cell = number | string | null;

export function variable(ds: Dataset, name: string): { v: Variable; col: Cell[]; index: number } {
  const index = ds.variables.findIndex((x) => x.name.toUpperCase() === name.toUpperCase());
  if (index < 0) throw new ExtError(`${name} is not a variable name.`);
  return { v: ds.variables[index], col: (ds.columns[index] ?? []) as Cell[], index };
}

export function caseCount(ds: Dataset): number {
  return Math.max(0, ...ds.columns.map((c) => c?.length ?? 0));
}

/** System-missing, or user-missing unless INCLUDEUSER. */
export function isMissing(v: Variable, x: Cell, includeUser = false): boolean {
  if (x === null || x === undefined) return true;
  if (v.type !== 'string' && typeof x === 'number' && !Number.isFinite(x)) return true;
  if (includeUser) return false;
  const m = v.missing;
  if (!m) return false;
  if (v.type === 'string') return (m.values ?? []).some((y) => String(y).trimEnd() === String(x).trimEnd());
  if ((m.values ?? []).some((y) => y === x)) return true;
  if (m.range && typeof x === 'number') {
    const lo = m.range.low ?? -Infinity;
    const hi = m.range.high ?? Infinity;
    if (x >= lo && x <= hi) return true;
  }
  return false;
}

/** Case weights: 1 without WEIGHT; missing, zero or negative weights give 0 (case excluded). */
export function weights(ds: Dataset): number[] {
  const n = caseCount(ds);
  if (!ds.weight) return new Array(n).fill(1);
  const { v, col } = variable(ds, ds.weight);
  return Array.from({ length: n }, (_, r) => {
    const w = col[r];
    return typeof w === 'number' && w > 0 && !isMissing(v, w) ? w : 0;
  });
}

/** Rows passing the FILTER (a non-zero, non-missing filter value) and having positive weight. */
export function activeRows(ds: Dataset): number[] {
  const n = caseCount(ds);
  const w = weights(ds);
  let rows = Array.from({ length: n }, (_, r) => r).filter((r) => w[r] > 0);
  if (ds.filter) {
    const { v, col } = variable(ds, ds.filter);
    rows = rows.filter((r) => {
      const x = col[r];
      return typeof x === 'number' && x !== 0 && !isMissing(v, x);
    });
  }
  return rows;
}

export interface SplitGroup {
  /** e.g. "gender = Female, year = 1st year"; '' when there is no SPLIT FILE */
  label: string;
  rows: number[];
}

/** Active rows grouped by SPLIT FILE (contiguous runs, as PSPP does for unsorted data). */
export function splitGroups(ds: Dataset): SplitGroup[] {
  const rows = activeRows(ds);
  if (!ds.split?.length) return [{ label: '', rows }];
  const sv = ds.split.map((n) => variable(ds, n));
  const groups: SplitGroup[] = [];
  let key = '\u0000';
  for (const r of rows) {
    const k = JSON.stringify(sv.map((s) => s.col[r]));
    if (k !== key) {
      key = k;
      groups.push({
        label: sv.map((s) => `${s.v.label || s.v.name} = ${valueText(s.v, s.col[r])}`).join(', '),
        rows: [],
      });
    }
    groups[groups.length - 1].rows.push(r);
  }
  return groups;
}

/** Value label, or the value itself. */
export function valueText(v: Variable, x: Cell): string {
  if (x === null || x === undefined) return '.';
  const l = (v.valueLabels ?? []).find((vl) => (v.type === 'string' ? String(vl.value).trimEnd() === String(x).trimEnd() : vl.value === x));
  return l ? l.label : typeof x === 'number' ? String(x) : String(x).trimEnd();
}

/** Display name of a variable in output: its label, or name. */
export const varTitle = (v: Variable) => v.label || v.name;

export function requireNumeric(v: Variable) {
  if (v.type === 'string') throw new ExtError(`${v.name} is a string variable; a numeric variable is required.`);
}
