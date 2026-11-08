/*
 * Output export as a Word document (.docx, Office Open XML): title block, optional contents,
 * numbered results as headings, engine tables as real Word tables (merged cells, repeated header
 * rows, hairline rules, numbers right-aligned), charts as PNG pictures drawn in the light theme,
 * interpretations as shaded notes and optional syntax. A4, page numbers in the footer. Edits in
 * Word keep working: headings use the built-in Heading styles, so Word can add a real contents.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { strToU8, zipSync } from 'fflate';
import i18n from '../../i18n';
import type { OutputItem } from '../../engine/types';
import type { OutputEntry } from '../../store/output';
import { formatTableHtml } from '../../lib/statfmt';
import { useSettings } from '../../store/settings';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { caseCount } from '../../lib/variables';
import { pickLang } from './interpretText';
import { entryTitle, singleCommand, visibleItems } from './outputHelpers';
import { explainTexts, renderChartsSvg, type OutputExportOptions } from './exportHtml';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

const x = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A4 with 2 cm margins: text width in twentieths of a point. */
const TEXT_W = 9638;
const MAX_IMG_PX = 600;

// ------------------------------------------------------------------ runs and paragraphs

interface RunOpts {
  b?: boolean;
  i?: boolean;
  color?: string;
  sz?: number; // half-points
  mono?: boolean;
}

function run(text: string, o: RunOpts = {}): string {
  if (!text) return '';
  const pr = [o.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '', o.b ? '<w:b/>' : '', o.i ? '<w:i/>' : '', o.color ? `<w:color w:val="${o.color}"/>` : '', o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''].join('');
  // line breaks inside a run
  return text
    .split('\n')
    .map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`)
    .join('');
}

/** "**bold**" markers to runs. */
const richRuns = (s: string, o: RunOpts = {}) =>
  s
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => run(part, i % 2 ? { ...o, b: true } : o))
    .join('');

function para(runs: string, o: { style?: string; align?: 'left' | 'right' | 'center'; keepNext?: boolean; spacingAfter?: number; spacingBefore?: number; extra?: string } = {}): string {
  const pr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.extra ?? '',
    o.spacingAfter !== undefined || o.spacingBefore !== undefined ? `<w:spacing${o.spacingBefore !== undefined ? ` w:before="${o.spacingBefore}"` : ''}${o.spacingAfter !== undefined ? ` w:after="${o.spacingAfter}"` : ''}/>` : '',
    o.align && o.align !== 'left' ? `<w:jc w:val="${o.align === 'center' ? 'center' : 'right'}"/>` : '',
  ].join('');
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs}</w:p>`;
}

// ------------------------------------------------------------------ tables

interface GridCell {
  text: string;
  head: boolean;
  align: 'left' | 'right' | 'center';
  span: number;
  /** 'restart' starts a vertical merge, 'continue' is covered by the cell above */
  vmerge?: 'restart' | 'continue';
  bold: boolean;
}

function cellText(el: Element): string {
  // <br> as line breaks, superscript footnote marks kept as plain text
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  return (clone.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Converts an engine table (HTML) to rows of grid cells with merges resolved. */
export function tableGrid(table: HTMLTableElement): { caption: string; rows: GridCell[][]; foot: string[]; headRows: number } {
  const caption = table.caption ? cellText(table.caption) : '';
  const foot = Array.from(table.tFoot?.rows ?? []).map((r) => cellText(r));
  const trs = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr'));
  const pending: { left: number; cell: GridCell }[] = []; // rowspans carried down, by column
  const rows: GridCell[][] = [];
  for (const tr of trs) {
    const row: GridCell[] = [];
    let col = 0;
    const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const take = () => {
      while (pending[col] && pending[col].left > 0) {
        const p = pending[col];
        p.left--;
        row.push({ ...p.cell, text: '', vmerge: 'continue' });
        col += p.cell.span;
      }
    };
    for (const c of cells) {
      take();
      const span = Math.max(1, Number(c.getAttribute('colspan')) || 1);
      const rs = Math.max(1, Number(c.getAttribute('rowspan')) || 1);
      const style = (c.getAttribute('style') ?? '').toLowerCase();
      const align = /text-align:\s*right/.test(style) ? 'right' : /text-align:\s*center/.test(style) ? 'center' : c.tagName === 'TD' ? 'right' : 'left';
      const cell: GridCell = { text: cellText(c), head: c.tagName === 'TH', align, span, bold: /font-weight:\s*bold/.test(style) };
      if (rs > 1) {
        cell.vmerge = 'restart';
        pending[col] = { left: rs - 1, cell };
      }
      row.push(cell);
      col += span;
    }
    take();
    rows.push(row);
  }
  let headRows = 0;
  for (const r of rows) {
    if (r.length && r.every((c) => c.head)) headRows++;
    else break;
  }
  return { caption, rows, foot, headRows };
}

const RULE = (side: string, sz: number, color: string) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;

function tableXml(html: string, leadingZero: Parameters<typeof formatTableHtml>[1]): string {
  const doc = new DOMParser().parseFromString(formatTableHtml(html, leadingZero), 'text/html');
  const table = doc.querySelector('table');
  if (!table) return '';
  const { caption, rows, foot, headRows } = tableGrid(table);
  const ncol = Math.max(1, ...rows.map((r) => r.reduce((s, c) => s + c.span, 0)));
  // column widths from content: the longest line (capped) and the longest word, ~100 twips a character at 9 pt
  const need = Array.from({ length: ncol }, () => 4);
  const minW = Array.from({ length: ncol }, () => 3);
  for (const r of rows) {
    let col = 0;
    for (const c of r) {
      if (c.span === 1 && c.text) {
        const lines = c.text.split('\n');
        need[col] = Math.max(need[col], Math.min(26, Math.max(...lines.map((l) => l.length))) + 1);
        minW[col] = Math.max(minW[col], Math.max(...c.text.split(/\s+/).map((w) => w.length)) + 1);
      }
      col += c.span;
    }
  }
  let widths = need.map((n, i) => Math.max(n, minW[i]) * 100 + 200);
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > TEXT_W) {
    // shrink the wide columns first, never below their longest word
    const floor = minW.map((m) => m * 100 + 200);
    const spare = widths.reduce((a, w, i) => a + (w - floor[i]), 0);
    const cut = Math.min(spare, total - TEXT_W);
    widths = widths.map((w, i) => Math.round(w - (spare ? ((w - floor[i]) / spare) * cut : 0)));
    const t2 = widths.reduce((a, b) => a + b, 0);
    if (t2 > TEXT_W) widths = widths.map((w) => Math.floor((w * TEXT_W) / t2));
  }
  const spanW = (from: number, span: number) => widths.slice(from, from + span).reduce((a, b) => a + b, 0);
  const trs = rows
    .map((r, ri) => {
      const isHead = ri < headRows;
      const lastHead = ri === headRows - 1;
      let at = 0;
      const tcs = r
        .map((c) => {
          const w = spanW(at, c.span);
          at += c.span;
          const borders = lastHead ? `<w:tcBorders>${RULE('bottom', 6, '8F8B83')}</w:tcBorders>` : '';
          const pr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ''}${c.vmerge ? `<w:vMerge${c.vmerge === 'restart' ? ' w:val="restart"' : ''}/>` : ''}${borders}${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="F5F4F0"/>' : ''}<w:vAlign w:val="${isHead ? 'bottom' : 'top'}"/></w:tcPr>`;
          const color = c.head && !isHead ? '47453F' : isHead ? '47453F' : undefined;
          return `<w:tc>${pr}${para(run(c.text, { b: c.bold || isHead, color }), { style: 'TableText', align: isHead && c.align !== 'left' ? 'center' : c.align })}</w:tc>`;
        })
        .join('');
      return `<w:tr><w:trPr><w:cantSplit/>${isHead ? '<w:tblHeader/>' : ''}</w:trPr>${tcs}</w:tr>`;
    })
    .join('');
  const tbl = `<w:tbl><w:tblPr><w:tblStyle w:val="PsppTable"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${RULE('top', 8, '47453F')}${RULE('bottom', 8, '47453F')}${RULE('insideH', 4, 'E3E0D8')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${trs}</w:tbl>`;
  return [caption ? para(run(caption), { style: 'TableCaption', keepNext: true }) : '', tbl, ...foot.map((f) => para(run(f), { style: 'TableNote' })), para('', { style: 'AfterTable' })].join('');
}

// ------------------------------------------------------------------ pictures

interface Picture {
  id: string; // rId
  file: string;
  data: Uint8Array;
  w: number; // px
  h: number;
}

async function svgToPng(svg: string): Promise<{ data: Uint8Array; w: number; h: number } | null> {
  const w = Number(svg.match(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/)?.[1] ?? 0);
  const h = Number(svg.match(/<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/)?.[1] ?? 0);
  if (!w || !h) return null;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg'));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), w, h } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlBytes(src: string): Uint8Array | null {
  const m = src.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function pictureXml(p: Picture, n: number, title: string): string {
  const scale = Math.min(1, MAX_IMG_PX / p.w);
  const cx = Math.round(p.w * scale * 9525);
  const cy = Math.round(p.h * scale * 9525);
  return para(
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${x(title || `Chart ${n}`)}" descr="${x(title)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${p.file}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${p.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
    { style: 'Figure' },
  );
}

// ------------------------------------------------------------------ document

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

function stylesXml(accent: string): string {
  const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
  const pStyle = (id: string, name: string, ppr: string, rpr: string, extra = '') =>
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  const heading = (n: number, sz: number, before: number, color: string) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:color w:val="1F1E1B"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${i18n.language === 'cs' ? 'cs-CZ' : 'en-GB'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
${heading(1, 30, 360, '1F1E1B')}
${heading(2, 24, 240, '47453F')}
${heading(3, 22, 200, '47453F')}
${pStyle('Brand', 'PSPP Brand', '<w:spacing w:after="40"/>', `<w:color w:val="6B6862"/><w:sz w:val="18"/>`)}
${pStyle('Meta', 'PSPP Meta', `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="8" w:color="${accent}"/></w:pBdr><w:spacing w:after="360"/>`, '<w:color w:val="47453F"/><w:sz w:val="19"/>')}
${pStyle('TocEntry', 'PSPP Contents Entry', '<w:spacing w:after="40"/><w:ind w:left="360" w:hanging="360"/>', '<w:sz w:val="20"/>')}
${pStyle('TableCaption', 'PSPP Table Caption', '<w:keepNext/><w:spacing w:before="160" w:after="80"/>', '<w:b/><w:sz w:val="20"/>')}
${pStyle('TableText', 'PSPP Table Text', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/><w:szCs w:val="18"/>')}
${pStyle('TableNote', 'PSPP Table Note', '<w:spacing w:before="40" w:after="0"/>', '<w:color w:val="6B6862"/><w:sz w:val="16"/>')}
${pStyle('AfterTable', 'PSPP After Table', '<w:spacing w:after="160"/>', '<w:sz w:val="8"/>')}
${pStyle('Figure', 'PSPP Figure', '<w:keepNext/><w:spacing w:before="120" w:after="200"/>', '')}
${pStyle('Code', 'PSPP Syntax', '<w:shd w:val="clear" w:color="auto" w:fill="F5F4F0"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="' + accent + '"/></w:pBdr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/><w:ind w:left="160"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="47453F"/><w:sz w:val="17"/>')}
${pStyle('Explain', 'PSPP Interpretation', '<w:shd w:val="clear" w:color="auto" w:fill="EEF3F8"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="3A6390"/></w:pBdr><w:spacing w:after="60"/><w:ind w:left="160" w:right="160"/>', '<w:sz w:val="20"/>')}
${pStyle('Message', 'PSPP Message', '<w:spacing w:after="120"/>', '<w:color w:val="6E4700"/><w:sz w:val="19"/>')}
${pStyle('Footer', 'footer', '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs><w:spacing w:after="0"/>', '<w:color w:val="8A877F"/><w:sz w:val="16"/>')}
<w:style w:type="table" w:customStyle="1" w:styleId="PsppTable"><w:name w:val="PSPP Table"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
}

function fmtDate(ms: number, withTime = true) {
  return new Intl.DateTimeFormat(i18n.language, withTime ? { dateStyle: 'long', timeStyle: 'short' } : { timeStyle: 'short' }).format(ms);
}

export async function buildOutputDocx(entries: OutputEntry[], opts: Omit<OutputExportOptions, 'mode'>): Promise<Uint8Array> {
  const s = useSettings.getState();
  const data = useData.getState();
  const title = data.title || t('views.output');
  const accent = ((typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) || '#0f7b5f').replace('#', '').slice(0, 6).toUpperCase();
  const svgs = renderChartsSvg(entries);
  const pictures: Picture[] = [];
  const pngs = new Map<string, Picture>();
  for (const [id, svg] of svgs) {
    const png = await svgToPng(svg);
    if (!png) continue;
    const p: Picture = { id: `rIdImg${pictures.length + 1}`, file: `image${pictures.length + 1}.png`, ...png };
    pictures.push(p);
    pngs.set(id, p);
  }
  let picNo = 0;

  const explain = (cmd: string | undefined, items: OutputItem[]): string => {
    if (!opts.interpret) return '';
    const texts = explainTexts(cmd, items);
    if (!texts.length) return '';
    const lang = i18n.language;
    const caveat = texts.find((y) => y.caveat)?.caveat;
    return [
      para(run(t('interpret.title'), { b: true, color: '2C4E73', sz: 19 }), { style: 'Explain', keepNext: true, spacingBefore: 80 }),
      ...texts.map((y) => {
        const effect = y.effect ? `${pickLang(y.effect.label, lang)} = ${y.effect.value} · ${t(`interpret.size.${y.effect.size}`)}` : '';
        return para(
          richRuns(y.headline) +
            (y.details.length ? '<w:r><w:br/></w:r>' + richRuns(y.details.join(' '), { color: '47453F', sz: 19 }) : '') +
            '<w:r><w:br/></w:r>' +
            (effect ? run(effect + '   ', { color: '2C4E73', sz: 17, b: true }) : '') +
            run(y.report, { mono: true, sz: 16, color: '47453F' }),
          { style: 'Explain' },
        );
      }),
      caveat ? para(run(caveat, { i: true, color: '6B6862', sz: 17 }), { style: 'Explain' }) : '',
      para('', { style: 'AfterTable' }),
    ].join('');
  };

  const item = (it: OutputItem, depth: number): string => {
    if ((it as { hidden?: boolean }).hidden) return '';
    if ((it as { kind: string }).kind === 'page-break') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    switch (it.kind) {
      case 'group': {
        const first = it.children.find((c) => !(c as { hidden?: boolean }).hidden);
        const repeats = it.children.length === 1 && first && 'title' in first && first.title.trim() === it.title.trim();
        return (repeats ? '' : para(run(it.title), { style: depth > 0 ? 'Heading3' : 'Heading2' })) + it.children.map((c) => item(c, depth + 1)).join('') + explain(it.command, it.children);
      }
      case 'table':
        return tableXml(it.html, s.leadingZero);
      case 'text':
        if (it.subtype === 'title') return para(run(it.text), { style: 'Heading3' });
        if (it.subtype === 'subtitle' || it.subtype === 'page-title') return para(run(it.text, { color: '47453F' }));
        if (it.subtype === 'syntax' && !opts.syntax) return '';
        return para(run(it.text), { style: 'Code' });
      case 'message':
        return para(run(`${t(`output.severity.${it.severity}`)}: `, { b: true }) + run(it.text), { style: 'Message' });
      case 'chart': {
        const p = pngs.get(it.id);
        return p ? pictureXml(p, ++picNo, it.title) : '';
      }
      case 'image': {
        const bytes = dataUrlBytes(it.src);
        if (!bytes) return '';
        const p: Picture = { id: `rIdImg${pictures.length + 1}`, file: `image${pictures.length + 1}.png`, data: bytes, w: 600, h: 400 };
        pictures.push(p);
        return pictureXml(p, ++picNo, it.title);
      }
      default:
        return '';
    }
  };

  const ds = data.dataset;
  const meta = [
    ds ? `${t('io.out.data')}: ${data.fileName || title}` : '',
    ds ? `${t('io.out.size')}: ${t('io.out.sizeValue', { cases: t('io.n.cases', { count: caseCount(ds) }), vars: t('io.n.vars', { count: ds.variables.length }) })}` : '',
    `${t('io.out.created')}: ${fmtDate(Date.now())}`,
  ].filter(Boolean);
  const sameDay = entries.length > 0 && new Date(entries[0].time).toDateString() === new Date(entries[entries.length - 1].time).toDateString();

  const parts: string[] = [
    para(run(`PSPP Studio · ${t('io.out.report')}`), { style: 'Brand' }),
    para(run(title), { style: 'Title' }),
    para(meta.map((m, i) => (i ? run('     ') : '') + run(m)).join(''), { style: 'Meta' }),
  ];
  if (opts.toc && entries.length > 1) {
    parts.push(para(run(t('io.out.toc')), { style: 'Heading2', spacingBefore: 0 }));
    entries.forEach((e, i) => parts.push(para(run(`${i + 1}`, { b: true, color: accent }) + '<w:r><w:tab/></w:r>' + run(entryTitle(e, i18n.t)), { style: 'TocEntry' })));
    parts.push(para('', { spacingAfter: 240 }));
  }
  entries.forEach((e, i) => {
    const items = visibleItems(e);
    const cmd = singleCommand(e);
    parts.push(para(run(`${i + 1}  `, { color: accent }) + run(entryTitle(e, i18n.t)) + run(`   ${fmtDate(e.time, !sameDay)}`, { b: false, color: '8A877F', sz: 17 }), { style: 'Heading1' }));
    if (opts.syntax && e.syntax.trim()) parts.push(para(run(e.syntax.trim()), { style: 'Code' }));
    parts.push(items.map((it) => item(it, 0)).join(''));
    if (items !== e.items && cmd) parts.push(explain(cmd, items));
  });
  const raw = useUi.getState().engineVersion;
  const version = raw ? (/pspp/i.test(raw) ? raw.replace(/^GNU pspp/i, 'GNU PSPP') : `GNU PSPP ${raw}`) : 'GNU PSPP';
  parts.push(para(run(`${t('io.out.footer')} ${version}.`, { color: '8A877F', sz: 16 }), { spacingBefore: 360 }));

  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const document_ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${parts.join('')}${sect}</w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>${para(run(`${title} – ${t('views.output')}`) + '<w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>', { style: 'Footer' })}</w:ftr>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${pictures.map((p) => `<Relationship Id="${p.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${p.file}"/>`).join('')}</Relationships>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(`${title} – ${t('views.output')}`)}</dc:title><dc:creator>PSPP Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
    ),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PSPP Studio</Application></Properties>`),
    'word/_rels/document.xml.rels': strToU8(rels),
    'word/document.xml': strToU8(document_),
    'word/styles.xml': strToU8(stylesXml(accent)),
    'word/settings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${NS}><w:updateFields w:val="false"/><w:defaultTabStop w:val="709"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`),
    'word/footer1.xml': strToU8(footer),
  };
  for (const p of pictures) files[`word/media/${p.file}`] = p.data;
  return zipSync(files, { level: 6 });
}
