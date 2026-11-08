/*
 * Shared helpers for reading and writing data files in the browser (CSV, XLSX, ODS, JSON):
 * date conversion between PSPP (seconds since 14 Oct 1582) and spreadsheets (days since
 * 30 Dec 1899), text decoding, and turning a grid of typed cells into a dataset.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Dataset, Variable } from '../../engine/types';
import { PSPP_EPOCH_MS } from '../format';
import { maxOf } from '../csv';
import { makeVariable, uniqueName } from '../variables';

/** Seconds from the PSPP epoch to the spreadsheet epoch (1899-12-30). */
const SHEET_EPOCH = (Date.UTC(1899, 11, 30) - PSPP_EPOCH_MS) / 1000;

export const psppToSerial = (s: number) => (s - SHEET_EPOCH) / 86400;
export const serialToPspp = (d: number) => Math.round((d * 86400 + SHEET_EPOCH) * 1000) / 1000;

export type DateKind = 'date' | 'datetime' | 'time' | null;

/** How a PSPP format stores its value: seconds since the epoch (date, datetime), a duration (time) or a plain number. */
export function dateKind(fmtType: string): DateKind {
  const t = fmtType.toUpperCase();
  if (['DATE', 'ADATE', 'EDATE', 'JDATE', 'SDATE', 'QYR', 'MOYR', 'WKYR'].includes(t)) return 'date';
  if (['DATETIME', 'YMDHMS'].includes(t)) return 'datetime';
  if (['TIME', 'DTIME', 'MTIME'].includes(t)) return 'time';
  return null;
}

/** ISO text of a PSPP date value ("2024-03-01" or "2024-03-01T10:30:00"). */
export function psppToIso(s: number, kind: 'date' | 'datetime'): string {
  const d = new Date(PSPP_EPOCH_MS + Math.round(s) * 1000);
  const iso = d.toISOString();
  return kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 19);
}

/** "PT10H30M05S" for a duration in seconds (ODS time values). */
export function secondsToDuration(s: number): string {
  const neg = s < 0;
  let x = Math.abs(Math.round(s));
  const h = Math.floor(x / 3600);
  x -= h * 3600;
  const m = Math.floor(x / 60);
  return `${neg ? '-' : ''}PT${h}H${String(m).padStart(2, '0')}M${String(x - m * 60).padStart(2, '0')}S`;
}

export type TextEncoding = 'auto' | 'utf-8' | 'windows-1250' | 'iso-8859-2' | 'windows-1252' | 'utf-16le';

/**
 * Decodes text: a byte-order mark wins; "auto" tries UTF-8 and falls back to Windows-1250 (the
 * usual encoding of Czech CSV files from Excel).
 */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding = 'auto'): { text: string; encoding: Exclude<TextEncoding, 'auto'> } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  if (encoding !== 'auto') return { text: new TextDecoder(encoding).decode(bytes), encoding };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'windows-1250' };
  }
}

/** A spreadsheet cell after reading: a number (dates already in PSPP seconds), text, or empty. */
export type SheetCell = { n: number; kind?: DateKind } | { s: string } | null;

const cellText = (c: SheetCell) => (c === null ? '' : 's' in c ? c.s : String(c.n));

/** Decimal places that show a number exactly (at most 6). */
function decimalsOf(x: number): number {
  for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) < 1e-6) return d;
  return 6;
}

/**
 * Builds a dataset from rows of typed cells (XLSX / ODS). A column of numbers becomes numeric
 * (dates keep a date format), anything with text becomes a string variable. The first row is used
 * for names when it is all text and the rows below are not.
 */
export function gridToDataset(grid: SheetCell[][], name: string, opts: { header?: boolean } = {}): Dataset {
  const rows = grid.filter((r) => r.some((c) => c !== null && cellText(c).trim() !== ''));
  const firstAllText = rows.length > 1 && rows[0].length > 0 && rows[0].every((c) => c !== null && 's' in c && c.s.trim() !== '');
  const header = opts.header ?? (firstAllText && new Set(rows[0].map(cellText)).size === rows[0].length);
  const head = header ? rows[0] : [];
  const body = header ? rows.slice(1) : rows;
  const ncol = maxOf(body, head.length, (r) => r.length);
  const variables: Variable[] = [];
  const columns: Cell[][] = [];
  const names: string[] = [];
  for (let c = 0; c < ncol; c++) {
    const vals = body.map((r) => r[c] ?? null);
    const filled = vals.filter((v): v is NonNullable<SheetCell> => v !== null && !('s' in v && v.s.trim() === ''));
    const raw = (head[c] && 's' in head[c]! ? (head[c] as { s: string }).s.trim() : '') || `VAR${String(c + 1).padStart(5, '0')}`;
    const vn = uniqueName(raw, names);
    names.push(vn);
    const label = vn !== raw ? raw : '';
    if (filled.length > 0 && filled.every((v) => 'n' in v)) {
      const nums = vals.map((v) => (v && 'n' in v ? v.n : null));
      const kinds = new Set(filled.map((v) => ('n' in v ? v.kind ?? null : null)));
      const kind = kinds.size === 1 ? [...kinds][0] : null;
      if (kind === 'date' || kind === 'datetime') {
        const dt = kind === 'datetime' || nums.some((x) => x !== null && Math.abs(x % 86400) > 0.5);
        const f = dt ? { type: 'DATETIME', w: 20, d: 0 } : { type: 'EDATE', w: 10, d: 0 };
        variables.push(makeVariable(vn, { label, type: 'numeric', print: f, write: f, measure: 'scale' }));
      } else if (kind === 'time') {
        const f = { type: 'TIME', w: 8, d: 0 };
        variables.push(makeVariable(vn, { label, type: 'numeric', print: f, write: f, measure: 'scale' }));
      } else {
        const d = maxOf(nums, 0, (x) => (x === null ? 0 : decimalsOf(x)));
        const maxInt = maxOf(nums, 1, (x) => (x === null ? 1 : String(Math.trunc(Math.abs(x))).length + (x < 0 ? 1 : 0)));
        const w = Math.min(40, Math.max(8, maxInt + (d ? d + 1 : 0)));
        const distinct = new Set(nums.filter((x) => x !== null)).size;
        variables.push(makeVariable(vn, { label, type: 'numeric', print: { type: 'F', w, d }, write: { type: 'F', w, d }, measure: d === 0 && distinct <= 10 ? 'nominal' : 'scale' }));
      }
      columns.push(nums);
    } else {
      const strs = vals.map((v) => (v === null ? '' : 's' in v ? v.s : formatPlain(v.n, v.kind)));
      const width = Math.min(32767, maxOf(strs, 1, (v) => new TextEncoder().encode(v).length));
      variables.push(
        makeVariable(vn, { label, type: 'string', width, print: { type: 'A', w: width, d: 0 }, write: { type: 'A', w: width, d: 0 }, measure: 'nominal', align: 'left', columns: Math.min(Math.max(width, 8), 32) }),
      );
      columns.push(strs);
    }
  }
  return { name, variables, columns, weight: null, filter: null, split: [], documents: [] };
}

function formatPlain(n: number, kind?: DateKind): string {
  if (kind === 'date' || kind === 'datetime') return psppToIso(n, kind).replace('T', ' ');
  return String(n);
}

/** Text shown for a cell when exporting labels instead of values. */
export function labelOf(v: Variable, c: Cell): string | undefined {
  if (c === null) return undefined;
  const key = typeof c === 'string' ? c.trimEnd() : c;
  return v.valueLabels.find((l) => (typeof l.value === 'string' ? l.value.trimEnd() : l.value) === key)?.label;
}

/** Validates a dataset read from JSON (our own export or the app's dataset shape). */
export function datasetFromJson(text: string, name: string): Dataset {
  const raw = JSON.parse(text) as Partial<Dataset> & { dataset?: Dataset };
  const ds = (raw.dataset ?? raw) as Partial<Dataset>;
  if (!Array.isArray(ds.variables) || !Array.isArray(ds.columns) || ds.variables.length !== ds.columns.length) throw new Error('Invalid dataset JSON');
  const variables = ds.variables.map((v) => makeVariable(v.name, v));
  return { name: ds.name || name, variables, columns: ds.columns, weight: ds.weight ?? null, filter: ds.filter ?? null, split: ds.split ?? [], documents: ds.documents ?? [], fileLabel: ds.fileLabel };
}

export function datasetToJson(ds: Dataset): string {
  return JSON.stringify({ format: 'pspp-studio-dataset', version: 1, dataset: ds }, null, 1);
}
