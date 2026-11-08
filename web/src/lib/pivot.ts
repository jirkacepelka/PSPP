/*
 * Reading PSPP's HTML output tables as a grid of cells.
 *
 * PSPP renders pivot tables as plain <table> markup: a <caption>, header rows made of <th>,
 * data rows with a <th> stub and <td> values, rowspan/colspan for nested dimensions and an
 * optional <tfoot> with footnotes. This module expands spans into a rectangular grid and parses
 * numbers in either decimal convention (".414", ",414", "-1,23", "1.2E-5", "<.001"), so the
 * interpretation and APA code can work from the table structure, independent of the output
 * language.
 *
 * Dependency-free (no DOM) so it runs in unit tests and in workers.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface PivotCell {
  /** visible text (footnote markers removed) */
  text: string;
  /** true for <th> cells */
  header: boolean;
  /** parsed number, or null */
  num: number | null;
  /** true when this grid position is a copy created by a rowspan/colspan */
  span?: boolean;
}

export interface PivotTable {
  caption: string;
  /** body rows (header rows included, as PSPP emits them in <tbody>) */
  rows: PivotCell[][];
  /** footnote lines from <tfoot> */
  footnotes: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', minus: '−' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text content of an HTML fragment, with <sup> footnote markers removed. */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a number as PSPP prints it: either decimal separator, optional leading zero,
 * exponent, a leading "<" (e.g. "<.001" is returned as 0.001), percent sign.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, '').replace(/−/g, '-');
  if (!s) return null;
  s = s.replace(/^[<>]=?/, '').replace(/%$/, '');
  if (!/^[-+]?(\d[\d.,]*|[.,]\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // grouping + decimal: the last separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = (s.match(/,/g)?.length ?? 0) > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function attr(tag: string, name: string): number {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(tag);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

/** Parses the first <table> in HTML into an expanded grid. */
export function parsePivot(html: string): PivotTable {
  const caption = htmlText(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(html)?.[1] ?? '');
  const footHtml = /<tfoot\b[^>]*>([\s\S]*?)<\/tfoot>/i.exec(html)?.[1] ?? '';
  const footnotes = [...footHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => htmlText(m[1])).filter(Boolean);
  const body = html.replace(/<tfoot\b[\s\S]*?<\/tfoot>/i, '').replace(/<caption\b[\s\S]*?<\/caption>/i, '');
  const rows: PivotCell[][] = [];
  // pending rowspans: column index → remaining rows and the cell to copy
  const pending: { left: number; cell: PivotCell }[] = [];
  let r = 0;
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: PivotCell[] = [];
    let c = 0;
    const fillPending = () => {
      while (pending[c] && pending[c].left > 0) {
        row[c] = { ...pending[c].cell, span: true };
        pending[c].left--;
        c++;
      }
    };
    for (const m of tr[1].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      fillPending();
      const text = htmlText(m[3]);
      const cell: PivotCell = { text, header: m[1].toLowerCase() === 'th', num: parseNumber(text) };
      const rs = attr(m[2], 'rowspan');
      const cs = attr(m[2], 'colspan');
      for (let k = 0; k < cs; k++) {
        row[c + k] = k ? { ...cell, span: true } : cell;
        if (rs > 1) pending[c + k] = { left: rs - 1, cell };
      }
      c += cs;
    }
    fillPending();
    rows.push(row);
    r++;
  }
  void r;
  const width = Math.max(0, ...rows.map((x) => x.length));
  for (const row of rows) for (let i = 0; i < width; i++) row[i] ??= { text: '', header: false, num: null };
  return { caption, rows, footnotes };
}

/** Rows that carry data (at least one <td> with a value). */
export function dataRows(t: PivotTable): PivotCell[][] {
  return t.rows.filter((row) => row.some((c) => !c.header && c.text !== ''));
}

/** Header cells of a data row (the stub), in order, de-duplicated when spanned. */
export function stub(row: PivotCell[]): string[] {
  return row.filter((c) => c.header).map((c) => c.text);
}

/** Numeric values of a data row (td cells only), keeping empty cells as null so columns line up. */
export function values(row: PivotCell[]): (number | null)[] {
  return row.filter((c) => !c.header).map((c) => c.num);
}

