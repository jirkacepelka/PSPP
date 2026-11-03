/*
 * Formatting statistics for sentences, APA tables and the output display.
 *
 * Conventions:
 *  - "bounded" statistics (|x| ≤ 1: p, r, β, α, R², V, η²) lose the leading zero in APA style;
 *  - unbounded ones (M, SD, t, F, d) always keep it unless the user wants SPSS style ("never");
 *  - p is shown with 3 decimals and as "< .001" below that.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type LeadingZero = 'always' | 'apa' | 'never';

export interface NumStyle {
  /** decimal separator */
  dec: '.' | ',';
  leadingZero: LeadingZero;
}

export const APA_EN: NumStyle = { dec: '.', leadingZero: 'apa' };
export const APA_CS: NumStyle = { dec: ',', leadingZero: 'always' };

/** Formats X with D decimals. BOUNDED drops the leading zero in APA / SPSS styles. */
export function fmt(x: number | null | undefined, d: number, style: NumStyle, bounded = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  let s = Math.abs(x).toFixed(d);
  if (Number(s) === 0) x = 0; // no "-0.00"
  const drop = style.leadingZero === 'never' || (bounded && style.leadingZero === 'apa');
  if (drop && s.startsWith('0.')) s = s.slice(1);
  if (style.dec === ',') s = s.replace('.', ',');
  return `${x < 0 ? '−' : ''}${s}`;
}

/** "p = .032", "p < .001" (with the relation sign), per style. THRESHOLD → "p < .05" / "p > .05"-style. */
export function fmtP(p: number | null | undefined, style: NumStyle, threshold = false): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'p = –';
  if (threshold) {
    for (const a of [0.001, 0.01, 0.05]) if (p < a) return `p < ${fmt(a, a === 0.001 ? 3 : 2, style, true)}`;
    return `p ≥ ${fmt(0.05, 2, style, true)}`;
  }
  if (p < 0.001) return `p < ${fmt(0.001, 3, style, true)}`;
  return `p = ${fmt(p, 3, style, true)}`;
}

/** Number of decimals typical for a value of this magnitude (2 by default, integers stay integers). */
export function autoDecimals(x: number): number {
  if (Number.isInteger(x)) return 0;
  const a = Math.abs(x);
  if (a >= 100) return 1;
  if (a < 0.1) return 3;
  return 2;
}

/** Separator between statistics in a sentence: Czech uses ";" because "," is the decimal mark. */
export const statSep = (style: NumStyle) => (style.dec === ',' ? '; ' : ', ');

/* -------------------------------------------------------------------------------------------- */
/* Display post-processing of engine table HTML (OUT-7).                                         */

const SIG_HEADER = /\b(sig|signifikance|významnost|p-?value)\b/i;
const BOUNDED_HEADER = /\b(sig|correlation|korelace|beta|alpha|alfa|r square|r kvadrát|phi|cramer|kappa|eta|percentile?|lambda|gamma|tau)\b|^r$/i;

/**
 * Post-processes PSPP table HTML for display:
 *  - p values printed as ".000" become "<.001" (APA never reports p = .000);
 *  - leading zeros are added to unbounded statistics ("always" / "apa") or to every number ("always").
 * Column roles are recognised from header text in English and Czech; unrecognised columns are
 * treated as unbounded. Only numeric cells are touched.
 */
export function formatTableHtml(html: string, leadingZero: LeadingZero): string {
  if (!/<td/i.test(html)) return html;
  const headers: string[] = [];
  const pending: number[] = []; // column → rows still covered by a rowspan from above
  return html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (tr) => {
    const cells = [...tr.matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
    const isHeaderRow = cells.length > 0 && cells.every((c) => c[1].toLowerCase() === 'th');
    const stubText = cells.filter((c) => c[1].toLowerCase() === 'th').map((c) => c[3].replace(/<[^>]+>/g, '')).join(' ');
    // Row header text says "Sig." in transposed tables (Kruskal-Wallis, Wilcoxon, crosstab tests).
    const stubSig = !isHeaderRow && SIG_HEADER.test(stubText);
    const stubBounded = !isHeaderRow && (stubSig || BOUNDED_HEADER.test(stubText.trim()));
    let col = 0;
    const skip = () => {
      while ((pending[col] ?? 0) > 0) {
        pending[col]--;
        col++;
      }
    };
    const result = tr.replace(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi, (m, tag: string, attrs: string, inner: string) => {
      skip();
      const cs = Number(/colspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1);
      const rs = Number(/rowspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1);
      const myCol = col;
      for (let k = 0; k < cs; k++) if (rs > 1) pending[col + k] = rs - 1;
      col += cs;
      if (isHeaderRow) {
        const text = inner.replace(/<[^>]+>/g, '').trim();
        for (let k = 0; k < cs; k++) if (text) headers[myCol + k] = headers[myCol + k] ? `${headers[myCol + k]} ${text}` : text;
        return m;
      }
      if (tag.toLowerCase() !== 'td') return m;
      const head = headers[myCol] ?? '';
      const isSig = stubSig || SIG_HEADER.test(head);
      const bounded = stubBounded || isSig || BOUNDED_HEADER.test(head);
      const text = inner.trim();
      if (!/^-?[.,]?\d[\d.,]*(E[-+]?\d+)?%?$/i.test(text)) return m;
      let out = text;
      if (isSig && /^0?[.,]000$/.test(text)) out = `&lt;${leadingZero === 'always' ? '0' : ''}${text.replace(/^0?([.,])000$/, '$1001')}`;
      else if (/^-?[.,]\d/.test(text) && (leadingZero === 'always' || (leadingZero === 'apa' && !bounded))) out = text.replace(/^(-?)([.,])/, '$10$2');
      return out === text ? m : `<${tag}${attrs}>${out}</${tag}>`;
    });
    // rowspans that cover columns after the last cell of this row
    for (let k = col; k < pending.length; k++) if ((pending[k] ?? 0) > 0) pending[k]--;
    return result;
  });
}
