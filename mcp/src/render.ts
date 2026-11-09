/*
 * Turns PSPP output items into compact Markdown that language models read well.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem } from '../../web/src/engine/types';

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => entities[m] ?? m);
const strip = (s: string) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/\|/g, '\\|');

/** PSPP's HTML tables are flat (tr, th, td with optional colspan/rowspan). */
export function htmlTableToMarkdown(html: string): string {
  const caption = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(html)?.[1];
  const grid: string[][] = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row[1].matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
      while (grid[r][c] !== undefined) c++;
      const colspan = Number(/colspan=['"]?(\d+)/i.exec(cell[2])?.[1] ?? 1);
      const rowspan = Number(/rowspan=['"]?(\d+)/i.exec(cell[2])?.[1] ?? 1);
      const text = strip(cell[3]);
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) (grid[r + dr] ??= [])[c + dc] = dr === 0 && dc === 0 ? text : '';
      c += colspan;
    }
  });
  const width = Math.max(0, ...grid.map((g) => g.length));
  if (!width || !grid.length) return caption ? `**${strip(caption)}**` : '';
  const line = (g: string[]) => `| ${Array.from({ length: width }, (_, i) => esc(g[i] ?? '')).join(' | ')} |`;
  const out = [];
  if (caption) out.push(`**${strip(caption)}**`, '');
  out.push(line(grid[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...grid.slice(1).map(line));
  return out.join('\n');
}

export function itemsToMarkdown(items: OutputItem[]): string {
  const out: string[] = [];
  const walk = (list: OutputItem[]) => {
    for (const i of list) {
      switch (i.kind) {
        case 'group':
          walk(i.children);
          break;
        case 'table':
          out.push(htmlTableToMarkdown(i.html));
          break;
        case 'text':
          if (i.subtype === 'title' || i.subtype === 'subtitle') out.push(`## ${i.text}`);
          else if (i.subtype === 'log' && i.text.trim()) out.push(`\`\`\`\n${i.text.trim()}\n\`\`\``);
          break;
        case 'message':
          out.push(`**${i.severity.toUpperCase()}${i.line ? ` (line ${i.line})` : ''}:** ${i.text}`);
          break;
        case 'chart':
          out.push(`_[chart: ${i.title} – not rendered in text output]_`);
          break;
        default:
          break;
      }
    }
  };
  walk(items);
  return out.filter(Boolean).join('\n\n');
}

export const caseCount = (ds: Dataset) => Math.max(0, ...ds.columns.map((c) => c.length));

export function describeDataset(ds: Dataset, previewRows: number): string {
  const n = caseCount(ds);
  const lines = [`**${ds.name}** – ${n} cases, ${ds.variables.length} variables`, ''];
  lines.push('| # | name | type | measure | label | value labels | missing |', '| --- | --- | --- | --- | --- | --- | --- |');
  ds.variables.forEach((v, i) => {
    const labels = v.valueLabels.slice(0, 6).map((l) => `${l.value}=${l.label}`).join('; ') + (v.valueLabels.length > 6 ? '; …' : '');
    const miss = [...v.missing.values.map(String), v.missing.range ? `${v.missing.range.low}..${v.missing.range.high}` : ''].filter(Boolean).join(', ');
    lines.push(`| ${i + 1} | ${esc(v.name)} | ${v.type === 'string' ? `string(${v.width})` : `${v.print.type}${v.print.w}.${v.print.d}`} | ${v.measure} | ${esc(v.label)} | ${esc(labels)} | ${esc(miss)} |`);
  });
  if (previewRows > 0 && n > 0) {
    lines.push('', `First ${Math.min(previewRows, n)} rows:`, '', `| ${ds.variables.map((v) => esc(v.name)).join(' | ')} |`, `| ${ds.variables.map(() => '---').join(' | ')} |`);
    for (let r = 0; r < Math.min(previewRows, n); r++) lines.push(`| ${ds.variables.map((_, c) => esc(String(ds.columns[c]?.[r] ?? ''))).join(' | ')} |`);
  }
  return lines.join('\n');
}
