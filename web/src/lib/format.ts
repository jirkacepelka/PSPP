/*
 * Formatting and parsing of PSPP values according to their print formats.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, VarFormat, Variable } from '../engine/types';

/** Milliseconds of the PSPP epoch (14 Oct 1582, Gregorian) in JS time. */
export const PSPP_EPOCH_MS = Date.UTC(1582, 9, 14);

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export const DATE_FORMATS = [
  'DATE', 'ADATE', 'EDATE', 'SDATE', 'JDATE', 'QYR', 'MOYR', 'WKYR', 'DATETIME', 'YMDHMS', 'TIME', 'DTIME', 'MTIME', 'WKDAY', 'MONTH',
] as const;

/** Default widths for date/time formats (PSPP minimum sensible widths). */
export const DATE_FORMAT_WIDTH: Record<string, number> = {
  DATE: 11, ADATE: 10, EDATE: 10, SDATE: 10, JDATE: 7, QYR: 8, MOYR: 8, WKYR: 10, DATETIME: 20, YMDHMS: 19,
  TIME: 8, DTIME: 11, MTIME: 5, WKDAY: 9, MONTH: 9,
};

/** Example rendering of each date format, used in the type dialog. */
export const DATE_FORMAT_EXAMPLE: Record<string, string> = {
  DATE: 'dd-mmm-yyyy', ADATE: 'mm/dd/yyyy', EDATE: 'dd.mm.yyyy', SDATE: 'yyyy/mm/dd', JDATE: 'yyyyddd', QYR: 'q Q yyyy',
  MOYR: 'mmm yyyy', WKYR: 'ww WK yyyy', DATETIME: 'dd-mmm-yyyy hh:mm:ss', YMDHMS: 'yyyy-mm-dd hh:mm:ss',
  TIME: 'hh:mm:ss', DTIME: 'dd hh:mm:ss', MTIME: 'mm:ss', WKDAY: 'weekday', MONTH: 'month',
};

export function isDateFormat(type: string): boolean {
  return (DATE_FORMATS as readonly string[]).includes(type.toUpperCase());
}

export interface FormatOptions {
  decimalSeparator?: '.' | ',';
}

const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function fixed(value: number, d: number, decSep: string, groupSep: string | null): string {
  const neg = value < 0;
  const s = Math.abs(value).toFixed(Math.max(0, Math.min(16, d)));
  let [i, f] = s.split('.');
  if (groupSep) i = group(i, groupSep);
  const out = f !== undefined ? `${i}${decSep}${f}` : i;
  return neg && Number(s) !== 0 ? `-${out}` : out;
}

function formatDate(value: number, fmt: VarFormat): string {
  const t = fmt.type.toUpperCase();
  if (t === 'TIME' || t === 'DTIME' || t === 'MTIME') {
    const neg = value < 0;
    let s = Math.abs(value);
    const days = Math.floor(s / 86400);
    if (t === 'DTIME') s -= days * 86400;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s - h * 3600) / 60);
    const sec = s - h * 3600 - m * 60;
    const secStr = fmt.d > 0 ? sec.toFixed(fmt.d).padStart(3 + fmt.d, '0') : pad(Math.floor(sec));
    const sign = neg ? '-' : '';
    if (t === 'MTIME') return `${sign}${pad(h * 60 + m)}:${secStr}`;
    if (t === 'DTIME') return `${sign}${pad(days)} ${pad(h)}:${pad(m)}:${secStr}`;
    return `${sign}${pad(h)}:${pad(m)}:${secStr}`;
  }
  if (t === 'WKDAY') return WEEKDAYS[(Math.round(value) - 1 + 7) % 7] ?? '';
  if (t === 'MONTH') return ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'][Math.round(value) - 1] ?? '';
  const date = new Date(PSPP_EPOCH_MS + value * 1000);
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth();
  const d = date.getUTCDate();
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  switch (t) {
    case 'DATE': return `${pad(d)}-${MONTHS[mo]}-${y}`;
    case 'ADATE': return `${pad(mo + 1)}/${pad(d)}/${y}`;
    case 'EDATE': return `${pad(d)}.${pad(mo + 1)}.${y}`;
    case 'SDATE': return `${y}/${pad(mo + 1)}/${pad(d)}`;
    case 'JDATE': {
      const doy = Math.floor((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
      return `${y}${pad(doy, 3)}`;
    }
    case 'QYR': return `${Math.floor(mo / 3) + 1} Q ${y}`;
    case 'MOYR': return `${MONTHS[mo]} ${y}`;
    case 'WKYR': {
      const doy = Math.floor((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 86400000);
      return `${pad(Math.floor(doy / 7) + 1)} WK ${y}`;
    }
    case 'DATETIME': return `${pad(d)}-${MONTHS[mo]}-${y} ${time}`;
    case 'YMDHMS': return `${y}-${pad(mo + 1)}-${pad(d)} ${time}`;
    default: return `${pad(d)}-${MONTHS[mo]}-${y}`;
  }
}

/** Formats a numeric value according to a PSPP format. */
export function formatNumber(value: number, fmt: VarFormat, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return '';
  const dec = opts.decimalSeparator ?? '.';
  const t = fmt.type.toUpperCase();
  if (isDateFormat(t)) return formatDate(value, fmt);
  switch (t) {
    case 'COMMA': return fixed(value, fmt.d, '.', ',');
    case 'DOT': return fixed(value, fmt.d, ',', '.');
    case 'DOLLAR': {
      const s = fixed(Math.abs(value), fmt.d, '.', ',');
      return value < 0 ? `-$${s}` : `$${s}`;
    }
    case 'PCT': return `${fixed(value, fmt.d, dec, null)}%`;
    case 'E': return value.toExponential(Math.max(0, Math.min(16, fmt.d))).replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
    case 'N': return String(Math.round(Math.abs(value))).padStart(fmt.w, '0');
    case 'CCA': case 'CCB': case 'CCC': case 'CCD': case 'CCE': return fixed(value, fmt.d, dec, dec === ',' ? ' ' : ',');
    default: return fixed(value, fmt.d, dec, null);
  }
}

export function isMissingValue(cell: Cell, v: Variable): boolean {
  if (cell === null) return true;
  if (v.missing.values.some((m) => m === cell || (typeof m === 'string' && typeof cell === 'string' && m.trimEnd() === cell.trimEnd()))) return true;
  if (v.missing.range && typeof cell === 'number') return cell >= v.missing.range.low && cell <= v.missing.range.high;
  return false;
}

const labelIndexCache = new WeakMap<Variable['valueLabels'], Map<number | string, string>>();

/**
 * O(1) lookup table value → label for V (cached per valueLabels array, so it is rebuilt only
 * when the labels change). String keys are right-trimmed, as PSPP pads string values.
 */
export function labelIndex(v: Variable): Map<number | string, string> {
  let m = labelIndexCache.get(v.valueLabels);
  if (!m) {
    m = new Map();
    for (const l of v.valueLabels) m.set(typeof l.value === 'string' ? l.value.trimEnd() : l.value, l.label);
    labelIndexCache.set(v.valueLabels, m);
  }
  return m;
}

export function valueLabelFor(cell: Cell, v: Variable): string | undefined {
  if (cell === null || !v.valueLabels.length) return undefined;
  const m = labelIndex(v);
  if (typeof cell === 'string') {
    const k = cell.trimEnd();
    return m.get(k) ?? (v.type === 'numeric' && k !== '' && Number.isFinite(Number(k)) ? m.get(Number(k)) : undefined);
  }
  return m.get(cell);
}

/** Code text for a value-label value, as shown in chips and pickers (dates formatted). */
export function labelValueText(value: number | string, v: Variable, opts: FormatOptions = {}): string {
  if (typeof value === 'string') return value.trimEnd();
  if (isDateFormat(v.print.type)) return formatNumber(value, v.print);
  const s = String(value);
  return opts.decimalSeparator === ',' ? s.replace('.', ',') : s;
}

/** Number formatted for statistics display (fixed decimals, locale separator, no grouping). */
export function formatStat(value: number | null | undefined, d = 2, opts: FormatOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const s = (Math.abs(value) < 1e-12 ? 0 : value).toFixed(d);
  return opts.decimalSeparator === ',' ? s.replace('.', ',') : s;
}

/** Formats a cell for display. */
export function formatCell(cell: Cell, v: Variable, opts: FormatOptions & { valueLabels?: boolean } = {}): string {
  if (cell === null || cell === undefined) return v.type === 'numeric' ? '' : '';
  if (opts.valueLabels) {
    const l = valueLabelFor(cell, v);
    if (l !== undefined) return l;
  }
  if (typeof cell === 'string') return cell;
  return formatNumber(cell, v.print, opts);
}

/** Raw editable text representation (no grouping, full precision for F). */
export function editText(cell: Cell, v: Variable, opts: FormatOptions = {}): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (isDateFormat(v.print.type)) return formatDate(cell, v.print);
  const s = String(cell);
  return opts.decimalSeparator === ',' ? s.replace('.', ',') : s;
}

function monthIndex(s: string): number {
  const m = s.slice(0, 3).toUpperCase();
  const i = MONTHS.indexOf(m);
  if (i >= 0) return i;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n - 1 : -1;
}

function dateToPspp(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  return (Date.UTC(y, mo, d, h, mi, 0) - PSPP_EPOCH_MS) / 1000 + s;
}

function parseTime(s: string): number | null {
  const m = s.trim().match(/^(-)?(?:(\d+)\s+)?(\d+):(\d{1,2})(?::(\d{1,2}(?:[.,]\d+)?))?$/);
  if (!m) return null;
  const v = Number(m[2] ?? 0) * 86400 + Number(m[3]) * 3600 + Number(m[4]) * 60 + Number((m[5] ?? '0').replace(',', '.'));
  return m[1] ? -v : v;
}

/** Parses a date/time string in the given format; returns seconds since PSPP epoch or null if invalid. */
export function parseDate(text: string, type: string): number | null {
  const s = text.trim();
  const t = type.toUpperCase();
  if (t === 'TIME' || t === 'DTIME') return parseTime(s);
  if (t === 'MTIME') {
    const m = s.match(/^(-)?(\d+):(\d{1,2}(?:\.\d+)?)$/);
    return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  }
  if (t === 'WKDAY') {
    const i = WEEKDAYS.findIndex((w) => w.startsWith(s.toUpperCase().slice(0, 2)));
    return i >= 0 ? i + 1 : null;
  }
  if (t === 'MONTH') {
    const i = monthIndex(s);
    return i >= 0 ? i + 1 : null;
  }
  let m: RegExpMatchArray | null;
  const timePart = (rest?: string) => {
    if (!rest) return 0;
    const tt = parseTime(rest);
    return tt ?? NaN;
  };
  switch (t) {
    case 'ADATE':
      m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/);
      return m ? dateToPspp(+m[3], +m[1] - 1, +m[2]) : null;
    case 'EDATE':
      m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/);
      return m ? dateToPspp(+m[3], +m[2] - 1, +m[1]) : null;
    case 'SDATE':
      m = s.match(/^(\d{4})[/.\- ](\d{1,2})[/.\- ](\d{1,2})$/);
      return m ? dateToPspp(+m[1], +m[2] - 1, +m[3]) : null;
    case 'JDATE':
      m = s.match(/^(\d{4})(\d{3})$/);
      return m ? dateToPspp(+m[1], 0, +m[2]) : null;
    case 'MOYR':
      m = s.match(/^([A-Za-z]{3,}|\d{1,2})[\s/.\-]+(\d{2,4})$/);
      return m && monthIndex(m[1]) >= 0 ? dateToPspp(+m[2], monthIndex(m[1]), 1) : null;
    case 'QYR':
      m = s.match(/^([1-4])\s*Q\s*(\d{2,4})$/i);
      return m ? dateToPspp(+m[2], (+m[1] - 1) * 3, 1) : null;
    case 'WKYR':
      m = s.match(/^(\d{1,2})\s*WK\s*(\d{2,4})$/i);
      return m ? dateToPspp(+m[2], 0, 1 + (+m[1] - 1) * 7) : null;
    case 'YMDHMS': {
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/);
      if (!m) return null;
      const tp = timePart(m[4]);
      return Number.isNaN(tp) ? null : dateToPspp(+m[1], +m[2] - 1, +m[3]) + tp;
    }
    case 'DATE':
    case 'DATETIME':
    default: {
      m = s.match(/^(\d{1,2})[\s/.\-]+([A-Za-z]{3,}|\d{1,2})[\s/.\-]+(\d{2,4})(?:\s+(.+))?$/);
      if (m && monthIndex(m[2]) >= 0) {
        const tp = timePart(m[4]);
        return Number.isNaN(tp) ? null : dateToPspp(+m[3], monthIndex(m[2]), +m[1]) + tp;
      }
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/);
      if (m) {
        const tp = timePart(m[4]);
        return Number.isNaN(tp) ? null : dateToPspp(+m[1], +m[2] - 1, +m[3]) + tp;
      }
      return null;
    }
  }
}

/** Parses a number typed by a user, tolerant of grouping, currency and decimal comma. */
export function parseNumber(text: string, opts: FormatOptions = {}): number | null {
  let s = text.trim().replace(/ /g, ' ');
  if (s === '' || s === '.') return null;
  s = s.replace(/^\$/, '').replace(/%$/, '').replace(/ /g, '');
  const dec = opts.decimalSeparator ?? '.';
  if (dec === ',') {
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  } else {
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type ParseResult = { ok: true; value: Cell } | { ok: false };

/** Parses user input for a variable. Also accepts a value label text. */
export function parseCell(text: string, v: Variable, opts: FormatOptions = {}): ParseResult {
  if (v.type === 'string') {
    if (v.valueLabels.length && !labelIndex(v).has(text.trimEnd())) {
      const byLabel = v.valueLabels.find((l) => l.label.toLowerCase() === text.trim().toLowerCase());
      if (byLabel) text = String(byLabel.value);
    }
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= v.width || v.width === 0) return { ok: true, value: text };
    // truncate to width bytes on a character boundary
    let out = '';
    let n = 0;
    for (const ch of text) {
      const l = new TextEncoder().encode(ch).length;
      if (n + l > v.width) break;
      out += ch;
      n += l;
    }
    return { ok: true, value: out };
  }
  if (text.trim() === '') return { ok: true, value: null };
  const byLabel = v.valueLabels.find((l) => l.label.toLowerCase() === text.trim().toLowerCase());
  if (byLabel && typeof byLabel.value === 'number') return { ok: true, value: byLabel.value };
  if (isDateFormat(v.print.type)) {
    const d = parseDate(text, v.print.type);
    if (d !== null) return { ok: true, value: d };
  }
  const n = parseNumber(text, opts);
  return n === null ? { ok: false } : { ok: true, value: n };
}

export function formatSpec(f: VarFormat): string {
  if (f.type === 'A' || f.type === 'AHEX') return `${f.type}${f.w}`;
  if (isDateFormat(f.type) && f.d === 0) return `${f.type}${f.w}`;
  return `${f.type}${f.w}.${f.d}`;
}
