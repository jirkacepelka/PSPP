/*
 * APA 7 copy of a PSPP output table (F7 / OUT-5).
 *
 * Rebuilds the table from its grid: no vertical rules, horizontal rules only above and below the
 * header and at the bottom, the number and the title in italics above, a "Note." line from the
 * footnotes, 2 decimals (3 for p), "< .001", no leading zero for bounded statistics (English),
 * decimal comma for Czech. Returns HTML (inline styles, so Word and Google Docs keep it) and
 * plain text (tab-separated).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { parsePivot, type PivotCell } from './pivot';
import { fmt, APA_CS, APA_EN, type NumStyle } from './statfmt';

export interface ApaOptions {
  locale: 'cs' | 'en';
  /** table number ("Table 1") */
  number?: number;
  /** override the caption */
  title?: string;
}

const SIG = /(^|[\s(])sig\b|^p$|^p[\s-]value|signifikance|významnost/i;
const BOUNDED = /\b(sig|correlation|korelace|beta|alpha|alfa|r square|r kvadrát|phi|cramer|kappa|eta)\b|^r$/i;
const INTEGERS = /^(n|df\d?|count|frequency|četnost|počet|n of items|počet položek)$/i;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatCell(c: PivotCell, header: string, stubText: string[], style: NumStyle): string {
  if (c.header || c.num === null) return c.text;
  const raw = c.text.trim();
  const pct = raw.endsWith('%');
  const x = c.num;
  const isSig = SIG.test(header) || stubText.some((x) => SIG.test(x));
  if (isSig && x >= 0) return x < 0.001 ? `< ${fmt(0.001, 3, style, true)}` : fmt(x, 3, style, true);
  if (pct) return `${fmt(x, 1, style)}${style.dec === ',' ? ' %' : '%'}`;
  const bounded = BOUNDED.test(header) || stubText.some((x) => BOUNDED.test(x));
  const intLike = Number.isInteger(x) && (!/[.,]/.test(raw) || INTEGERS.test(header.trim()));
  if (intLike) return fmt(x, 0, style);
  return fmt(x, 2, style, bounded && Math.abs(x) <= 1);
}

/** Builds the APA version of PSPP table HTML. */
export function toApa(html: string, opts: ApaOptions): { html: string; text: string } {
  const style = opts.locale === 'cs' ? APA_CS : APA_EN;
  const t = parsePivot(html);
  const headerRows = t.rows.filter((r) => r.length && r.every((c) => c.header));
  const body = t.rows.filter((r) => !(r.length && r.every((c) => c.header)));
  const width = Math.max(0, ...t.rows.map((r) => r.length));
  const colHeader = (i: number) => headerRows.map((r) => r[i]?.text ?? '').filter(Boolean).join(' ');
  const word = opts.locale === 'cs' ? 'Tabulka' : 'Table';
  const title = opts.title ?? t.caption;
  const font = "font-family:'Times New Roman',Times,serif;font-size:12pt;";
  const cellCss = 'padding:2pt 8pt;border:none;vertical-align:top;';
  const rule = (w: number) => `border-top:${w}pt solid #000;`;

  // header rows: merge identical horizontal neighbours back into colspans; repeated rows collapse
  const uniqHeader = headerRows.filter((r, i) => i === 0 || r.some((c, k) => c.text !== headerRows[i - 1][k]?.text));
  const headHtml = uniqHeader
    .map((r, ri) => {
      const cells: string[] = [];
      for (let i = 0; i < width; ) {
        let span = 1;
        // a header cell that is the same in the next header row is shown in the last row only
        const text = ri < uniqHeader.length - 1 && uniqHeader[ri + 1][i]?.text === r[i]?.text ? '' : r[i]?.text ?? '';
        while (i + span < width && r[i + span]?.text === r[i]?.text && text) span++;
        const isLast = ri === uniqHeader.length - 1;
        const css = `${cellCss}text-align:${i === 0 ? 'left' : 'center'};font-weight:normal;${ri === 0 ? rule(1) : ''}${isLast ? 'border-bottom:1pt solid #000;' : text && span > 1 ? 'border-bottom:0.5pt solid #000;' : ''}`;
        cells.push(`<th${span > 1 ? ` colspan="${span}"` : ''} style="${css}">${esc(text)}</th>`);
        i += span;
      }
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  const textLines: string[] = [`${word} ${opts.number ?? 1}`, title];
  if (uniqHeader.length) textLines.push(uniqHeader[uniqHeader.length - 1].map((c) => c.text).join('\t'));

  const bodyHtml = body
    .map((r, ri) => {
      const stubText = r.filter((c) => c.header).map((c) => c.text.trim());
      const prev = ri > 0 ? body[ri - 1] : null;
      const last = ri === body.length - 1;
      const texts: string[] = [];
      const cells = r.map((c, i) => {
        // repeated stub labels (rowspans) are shown once
        const repeated = c.header && prev?.[i]?.header && prev[i].text === c.text && (i === 0 || prev[i - 1]?.text === r[i - 1]?.text);
        const text = repeated ? '' : formatCell(c, colHeader(i), stubText, style);
        texts.push(text);
        const css = `${cellCss}text-align:${c.header ? 'left' : 'right'};font-weight:normal;${!headerRows.length && ri === 0 ? rule(1) : ''}${last ? 'border-bottom:1pt solid #000;' : ''}${!c.header ? 'white-space:nowrap;' : ''}`;
        return `<${c.header ? 'th' : 'td'} style="${css}">${esc(text)}</${c.header ? 'th' : 'td'}>`;
      });
      textLines.push(texts.join('\t'));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  const note = t.footnotes.length ? `<p style="${font}margin:4pt 0 0"><i>${opts.locale === 'cs' ? 'Poznámka' : 'Note'}.</i> ${esc(t.footnotes.join(' '))}</p>` : '';
  if (t.footnotes.length) textLines.push(`${opts.locale === 'cs' ? 'Poznámka' : 'Note'}. ${t.footnotes.join(' ')}`);

  const out =
    `<div style="${font}">` +
    `<p style="${font}margin:0;font-weight:bold">${word} ${opts.number ?? 1}</p>` +
    `<p style="${font}margin:0 0 6pt;font-style:italic">${esc(title)}</p>` +
    `<table style="${font}border-collapse:collapse;border:none">${headHtml ? `<thead>${headHtml}</thead>` : ''}<tbody>${bodyHtml}</tbody></table>` +
    note +
    `</div>`;
  return { html: out, text: textLines.join('\n') };
}
