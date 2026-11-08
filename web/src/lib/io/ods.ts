/*
 * OpenDocument spreadsheets (.ods, LibreOffice / OpenOffice): reading the first sheet into a
 * dataset, and writing a dataset as a "Data" sheet plus a "Variables" sheet.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Dataset } from '../../engine/types';
import { PSPP_EPOCH_MS } from '../format';
import { dateKind, gridToDataset, labelOf, psppToIso, secondsToDuration, type SheetCell } from './common';
import { dictionaryRows, type DictionaryLabels } from './xlsx';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
};

// ------------------------------------------------------------------ read

function isoToPspp(s: string): number | null {
  const m = s.match(/^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?/);
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) - PSPP_EPOCH_MS) / 1000 + Number(m[6] ?? 0);
}

function durationToSeconds(s: string): number | null {
  const m = s.match(/^(-)?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  const v = Number(m[2] ?? 0) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return m[1] ? -v : v;
}

const MAX_REPEAT = 10000;

export function odsToDataset(bytes: Uint8Array, name: string, opts: { sheet?: number; header?: boolean } = {}): Dataset & { sheets: string[] } {
  const files = unzipSync(bytes);
  if (!files['content.xml']) throw new Error('Not an OpenDocument spreadsheet (content.xml is missing).');
  const doc = new DOMParser().parseFromString(strFromU8(files['content.xml']), 'application/xml');
  const tables = Array.from(doc.getElementsByTagNameNS(NS.table, 'table'));
  if (!tables.length) throw new Error('The spreadsheet has no sheets.');
  const table = tables[Math.min(opts.sheet ?? 0, tables.length - 1)];
  const grid: SheetCell[][] = [];
  for (const row of Array.from(table.getElementsByTagNameNS(NS.table, 'table-row'))) {
    const out: SheetCell[] = [];
    for (const c of Array.from(row.children)) {
      if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
      const type = c.getAttributeNS(NS.office, 'value-type');
      let cell: SheetCell = null;
      if (type === 'float' || type === 'percentage' || type === 'currency') cell = { n: Number(c.getAttributeNS(NS.office, 'value')) };
      else if (type === 'boolean') cell = { n: c.getAttributeNS(NS.office, 'boolean-value') === 'true' ? 1 : 0 };
      else if (type === 'date') {
        const raw = c.getAttributeNS(NS.office, 'date-value') ?? '';
        const v = isoToPspp(raw);
        cell = v === null ? null : { n: v, kind: raw.includes('T') ? 'datetime' : 'date' };
      } else if (type === 'time') {
        const v = durationToSeconds(c.getAttributeNS(NS.office, 'time-value') ?? '');
        cell = v === null ? null : { n: v, kind: 'time' };
      } else if (type) {
        const ps = Array.from(c.getElementsByTagNameNS(NS.text, 'p')).map((p) => p.textContent ?? '');
        cell = { s: ps.join('\n') };
      }
      if (cell && 'n' in cell && !Number.isFinite(cell.n)) cell = null;
      const rep = Math.min(MAX_REPEAT, Number(c.getAttributeNS(NS.table, 'number-columns-repeated') ?? 1) || 1);
      // a long run of empty cells at the end of a row is padding, not data
      if (cell === null && rep > 1 && c === row.lastElementChild) break;
      for (let i = 0; i < rep; i++) out.push(cell);
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    const rep = Math.min(MAX_REPEAT, Number(row.getAttributeNS(NS.table, 'number-rows-repeated') ?? 1) || 1);
    if (!out.length && rep > 1) {
      for (let i = 0; i < Math.min(rep, 50); i++) grid.push([]);
      continue;
    }
    for (let i = 0; i < rep; i++) grid.push(out.slice());
  }
  while (grid.length && !grid[grid.length - 1].length) grid.pop();
  return { ...gridToDataset(grid, name, { header: opts.header }), sheets: tables.map((t) => t.getAttributeNS(NS.table, 'name') ?? '') };
}

// ------------------------------------------------------------------ write

const x = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const str = (s: string, style = '') => `<table:table-cell${style ? ` table:style-name="${style}"` : ''} office:value-type="string"><text:p>${x(s)}</text:p></table:table-cell>`;
const EMPTY = '<table:table-cell/>';
const timeText = (s: number) => secondsToDuration(s).replace(/^(-?)PT(\d+)H(\d+)M(\d+)S$/, '$1$2:$3:$4');

export function datasetToOds(ds: Dataset, L: DictionaryLabels, opts: { labels?: boolean } = {}): Uint8Array {
  const n = Math.max(0, ...ds.columns.map((c) => c.length));
  const kinds = ds.variables.map((v) => (v.type === 'numeric' ? dateKind(v.print.type) : null));
  const rows: string[] = [`<table:table-row>${ds.variables.map((v) => str(v.name, 'head')).join('')}</table:table-row>`];
  for (let r = 0; r < n; r++) {
    const cells = ds.variables.map((v, i) => {
      const c = ds.columns[i][r] ?? null;
      if (c === null) return EMPTY;
      if (opts.labels) {
        const l = labelOf(v, c);
        if (l !== undefined) return str(l);
      }
      if (typeof c === 'string') return c.trimEnd() === '' ? EMPTY : str(c.trimEnd());
      if (!Number.isFinite(c)) return EMPTY;
      const k = kinds[i];
      // the <text:p> display text is what some readers (PSPP's own) take as the value
      if (k === 'date' || k === 'datetime') {
        const iso = psppToIso(c, k);
        return `<table:table-cell table:style-name="${k}" office:value-type="date" office:date-value="${iso}"><text:p>${iso.replace('T', ' ')}</text:p></table:table-cell>`;
      }
      if (k === 'time') return `<table:table-cell table:style-name="time" office:value-type="time" office:time-value="${secondsToDuration(c)}"><text:p>${timeText(c)}</text:p></table:table-cell>`;
      return `<table:table-cell office:value-type="float" office:value="${c}"><text:p>${c}</text:p></table:table-cell>`;
    });
    rows.push(`<table:table-row>${cells.join('')}</table:table-row>`);
  }
  const dict = [`<table:table-row>${L.cols.map((c) => str(c, 'head')).join('')}</table:table-row>`, ...dictionaryRows(ds, L).map((r) => `<table:table-row>${r.map((c) => (c ? str(c) : EMPTY)).join('')}</table:table-row>`)];
  const colDefs = (ws: number[]) => ws.map((w) => `<table:table-column table:style-name="co${Math.round(w)}"/>`).join('');
  const dataW = ds.variables.map((v, i) => (kinds[i] === 'datetime' ? 4.2 : kinds[i] === 'date' ? 2.6 : Math.max(2.2, Math.min(6, v.name.length * 0.22 + 0.8))));
  const dictW = [3, 6, 2.4, 2.4, 2.6, 9, 3.5];
  const allW = [...new Set([...dataW, ...dictW].map((w) => Math.round(w)))];
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="${NS.office}" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="${NS.text}" xmlns:table="${NS.table}" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" office:version="1.3">
<office:automatic-styles>
${allW.map((w) => `<style:style style:name="co${w}" style:family="table-column"><style:table-column-properties style:column-width="${w}cm"/></style:style>`).join('')}
<number:date-style style:name="Nd"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style>
<number:date-style style:name="Ndt"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/><number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/><number:text>:</number:text><number:seconds number:style="long"/></number:date-style>
<number:time-style style:name="Nt" number:truncate-on-overflow="false"><number:hours/><number:text>:</number:text><number:minutes number:style="long"/><number:text>:</number:text><number:seconds number:style="long"/></number:time-style>
<style:style style:name="date" style:family="table-cell" style:data-style-name="Nd"/>
<style:style style:name="datetime" style:family="table-cell" style:data-style-name="Ndt"/>
<style:style style:name="time" style:family="table-cell" style:data-style-name="Nt"/>
<style:style style:name="head" style:family="table-cell"><style:table-cell-properties fo:background-color="#f1efea" fo:border-bottom="0.5pt solid #8f8b83"/><style:text-properties fo:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="${x(L.sheetData)}">${colDefs(dataW)}${rows.join('\n')}</table:table>
<table:table table:name="${x(L.sheetVars)}">${colDefs(dictW)}${dict.join('\n')}</table:table>
</office:spreadsheet></office:body></office:document-content>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-settings xmlns:office="${NS.office}" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item-map-named config:name="Tables">${[L.sheetData, L.sheetVars]
    .map(
      (s) =>
        `<config:config-item-map-entry config:name="${x(s)}"><config:config-item config:name="VerticalSplitMode" config:type="short">2</config:config-item><config:config-item config:name="VerticalSplitPosition" config:type="int">1</config:config-item><config:config-item config:name="ActiveSplitRange" config:type="short">2</config:config-item><config:config-item config:name="PositionBottom" config:type="int">1</config:config-item></config:config-item-map-entry>`,
    )
    .join('')}</config:config-item-map-named></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="${NS.office}" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><meta:generator>PSPP Studio</meta:generator><dc:title>${x(ds.fileLabel || ds.name)}</dc:title><meta:creation-date>${new Date().toISOString().slice(0, 19)}</meta:creation-date></office:meta></office:document-meta>`;
  // the mimetype entry must come first and be stored uncompressed
  return zipSync(
    {
      mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
      'content.xml': strToU8(content),
      'settings.xml': strToU8(settings),
      'meta.xml': strToU8(meta),
      'META-INF/manifest.xml': strToU8(manifest),
    },
    { level: 6 },
  );
}
