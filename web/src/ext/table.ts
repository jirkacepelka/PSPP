/*
 * Output for extension analyses in the exact shape PSPP's HTML driver produces (caption, <th>
 * header rows, <th> stub + <td> values, rowspan/colspan, <tfoot> footnotes), so lib/pivot.ts,
 * APA copy and the interpretation cards treat them like engine tables.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem } from '../engine/types';
import type { ExtContext } from './types';

export interface Cell {
  text: string;
  /** header/stub cell (<th>) */
  th?: boolean;
  colspan?: number;
  rowspan?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HEAD = "style='text-align: center; vertical-align: bottom'";
const CORNER = "style='text-align: center; vertical-align: middle; font-weight: bold'";
const NUM = "style='text-align: right'";

const span = (c: Cell) => `${c.colspan && c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`;

/** Shorthands for building rows. */
export const th = (text: string, o: Partial<Cell> = {}): Cell => ({ text, th: true, ...o });
export const td = (text: string, o: Partial<Cell> = {}): Cell => ({ text, ...o });

export interface TableSpec {
  caption: string;
  /** header rows; give the top-left corner cells as th('') */
  head: Cell[][];
  /** body rows: stub <th> cells first, then <td> values */
  body: Cell[][];
  footnotes?: string[];
}

export function tableHtml(t: TableSpec): string {
  const out: string[] = ['<table>', `<caption ${CORNER}>${esc(t.caption)}</caption>`, '<tbody>'];
  for (const row of t.head) {
    out.push('<tr>');
    for (const c of row) out.push(`<th ${c.text ? HEAD : CORNER}${span(c)}>${esc(c.text)}</th>`);
    out.push('</tr>');
  }
  for (const row of t.body) {
    out.push('<tr>');
    for (const c of row) {
      if (c.th) out.push(`<th${span(c)}>${esc(c.text)}</th>`);
      else out.push(c.text === '' ? `<td${span(c)}></td>` : `<td ${NUM}${span(c)}>${esc(c.text)}</td>`);
    }
    out.push('</tr>');
  }
  out.push('</tbody>');
  if (t.footnotes?.length) {
    out.push('<tfoot>');
    t.footnotes.forEach((f, i) => out.push(`<tr><td colspan="99"><sup>${String.fromCharCode(97 + i)}</sup> ${esc(f)}</td></tr>`));
    out.push('</tfoot>');
  }
  out.push('</table>');
  return out.join('\n');
}

let seq = 0;
const id = () => `x${Date.now().toString(36)}${(seq++).toString(36)}`;

export function tableItem(t: TableSpec, command: string): OutputItem {
  return { id: id(), kind: 'table', title: t.caption, html: tableHtml(t), command };
}
export function groupItem(title: string, command: string, children: OutputItem[]): OutputItem {
  return { id: id(), kind: 'group', title, command, children };
}
export function textItem(text: string, subtype: 'title' | 'subtitle' | 'log' = 'subtitle'): OutputItem {
  return { id: id(), kind: 'text', subtype, text };
}
export function messageItem(severity: 'error' | 'warning' | 'note', text: string, line?: number): OutputItem {
  return { id: id(), kind: 'message', severity, text, line };
}
export function chartItem(title: string, chart: unknown): OutputItem {
  return { id: id(), kind: 'chart', title, chart };
}

/**
 * Formats a number like PSPP output: fixed decimals, no leading zero for |x| < 1 (".264",
 * "-.158"), the decimal separator from SET DECIMAL. null/NaN → ''.
 */
export function fmt(x: number | null | undefined, decimals: number, ctx: Pick<ExtContext, 'decimal'>): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  let s = Math.abs(x).toFixed(decimals);
  if (s.startsWith('0.')) s = s.slice(1);
  const neg = x < 0 && Number(s.replace(',', '.')) !== 0;
  if (ctx.decimal === ',') s = s.replace('.', ',');
  return (neg ? '-' : '') + s;
}
/** Counts and integers (weighted counts keep decimals when fractional). */
export function fmtN(x: number, ctx: Pick<ExtContext, 'decimal'>): string {
  return Number.isInteger(x) ? String(x) : fmt(x, 2, ctx);
}
/** Significance with 3 decimals (".000" like PSPP/SPSS). */
export const fmtP = (p: number | null | undefined, ctx: Pick<ExtContext, 'decimal'>) => fmt(p, 3, ctx);
