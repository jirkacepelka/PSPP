/*
 * Helpers for creating and validating variables.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Dataset, Variable, VarFormat } from '../engine/types';
import { DATE_FORMAT_WIDTH, isDateFormat } from './format';

export const RESERVED_WORDS = ['ALL', 'AND', 'BY', 'EQ', 'GE', 'GT', 'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH'];

export function isValidVarName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (RESERVED_WORDS.includes(name.toUpperCase())) return false;
  return /^[\p{L}@#$][\p{L}\p{N}_.@#$]*$/u.test(name) && !name.endsWith('.') && !name.endsWith('_');
}

export function makeVariable(name: string, init: Partial<Variable> = {}): Variable {
  const type = init.type ?? 'numeric';
  const width = type === 'string' ? (init.width && init.width > 0 ? init.width : 8) : 0;
  const fmt: VarFormat = type === 'string' ? { type: 'A', w: width, d: 0 } : { type: 'F', w: 8, d: 2 };
  return {
    name,
    label: '',
    type,
    width,
    print: { ...fmt },
    write: { ...fmt },
    valueLabels: [],
    missing: { values: [] },
    columns: type === 'string' ? Math.min(Math.max(width, 8), 32) : 8,
    align: type === 'string' ? 'left' : 'right',
    measure: type === 'string' ? 'nominal' : 'scale',
    role: 'input',
    ...init,
  };
}

/** Returns the first free name of the form VAR00001 not present in the dataset. */
export function nextVarName(existing: string[], prefix = 'VAR'): string {
  const set = new Set(existing.map((n) => n.toUpperCase()));
  for (let i = 1; i < 100000; i++) {
    const n = `${prefix}${String(i).padStart(5, '0')}`;
    if (!set.has(n)) return n;
  }
  return `${prefix}${Date.now()}`;
}

export function uniqueName(base: string, existing: string[]): string {
  const set = new Set(existing.map((n) => n.toUpperCase()));
  let name = base.replace(/[^\p{L}\p{N}_.@#$]/gu, '_').replace(/^[^\p{L}@#$]+/u, '') || 'V';
  name = name.slice(0, 64).replace(/[._]+$/, '') || 'V';
  if (RESERVED_WORDS.includes(name.toUpperCase())) name = `${name}_1`.replace(/_$/, '1');
  if (!set.has(name.toUpperCase())) return name;
  for (let i = 1; ; i++) {
    const n = `${name.slice(0, 60)}_${i}`;
    if (!set.has(n.toUpperCase())) return n;
  }
}

export function emptyDataset(name = 'Bez názvu'): Dataset {
  return { name, variables: [], columns: [], weight: null, filter: null, split: [], documents: [] };
}

export function caseCount(ds: Dataset | null | undefined): number {
  if (!ds) return 0;
  let n = 0;
  for (const c of ds.columns) n = Math.max(n, c.length);
  return n;
}

/** Converts a variable to a new type/format, converting existing values. */
export function changeVariableType(v: Variable, col: Cell[], type: 'numeric' | 'string', fmt: VarFormat): { variable: Variable; column: Cell[] } {
  let column = col;
  if (type === 'string' && v.type === 'numeric') {
    column = col.map((c) => (c === null ? '' : String(c)));
  } else if (type === 'numeric' && v.type === 'string') {
    column = col.map((c) => {
      if (c === null || c === '') return null;
      const n = Number(String(c).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    });
  }
  const width = type === 'string' ? fmt.w : 0;
  if (type === 'string') column = column.map((c) => (typeof c === 'string' ? c.slice(0, width) : c));
  const valueLabels = v.type === type ? v.valueLabels : [];
  const missing = v.type === type ? v.missing : { values: [] };
  const f = isDateFormat(fmt.type) ? { ...fmt, w: Math.max(fmt.w, DATE_FORMAT_WIDTH[fmt.type] ?? fmt.w) } : fmt;
  return {
    variable: {
      ...v,
      type,
      width,
      print: { ...f },
      write: { ...f },
      valueLabels,
      missing,
      align: type === 'string' && v.type !== 'string' ? 'left' : type === 'numeric' && v.type !== 'numeric' ? 'right' : v.align,
      measure: type === 'string' && v.measure === 'scale' ? 'nominal' : v.measure,
    },
    column,
  };
}

/** Quotes a string as a PSPP string literal. */
export function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Formats a value (number or string) as a PSPP literal for the given variable. */
export function literal(value: number | string, v?: Variable): string {
  if (v?.type === 'string' || typeof value === 'string') {
    if (v?.type === 'numeric' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return String(Number(value));
    return quote(String(value));
  }
  return String(value);
}
