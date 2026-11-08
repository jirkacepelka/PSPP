/*
 * Output export as a standalone document: HTML to keep or send, and the same page printed to
 * PDF. The document has a title block (data set, date, size), an optional table of contents,
 * numbered results with readable titles, tables in the chosen table style, charts drawn in the
 * light theme with their styles inlined (they look the same anywhere), optional plain-language
 * interpretations and syntax, and print rules (A4, page numbers, no tables split at a header).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18n from '../../i18n';
import type { OutputItem } from '../../engine/types';
import type { OutputEntry } from '../../store/output';
import outputCss from '../../styles/output.css?raw';
import { esc } from '../../engine/mock/html';
import { formatTableHtml, type NumStyle } from '../../lib/statfmt';
import { useSettings } from '../../store/settings';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { caseCount } from '../../lib/variables';
import { chartToSvgString } from '../../charts/export';
import { INTERPRETABLE, interpret } from '../../lib/interpret';
import { describeFact, pickLang } from './interpretText';
import { entryTitle, singleCommand, visibleItems } from './outputHelpers';
import { ChartView } from './ChartView';

export interface OutputExportOptions {
  syntax: boolean;
  interpret: boolean;
  toc: boolean;
  /** 'pdf' adds page rules and is printed right away */
  mode: 'html' | 'pdf';
}

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const CHART_WIDTH = 680;

// ------------------------------------------------------------------ charts

function collectCharts(items: OutputItem[], out: Extract<OutputItem, { kind: 'chart' }>[] = []) {
  for (const i of items) {
    if ((i as { hidden?: boolean }).hidden) continue;
    if (i.kind === 'chart') out.push(i);
    else if (i.kind === 'group') collectCharts(i.children, out);
  }
  return out;
}

/**
 * Draws every chart off screen in the light theme and returns standalone SVG (styles inlined),
 * so exported charts do not depend on the app's stylesheet or on the dark theme.
 */
export function renderChartsSvg(entries: OutputEntry[]): Map<string, string> {
  const charts = entries.flatMap((e) => collectCharts(e.items));
  const out = new Map<string, string>();
  if (!charts.length || typeof document === 'undefined') return out;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${CHART_WIDTH}px;pointer-events:none;contain:layout`;
  host.className = 'output-doc';
  document.body.appendChild(host);
  const html = document.documentElement;
  const theme = html.dataset.theme;
  html.dataset.theme = 'light';
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        createElement(
          'div',
          null,
          charts.map((c) => createElement('div', { key: c.id, 'data-x': c.id, style: { width: CHART_WIDTH } }, createElement(ChartView, { chart: c.chart, title: c.title }))),
        ),
      ),
    );
    for (const c of charts) {
      const el = host.querySelector(`[data-x="${CSS.escape(c.id)}"]`);
      if (!el?.querySelector('svg')) continue;
      try {
        out.set(c.id, chartToSvgString(el).replace(/^<\?xml[^>]*>\s*/, ''));
      } catch {
        /* a chart that cannot be drawn is left out */
      }
    }
  } finally {
    root.unmount();
    host.remove();
    if (theme) html.dataset.theme = theme;
    else delete html.dataset.theme;
  }
  return out;
}

// ------------------------------------------------------------------ items

const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

interface Ctx {
  charts: Map<string, string>;
  opts: OutputExportOptions;
  leadingZero: NumStyle['leadingZero'];
  style: NumStyle;
  pThreshold: boolean;
}

function interpretation(command: string | undefined, items: OutputItem[], ctx: Ctx): string {
  if (!ctx.opts.interpret || !command || !INTERPRETABLE.includes(command.toUpperCase())) return '';
  const tables = items.filter((i): i is Extract<OutputItem, { kind: 'table' }> => i.kind === 'table').map((i) => ({ title: i.title, html: i.html }));
  if (!tables.length) return '';
  let facts;
  try {
    facts = interpret(command.toUpperCase(), tables);
  } catch {
    return '';
  }
  if (!facts.length) return '';
  const lang = i18n.language;
  const texts = facts.slice(0, 8).map((f) => describeFact(f, i18n.t, { style: ctx.style, pThreshold: ctx.pThreshold }));
  const caveat = texts.find((x) => x.caveat)?.caveat;
  const li = texts
    .map((x) => {
      const cls = x.significant === undefined ? '' : x.significant ? ' class="sig"' : ' class="ns"';
      const effect = x.effect ? `<span class="x-effect">${esc(pickLang(x.effect.label, lang))} = ${esc(x.effect.value)} · ${esc(t(`interpret.size.${x.effect.size}`))}</span>` : '';
      return `<li${cls}><p class="x-hl">${rich(x.headline)}</p>${x.details.length ? `<p class="x-detail">${x.details.map(rich).join(' ')}</p>` : ''}<p class="x-info">${effect}<code>${esc(x.report)}</code></p></li>`;
    })
    .join('');
  return `<aside class="x-explain"><h4>${esc(t('interpret.title'))}</h4><ul>${li}</ul>${caveat ? `<p class="x-caveat">${esc(caveat)}</p>` : ''}</aside>`;
}

function itemHtml(it: OutputItem, ctx: Ctx, depth: number): string {
  if ((it as { hidden?: boolean }).hidden) return '';
  if ((it as { kind: string }).kind === 'page-break') return '<div class="page-break"></div>';
  switch (it.kind) {
    case 'group': {
      const first = it.children.find((c) => !(c as { hidden?: boolean }).hidden);
      const repeats = it.children.length === 1 && first && 'title' in first && first.title.trim() === it.title.trim();
      return `<section class="output-group">${repeats ? '' : `<h3 class="x-sub">${esc(it.title)}</h3>`}${it.children.map((c) => itemHtml(c, ctx, depth + 1)).join('')}${interpretation(it.command, it.children, ctx)}</section>`;
    }
    case 'table':
      return `<div class="output-item x-table"><div class="table-wrap">${formatTableHtml(it.html, ctx.leadingZero)}</div></div>`;
    case 'text':
      if (it.subtype === 'title') return `<h3 class="x-sub">${esc(it.text)}</h3>`;
      if (it.subtype === 'subtitle' || it.subtype === 'page-title') return `<p class="x-subtitle">${esc(it.text)}</p>`;
      if (it.subtype === 'syntax' && !ctx.opts.syntax) return '';
      return `<pre class="output-text-log">${esc(it.text)}</pre>`;
    case 'message':
      return `<div class="callout ${it.severity}"><strong>${esc(t(`output.severity.${it.severity}`))}:</strong> ${esc(it.text)}</div>`;
    case 'image':
      return `<figure class="output-item x-figure"><img src="${esc(it.src)}" alt="${esc(it.title)}"/><figcaption>${esc(it.title)}</figcaption></figure>`;
    case 'chart': {
      const svg = ctx.charts.get(it.id);
      return svg ? `<figure class="output-item x-figure" aria-label="${esc(it.title)}">${svg}</figure>` : '';
    }
    default:
      return '';
  }
}

// ------------------------------------------------------------------ document

const LOGO = (accent: string) =>
  `<svg class="x-logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="${accent}"/><rect x="9.3" y="7.2" width="4.4" height="17.6" rx="2.2" fill="#fff"/><path d="M15.3 13.2H21.3A6 6 0 1 1 15.3 7.2Z" fill="#fff"/><path d="M16.6 11.9V5.9A6 6 0 0 1 22.6 11.9Z" fill="#fff" fill-opacity=".72"/></svg>`;

const DOC_CSS = (accent: string, pdf: boolean) => `
:root{--font-ui:Inter,'Segoe UI',system-ui,-apple-system,Roboto,'Helvetica Neue',Arial,sans-serif;--font-mono:'Roboto Mono',ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;
--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--radius-chip:4px;--radius-control:6px;--radius-panel:8px;
--fs-xs:11px;--fs-sm:12.5px;--fs-base:14px;--fs-lg:16px;--fs-xl:18px;--fs-2xl:24px;--fw-regular:400;--fw-medium:500;--fw-semibold:600;--icon-size-sm:18px;--hairline:1px;
--ink:#1f1e1b;--ink-2:#47453f;--ink-3:#6b6862;--line:#e7e5df;--line-strong:#d6d3ca;--line-control:#8f8b83;--surface:#fff;--surface-sunken:#f5f4f0;--surface-hover:transparent;--state-hover:transparent;
--accent:${accent};--info:#3a6390;--info-tint:#eef3f8;--info-ink:#2c4e73;--danger:#b3412e;--danger-tint:#fbeae6;--danger-ink:#8f3222;--warning:#8a5a00;--warning-tint:#fbf3e2;--warning-ink:#6e4700;--success:#2f7a4f}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f4f3ef;font-family:var(--font-ui);font-size:var(--fs-base);line-height:1.5;color:var(--ink);font-feature-settings:'tnum' 1,'cv11' 1}
.x-page{max-width:980px;margin:32px auto;background:var(--surface);border:1px solid var(--line-strong);border-radius:10px;padding:48px 56px 40px}
.x-head{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;align-items:center;padding-bottom:20px;margin-bottom:24px;border-bottom:2px solid var(--accent)}
.x-logo{width:36px;height:36px;grid-row:span 2}
.x-brand{font-size:var(--fs-sm);color:var(--ink-3);letter-spacing:.01em}
.x-head h1{margin:0;font-size:28px;line-height:1.2;font-weight:650;letter-spacing:-.01em}
.x-meta{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 20px;margin:8px 0 0;padding:0;list-style:none;font-size:var(--fs-sm);color:var(--ink-2)}
.x-meta li{display:flex;gap:6px}.x-meta b{font-weight:var(--fw-medium);color:var(--ink-3)}
.x-toc{margin:0 0 32px;padding:16px 20px;background:var(--surface-sunken);border-radius:var(--radius-panel)}
.x-toc h2{margin:0 0 8px;font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--ink-2)}
.x-toc ol{margin:0;padding:0;list-style:none;columns:2 280px;column-gap:32px}
.x-toc li{break-inside:avoid;display:flex;gap:8px;padding:3px 0;font-size:var(--fs-sm)}
.x-toc a{color:var(--ink);text-decoration:none}.x-toc a:hover{text-decoration:underline}
.x-toc .n,.x-entry-no{font-variant-numeric:tabular-nums;color:var(--accent);font-weight:var(--fw-semibold);min-width:1.6em}
.x-entry{margin:0 0 40px}
.x-entry+.x-entry{padding-top:32px;border-top:1px solid var(--line)}
.x-entry-head{display:flex;align-items:baseline;gap:10px;margin:0 0 16px;break-after:avoid}
.x-entry-head h2{margin:0;font-size:var(--fs-xl);font-weight:var(--fw-semibold);line-height:1.3;flex:1}
.x-entry-head time{font-size:var(--fs-xs);color:var(--ink-3);white-space:nowrap}
.x-sub{margin:20px 0 10px;font-size:var(--fs-base);font-weight:var(--fw-semibold);color:var(--ink-2);break-after:avoid}
.x-entry>.x-sub:first-of-type,.x-entry-head+.output-group>.x-sub:first-child{margin-top:0}
.x-subtitle{margin:0 0 10px;color:var(--ink-2)}
.output-syntax{border-left-color:var(--accent)}
.x-table{margin-bottom:20px}
.output-doc caption{font-size:var(--fs-sm)}
.x-figure{margin:0 0 20px}
.x-figure svg{display:block;max-width:100%;height:auto}
.x-figure img{max-width:100%}
.x-figure figcaption{font-size:var(--fs-sm);color:var(--ink-3)}
.x-explain{margin:4px 0 24px;padding:14px 18px;border:1px solid #d9e3ee;border-left:3px solid var(--info);background:var(--info-tint);border-radius:0 var(--radius-panel) var(--radius-panel) 0;break-inside:avoid}
.x-explain h4{margin:0 0 8px;font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--info-ink)}
.x-explain ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.x-explain li{padding-left:12px;border-left:2px solid transparent}
.x-explain li.sig{border-left-color:var(--success)}.x-explain li.ns{border-left-color:var(--line-control)}
.x-explain p{margin:0}
.x-hl{font-weight:var(--fw-regular)}
.x-detail{color:var(--ink-2);font-size:var(--fs-sm);margin-top:2px!important}
.x-explain code{font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--ink-2)}
.x-info{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px!important;font-size:var(--fs-xs)}
.x-effect{color:var(--info-ink);font-weight:var(--fw-medium)}
.x-caveat{margin-top:10px!important;font-size:var(--fs-xs);color:var(--ink-3)}
.callout{display:block;padding:8px 12px;margin:0 0 12px;border-radius:var(--radius-control);background:var(--info-tint);color:var(--info-ink);font-size:var(--fs-sm)}
.callout.error{background:var(--danger-tint);color:var(--danger-ink)}.callout.warning{background:var(--warning-tint);color:var(--warning-ink)}
.x-foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:var(--fs-xs);color:var(--ink-3);display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.page-break{break-after:page}
.output-doc tr{break-inside:avoid}
@media (max-width:720px){.x-page{margin:0;border:0;border-radius:0;padding:24px 16px}.x-head h1{font-size:22px}.x-toc ol{columns:1}}
@media ${pdf ? 'all' : 'print'}{
  body{background:#fff;font-size:10.5pt}
  .x-page{max-width:none;margin:0;border:0;border-radius:0;padding:0}
  .x-head{margin-bottom:18px}
  .x-toc{break-after:page;background:none;padding:0}
  .x-toc a{color:var(--ink)}
  .x-entry{break-inside:auto}
  .x-entry+.x-entry{border-top:0;padding-top:0}
  .x-entry.x-new-page{break-before:page}
  .table-wrap{overflow:visible}
  .output-doc table{font-size:9pt}
  .x-explain,.callout,.ts-modern tr:not(:has(td)) th,.ts-compact tbody tr:has(td):nth-child(even) td{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  a{color:inherit}
}`;

const PAGE_CSS = (title: string) => `
@page{size:A4;margin:16mm 15mm 18mm;
  @bottom-left{content:"${title.replace(/["\\\n]/g, ' ')}";font:8pt ${'Inter,system-ui,sans-serif'};color:#8a877f}
  @bottom-right{content:counter(page) " / " counter(pages);font:8pt Inter,system-ui,sans-serif;color:#8a877f}}
@page :first{@bottom-left{content:none}}`;

/**
 * Tables wider than the page are scaled down to fit (down to 55 %) instead of being cut off:
 * at once for PDF (the frame is as wide as an A4 page), before printing for HTML.
 */
const FIT_SCRIPT = (now: boolean) => `(function(){
function fit(){document.querySelectorAll('.table-wrap').forEach(function(w){var t=w.querySelector('table');if(!t)return;t.style.zoom='';var r=w.clientWidth/t.scrollWidth;if(r<0.995)t.style.zoom=String(Math.max(0.55,r));});}
function unfit(){document.querySelectorAll('.table-wrap table').forEach(function(t){t.style.zoom='';});}
${now ? 'fit();' : "addEventListener('beforeprint',fit);addEventListener('afterprint',unfit);"}
})();`;

function fmtDate(ms: number, withTime = true) {
  return new Intl.DateTimeFormat(i18n.language, withTime ? { dateStyle: 'long', timeStyle: 'short' } : { timeStyle: 'short' }).format(ms);
}

export function buildOutputDocument(entries: OutputEntry[], opts: OutputExportOptions): string {
  const s = useSettings.getState();
  const data = useData.getState();
  const title = data.title || t('views.output');
  const accent = (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) || '#0f7b5f';
  const charts = renderChartsSvg(entries);
  const ctx: Ctx = { charts, opts, leadingZero: s.leadingZero, style: { dec: s.decimalSeparator, leadingZero: s.leadingZero }, pThreshold: s.pFormat === 'threshold' };

  const sameDay = entries.length > 0 && new Date(entries[0].time).toDateString() === new Date(entries[entries.length - 1].time).toDateString();
  const body = entries
    .map((e, i) => {
      const items = visibleItems(e);
      const cmd = singleCommand(e);
      const inner = items.map((it) => itemHtml(it, ctx, 0)).join('');
      // an entry made of one procedure shows its children directly: interpret them here
      const explain = items !== e.items && cmd ? interpretation(cmd, items, ctx) : '';
      const syntax = opts.syntax && e.syntax.trim() ? `<pre class="output-syntax">${esc(e.syntax.trim())}</pre>` : '';
      return `<article class="x-entry" id="r${i + 1}"><header class="x-entry-head"><span class="x-entry-no">${i + 1}</span><h2>${esc(entryTitle(e, i18n.t))}</h2><time datetime="${new Date(e.time).toISOString()}">${esc(fmtDate(e.time, !sameDay))}</time></header>${syntax}${inner}${explain}</article>`;
    })
    .join('\n');
  const toc =
    opts.toc && entries.length > 1
      ? `<nav class="x-toc" aria-label="${esc(t('io.out.toc'))}"><h2>${esc(t('io.out.toc'))}</h2><ol>${entries.map((e, i) => `<li><span class="n">${i + 1}</span><a href="#r${i + 1}">${esc(entryTitle(e, i18n.t))}</a></li>`).join('')}</ol></nav>`
      : '';
  const ds = data.dataset;
  const meta = [
    ds ? `<li><b>${esc(t('io.out.data'))}</b>${esc(data.fileName || title)}</li>` : '',
    ds ? `<li><b>${esc(t('io.out.size'))}</b>${esc(t('io.out.sizeValue', { cases: t('io.n.cases', { count: caseCount(ds) }), vars: t('io.n.vars', { count: ds.variables.length }) }))}</li>` : '',
    `<li><b>${esc(t('io.out.results'))}</b>${entries.length}</li>`,
    `<li><b>${esc(t('io.out.created'))}</b>${esc(fmtDate(Date.now()))}</li>`,
  ].join('');
  const raw = useUi.getState().engineVersion;
  const version = raw ? (/pspp/i.test(raw) ? raw.replace(/^GNU pspp/i, 'GNU PSPP') : `GNU PSPP ${raw}`) : 'GNU PSPP';
  const docTitle = `${title} – ${t('views.output')}`;
  return `<!doctype html>
<html lang="${esc(i18n.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docTitle)}</title><meta name="generator" content="PSPP Studio (${esc(version)})">
<style>${DOC_CSS(accent, opts.mode === 'pdf')}\n${outputCss}\n${opts.mode === 'pdf' ? PAGE_CSS(docTitle) : ''}</style></head>
<body><main class="x-page output-doc ts-${esc(s.tableStyle)}">
<header class="x-head">${LOGO(accent)}<span class="x-brand">PSPP Studio · ${esc(t('io.out.report'))}</span><h1>${esc(title)}</h1><ul class="x-meta">${meta}</ul></header>
${toc}
${body}
<footer class="x-foot"><span>${esc(t('io.out.footer'))}</span><span>${esc(version)}</span></footer>
</main><script>${FIT_SCRIPT(opts.mode === 'pdf')}</script></body></html>`;
}

/** Backwards-compatible: the whole output as an HTML document. */
export function outputToHtml(entries: OutputEntry[]): string {
  const o = useSettings.getState().outputExport;
  return buildOutputDocument(entries, { ...o, mode: 'html' });
}

/** Prints the document in a hidden frame (the browser offers "Save as PDF"). */
export function printDocument(html: string, title: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:681px;height:1000px;border:0';
  document.body.appendChild(frame);
  const prevTitle = document.title;
  const cleanup = () => {
    document.title = prevTitle;
    setTimeout(() => frame.remove(), 500);
  };
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return cleanup();
    // the PDF file name comes from the page title
    document.title = title;
    w.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } finally {
        // browsers without afterprint in frames
        setTimeout(cleanup, 60_000);
      }
    }, 80);
  };
  frame.srcdoc = html;
}
