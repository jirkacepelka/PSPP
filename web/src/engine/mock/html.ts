/*
 * Builds PSPP-HTML-driver-like tables for the mock engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type TCell = string | number | null | { v: string | number | null; th?: boolean; colspan?: number; rowspan?: number; cls?: string };

export interface TableSpec {
  title: string;
  head: TCell[][];
  body: TCell[][];
  footnotes?: string[];
  decimals?: number;
}

function cellHtml(c: TCell, tag: 'td' | 'th', decimals: number): string {
  let v: string | number | null;
  let attrs = '';
  if (c !== null && typeof c === 'object') {
    v = c.v;
    if (c.th) tag = 'th';
    if (c.colspan) attrs += ` colspan="${c.colspan}"`;
    if (c.rowspan) attrs += ` rowspan="${c.rowspan}"`;
    if (c.cls) attrs += ` class="${c.cls}"`;
  } else v = c;
  let text: string;
  if (v === null) text = '';
  else if (typeof v === 'number') {
    text = Number.isInteger(v) ? String(v) : v.toFixed(decimals);
    if (tag === 'td' && !attrs.includes('class')) attrs += ' class="num"';
  } else text = esc(v);
  return `<${tag}${attrs}>${text}</${tag}>`;
}

export function buildTable(spec: TableSpec): string {
  const d = spec.decimals ?? 2;
  const head = spec.head.map((r) => `<tr>${r.map((c) => cellHtml(c, 'th', d)).join('')}</tr>`).join('');
  const body = spec.body
    .map((r) => `<tr>${r.map((c, i) => cellHtml(c, i === 0 && (typeof c === 'string' || c === null) ? 'th' : 'td', d)).join('')}</tr>`)
    .join('');
  const ncols = Math.max(...spec.head.map((r) => r.reduce<number>((n, c) => n + (c && typeof c === 'object' && c.colspan ? c.colspan : 1), 0)), ...spec.body.map((r) => r.length));
  const foot = spec.footnotes?.length ? `<tfoot>${spec.footnotes.map((f) => `<tr><td colspan="${ncols}">${esc(f)}</td></tr>`).join('')}</tfoot>` : '';
  return `<table><caption>${esc(spec.title)}</caption><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>`;
}
