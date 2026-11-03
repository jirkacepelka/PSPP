/*
 * Standalone HTML export of the output document.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem } from '../../engine/types';
import type { OutputEntry } from '../../store/output';
import outputCss from '../../styles/output.css?raw';
import { esc } from '../../engine/mock/html';

function itemHtml(it: OutputItem): string {
  if ((it as { hidden?: boolean }).hidden) return '';
  switch (it.kind) {
    case 'group':
      return `<section class="output-group"><h2 class="output-group-title">${esc(it.title)}</h2>${it.children.map(itemHtml).join('')}</section>`;
    case 'table':
      return `<div class="output-item"><div class="table-wrap">${it.html}</div></div>`;
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

const VARS = `:root{--font-ui:Inter,Roboto,system-ui,sans-serif;--font-display:var(--font-ui);--font-mono:'Roboto Mono',monospace;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--r-xs:4px;--r-sm:8px;--r-md:12px;--fs-xs:11px;--fs-sm:12px;--fs-lg:16px;--fs-xl:18px;--fs-2xl:22px;--fs-3xl:28px;--fw-regular:400;--fw-medium:500;--fw-semibold:600;
--on-surface:#1f1f1f;--on-surface-variant:#444746;--outline:#747775;--outline-variant:#c4c7c5;--divider:#e1e3e1;--grid-line:#e1e3e1;--surface:#fff;--surface-container-low:#f8fafd;--surface-container:#f0f4f9;--state-hover:transparent;
--info-container:#e1eaf7;--on-info-container:#0a2a52;--error-container:#f9dedc;--on-error-container:#410e0b;--warning-container:#ffefc9;--on-warning-container:#3d2600}
body{margin:0;background:#f0f2f5;font-family:var(--font-ui)}main{max-width:900px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.output-syntax{margin:0 0 12px}@media print{body{background:#fff}main{box-shadow:none;margin:0;padding:0}}`;

export function outputToHtml(entries: OutputEntry[], title: string, tableStyle: string): string {
  const body = entries
    .map((e) => `<article class="output-entry">${e.syntax ? `<pre class="output-syntax">${esc(e.syntax)}</pre>` : ''}${e.items.map(itemHtml).join('')}</article>`)
    .join('<hr style="border:0;border-top:1px solid #e1e3e1;margin:32px 0">');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="generator" content="PSPP Studio (GNU PSPP)"><style>${VARS}\n${outputCss}</style></head><body><main class="output-doc ts-${esc(tableStyle)}"><h1 class="output-text-title">${esc(title)}</h1>${body}</main></body></html>`;
}
