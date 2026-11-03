/*
 * Standalone HTML export of the output document.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem } from '../../engine/types';
import type { OutputEntry } from '../../store/output';
import outputCss from '../../styles/output.css?raw';
import { esc } from '../../engine/mock/html';
import { formatTableHtml } from '../../lib/statfmt';
import { useSettings } from '../../store/settings';

function itemHtml(it: OutputItem): string {
  if ((it as { hidden?: boolean }).hidden) return '';
  switch (it.kind) {
    case 'group':
      return `<section class="output-group"><h2 class="output-group-title">${esc(it.title)}</h2>${it.children.map(itemHtml).join('')}</section>`;
    case 'table':
      return `<div class="output-item"><div class="table-wrap">${formatTableHtml(it.html, useSettings.getState().leadingZero)}</div></div>`;
    case 'text':
      if (it.subtype === 'title') return `<h1 class="output-text-title">${esc(it.text)}</h1>`;
      if (it.subtype === 'subtitle' || it.subtype === 'page-title') return `<h2 class="output-text-subtitle">${esc(it.text)}</h2>`;
      return `<pre class="output-text-log">${esc(it.text)}</pre>`;
    case 'message':
      return `<div class="callout ${it.severity}"><strong>${it.severity}</strong>&nbsp;${esc(it.text)}${it.line ? ` <span class="callout-line">line ${it.line}</span>` : ''}</div>`;
    case 'image':
      return `<figure class="output-item"><img src="${esc(it.src)}" alt="${esc(it.title)}" style="max-width:100%"/><figcaption>${esc(it.title)}</figcaption></figure>`;
    case 'chart': {
      const el = typeof document !== 'undefined' ? document.querySelector(`[data-chart-id="${it.id}"] svg`) : null;
      return `<figure class="output-item"><h3 class="item-title">${esc(it.title)}</h3>${el ? el.outerHTML : ''}</figure>`;
    }
    default:
      return '';
  }
}

const VARS = `:root{--font-ui:Inter,Roboto,system-ui,sans-serif;--font-mono:'Roboto Mono',monospace;--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--radius-chip:4px;--radius-control:6px;--radius-panel:8px;--fs-xs:11px;--fs-sm:12px;--fs-base:14px;--fs-lg:16px;--fs-xl:18px;--fs-2xl:22px;--fw-regular:400;--fw-medium:500;--fw-semibold:600;--icon-size-sm:18px;
--ink:#1f1e1b;--ink-2:#4a4843;--ink-3:#6b6862;--line:#e7e5df;--line-strong:#d9d6ce;--line-control:#8f8b83;--surface:#fff;--surface-sunken:#f4f3ef;--surface-hover:transparent;
--info:#3a6390;--info-tint:#e9eff6;--info-ink:#2c4e73;--danger:#b3412e;--danger-tint:#fbeae6;--danger-ink:#8f3222;--warning:#8a5a00;--warning-tint:#fbf3e2;--warning-ink:#6e4700}
body{margin:0;background:#f9f8f5;font-family:var(--font-ui);color:var(--ink)}main{max-width:1000px;margin:24px auto;background:#fff;padding:40px 48px;border:1px solid #d9d6ce;border-radius:8px}
.output-entry{margin-bottom:32px}.output-syntax{margin:0 0 12px}@media print{body{background:#fff}main{border:0;margin:0;padding:0}}`;

export function outputToHtml(entries: OutputEntry[], title: string, tableStyle: string): string {
  const body = entries
    .map((e) => `<article class="output-entry">${e.syntax ? `<pre class="output-syntax">${esc(e.syntax)}</pre>` : ''}${e.items.map(itemHtml).join('')}</article>`)
    .join('<hr style="border:0;border-top:1px solid #e1e3e1;margin:32px 0">');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="generator" content="PSPP Studio (GNU PSPP)"><style>${VARS}\n${outputCss}</style></head><body><main class="output-doc ts-${esc(tableStyle)}"><h1 class="output-text-title">${esc(title)}</h1>${body}</main></body></html>`;
}
