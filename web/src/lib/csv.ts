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

function guessColumn(values: string[], decimalComma: boolean): { variable: Partial<Variable>; column: Cell[] } {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  const numRe = decimalComma ? /^[-+]?\d+(,\d+)?([eE][-+]?\d+)?$/ : /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  if (nonEmpty.length > 0 && nonEmpty.every((v) => numRe.test(v.trim()))) {
    const nums = values.map((v) => (v.trim() === '' ? null : Number(v.trim().replace(',', '.'))));
    let d = 0;
    for (const v of nonEmpty) {
      const m = v.trim().match(/[.,](\d+)/);
      if (m) d = Math.max(d, m[1].length);
    }
    d = Math.min(d, 6);
    const maxInt = Math.max(1, ...nums.map((n) => (n === null ? 1 : String(Math.trunc(Math.abs(n))).length + (n < 0 ? 1 : 0))));
    const w = Math.min(40, Math.max(8, maxInt + (d ? d + 1 : 0)));
    return { variable: { type: 'numeric', print: { type: 'F', w, d }, write: { type: 'F', w, d }, measure: d === 0 && new Set(nums).size <= 10 ? 'nominal' : 'scale' }, column: nums };
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
  const width = Math.max(1, Math.min(32767, ...values.map((v) => new TextEncoder().encode(v).length)));
  return {
    variable: { type: 'string', width, print: { type: 'A', w: width, d: 0 }, write: { type: 'A', w: width, d: 0 }, measure: 'nominal', align: 'left', columns: Math.min(Math.max(width, 8), 32) },
    column: values,
  };
}

export function delimitedToDataset(text: string, name: string, opts: { header?: boolean; delimiter?: string } = {}): Dataset {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows = parseDelimited(text.replace(/^\ufeff/, ''), delimiter);
  const header = opts.header ?? (rows.length > 1 && rows[0].every((c) => c.trim() !== '' && !/^[-+]?[\d.,]+$/.test(c.trim())));
  const head = header ? rows[0] : [];
  const body = header ? rows.slice(1) : rows;
  const ncol = Math.max(head.length, ...body.map((r) => r.length), 0);
  const variables: Variable[] = [];
  const columns: Cell[][] = [];
  const names: string[] = [];
  for (let c = 0; c < ncol; c++) {
    const vals = body.map((r) => r[c] ?? '');
    const g = guessColumn(vals, delimiter === ';');
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

export function datasetToDelimited(ds: Dataset, delimiter = ',', useLabels = false): string {
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
          if (typeof c === 'number') return /DATE|TIME|YMDHMS|QYR|MOYR|WKYR/.test(v.print.type) ? csvField(formatNumber(c, v.print), delimiter) : String(c);
          return csvField(c.trimEnd(), delimiter);
        })
        .join(delimiter),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
