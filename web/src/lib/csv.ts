/*
 * CSV/TSV parsing and writing with simple type guessing.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Dataset, Variable } from '../engine/types';
import { formatNumber, parseDate } from './format';
import { makeVariable, uniqueName } from './variables';

export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const n = first.split(c).length;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const NUM_DOT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const NUM_COMMA = /^[-+]?(\d+(,\d*)?|,\d+)([eE][-+]?\d+)?$/;
const ISO_DT = /^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Whether numbers in these rows use a decimal comma (",5" "3,14" and no "3.14"). */
export function guessDecimalComma(rows: string[][], delimiter: string): boolean {
  if (delimiter === ',') return false;
  let comma = 0;
  let dot = 0;
  for (const r of rows.slice(0, 200))
    for (const c of r) {
      const v = c.trim();
      if (/^[-+]?\d*,\d+$/.test(v)) comma++;
      else if (/^[-+]?\d*\.\d+$/.test(v)) dot++;
    }
  return comma > dot || (comma === 0 && dot === 0 && delimiter === ';');
}

/** Largest f(item), at least `floor`; a loop, because spreading a million values into Math.max overflows the call stack. */
export function maxOf<T>(items: readonly T[], floor: number, f: (x: T) => number): number {
  let m = floor;
  for (const it of items) {
    const v = f(it);
    if (v > m) m = v;
  }
  return m;
}

const encoder = new TextEncoder();
const byteLength = (v: string) => (/^[\x00-\x7f]*$/.test(v) ? v.length : encoder.encode(v).length);

export function guessColumn(values: string[], decimalComma: boolean): { variable: Partial<Variable>; column: Cell[] } {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  const numRe = decimalComma ? NUM_COMMA : NUM_DOT;
  if (nonEmpty.length > 0 && nonEmpty.every((v) => numRe.test(v.trim()))) {
    const nums = values.map((v) => (v.trim() === '' ? null : Number(v.trim().replace(',', '.'))));
    let d = 0;
    for (const v of nonEmpty) {
      const m = v.trim().match(/[.,](\d+)/);
      if (m) d = Math.max(d, m[1].length);
    }
    d = Math.min(d, 6);
    const maxInt = maxOf(nums, 1, (n) => (n === null ? 1 : String(Math.trunc(Math.abs(n))).length + (n < 0 ? 1 : 0)));
    const w = Math.min(40, Math.max(8, maxInt + (d ? d + 1 : 0)));
    return { variable: { type: 'numeric', print: { type: 'F', w, d }, write: { type: 'F', w, d }, measure: d === 0 && new Set(nums).size <= 10 ? 'nominal' : 'scale' }, column: nums };
  }
  if (nonEmpty.length > 0 && nonEmpty.every((v) => ISO_DT.test(v.trim()) && parseDate(v, 'YMDHMS') !== null)) {
    const f = { type: 'YMDHMS', w: 19, d: 0 };
    return { variable: { type: 'numeric', print: f, write: f, measure: 'scale' }, column: values.map((v) => (v.trim() === '' ? null : parseDate(v, 'YMDHMS'))) };
  }
  for (const fmt of ['SDATE', 'EDATE', 'ADATE', 'DATE'] as const) {
    if (nonEmpty.length > 0 && nonEmpty.every((v) => parseDate(v, fmt) !== null && (fmt !== 'SDATE' || /^\d{4}/.test(v.trim())) && (fmt !== 'EDATE' || v.includes('.')) && (fmt !== 'ADATE' || v.includes('/')))) {
      const isDT = fmt === 'SDATE' && nonEmpty.some((v) => /\d:\d/.test(v));
      const f = isDT ? { type: 'YMDHMS', w: 19, d: 0 } : { type: fmt === 'SDATE' ? 'SDATE' : fmt, w: fmt === 'DATE' ? 11 : 10, d: 0 };
      return {
        variable: { type: 'numeric', print: f, write: f, measure: 'scale' },
        column: values.map((v) => (v.trim() === '' ? null : parseDate(v, isDT ? 'YMDHMS' : fmt))),
      };
    }
  }
  const width = Math.min(32767, maxOf(values, 1, byteLength));
  return {
    variable: { type: 'string', width, print: { type: 'A', w: width, d: 0 }, write: { type: 'A', w: width, d: 0 }, measure: 'nominal', align: 'left', columns: Math.min(Math.max(width, 8), 32) },
    column: values,
  };
}

export interface DelimitedOptions {
  header?: boolean;
  delimiter?: string;
  /** decimal separator of numbers; guessed from the data when omitted */
  decimalComma?: boolean;
}

export function delimitedToDataset(text: string, name: string, opts: DelimitedOptions = {}): Dataset {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows = parseDelimited(text.replace(/^\ufeff/, ''), delimiter);
  const decimalComma = opts.decimalComma ?? guessDecimalComma(rows, delimiter);
  const header = opts.header ?? (rows.length > 1 && rows[0].every((c) => c.trim() !== '' && !/^[-+]?[\d.,]+$/.test(c.trim())));
  const head = header ? rows[0] : [];
  const body = header ? rows.slice(1) : rows;
  const ncol = maxOf(body, head.length, (r) => r.length);
  const variables: Variable[] = [];
  const columns: Cell[][] = [];
  const names: string[] = [];
  for (let c = 0; c < ncol; c++) {
    const vals = body.map((r) => r[c] ?? '');
    const g = guessColumn(vals, decimalComma);
    const raw = head[c]?.trim() || `VAR${String(c + 1).padStart(5, '0')}`;
    const vn = uniqueName(raw, names);
    names.push(vn);
    variables.push(makeVariable(vn, { ...g.variable, label: vn !== raw ? raw : '' }));
    columns.push(g.column);
  }
  return { name, variables, columns, weight: null, filter: null, split: [], documents: [] };
}

function csvField(s: string, delimiter: string): string {
  return /[",\n\r;\t]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function datasetToDelimited(ds: Dataset, delimiter = ',', useLabels = false, decimalComma = false): string {
  const n = Math.max(0, ...ds.columns.map((c) => c.length));
  const lines = [ds.variables.map((v) => csvField(v.name, delimiter)).join(delimiter)];
  for (let r = 0; r < n; r++) {
    lines.push(
      ds.variables
        .map((v, i) => {
          const c = ds.columns[i][r] ?? null;
          if (c === null) return '';
          if (useLabels) {
            const l = v.valueLabels.find((x) => x.value === c);
            if (l) return csvField(l.label, delimiter);
          }
          if (typeof c === 'number') {
            if (/DATE|TIME|YMDHMS|QYR|MOYR|WKYR/.test(v.print.type)) return csvField(formatNumber(c, v.print), delimiter);
            // round away binary noise (0.1 + 0.2) but keep every meaningful digit
            const txt = String(Number(c.toPrecision(15)));
            return decimalComma ? txt.replace('.', ',') : txt;
          }
          return csvField(c.trimEnd(), delimiter);
        })
        .join(delimiter),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
