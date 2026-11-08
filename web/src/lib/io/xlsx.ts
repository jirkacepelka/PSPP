/*
 * Excel workbooks (.xlsx): reading the first worksheet into a dataset, and writing a dataset as
 * a "Data" sheet (header row, frozen, dates as real dates) plus a "Variables" sheet describing
 * each variable (label, type, measure, value labels, missing values).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Dataset, Variable } from '../../engine/types';
import { formatSpec } from '../format';
import { dateKind, gridToDataset, labelOf, psppToSerial, serialToPspp, type DateKind, type SheetCell } from './common';

// ------------------------------------------------------------------ read

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name));

/** Built-in Excel number formats that show dates or times. */
const BUILTIN_DATE: Record<number, DateKind> = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time' };

export function formatCodeKind(code: string): DateKind {
  const c = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '')
    .split(';')[0]
    .toLowerCase();
  const hasDate = /[dy]/.test(c) || /(^|[^h:])m{3,}/.test(c);
  const hasTime = /[hs]/.test(c) || /am\/pm/.test(c);
  if (hasDate && hasTime) return 'datetime';
  if (hasDate) return 'date';
  if (hasTime) return 'time';
  return null;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
}

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

export function xlsxToDataset(bytes: Uint8Array, name: string, opts: { sheet?: number; header?: boolean } = {}): Dataset & { sheets: string[] } {
  const files = unzipSync(bytes);
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : null);
  const wb = read('xl/workbook.xml');
  if (!wb) throw new Error('Not an Excel workbook (xl/workbook.xml is missing).');
  const wbDoc = parseXml(wb);
  const sheets = kids(wbDoc, 'sheet').map((s) => ({ name: s.getAttribute('name') ?? '', rid: s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '' }));
  if (!sheets.length) throw new Error('The workbook has no worksheets.');
  const pick = sheets[Math.min(opts.sheet ?? 0, sheets.length - 1)];
  const rels = parseXml(read('xl/_rels/workbook.xml.rels') ?? '<Relationships/>');
  const target = kids(rels, 'Relationship').find((r) => r.getAttribute('Id') === pick.rid)?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  const sheetXml = read(resolve('xl/workbook.xml', target));
  if (!sheetXml) throw new Error(`Worksheet ${pick.name} not found.`);
  const date1904 = kids(wbDoc, 'workbookPr')[0]?.getAttribute('date1904');
  const offset1904 = date1904 === '1' || date1904 === 'true' ? 1462 : 0;

  const shared = (() => {
    const s = read('xl/sharedStrings.xml');
    if (!s) return [] as string[];
    return kids(parseXml(s), 'si').map((si) =>
      kids(si, 't')
        .filter((t) => !t.parentElement || t.parentElement.localName !== 'rPh')
        .map((t) => t.textContent ?? '')
        .join(''),
    );
  })();

  const xfKinds = (() => {
    const s = read('xl/styles.xml');
    if (!s) return [] as DateKind[];
    const doc = parseXml(s);
    const custom = new Map<number, string>();
    for (const f of kids(doc, 'numFmt')) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
    const cellXfs = kids(doc, 'cellXfs')[0];
    if (!cellXfs) return [];
    return kids(cellXfs, 'xf').map((xf) => {
      const id = Number(xf.getAttribute('numFmtId') ?? 0);
      return custom.has(id) ? formatCodeKind(custom.get(id)!) : BUILTIN_DATE[id] ?? null;
    });
  })();

  const grid: SheetCell[][] = [];
  const doc = parseXml(sheetXml);
  let rowNo = 0;
  for (const row of kids(doc, 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    rowNo = Number.isFinite(r) && r >= 0 ? r : rowNo;
    const out: SheetCell[] = (grid[rowNo] = []);
    let col = 0;
    for (const c of kids(row, 'c')) {
      const ref = c.getAttribute('r');
      if (ref) col = colIndex(ref);
      const t = c.getAttribute('t') ?? 'n';
      const v = kids(c, 'v')[0]?.textContent ?? null;
      let cell: SheetCell = null;
      if (t === 's' && v !== null) cell = { s: shared[Number(v)] ?? '' };
      else if (t === 'inlineStr') cell = { s: kids(c, 't').map((x) => x.textContent ?? '').join('') };
      else if (t === 'str' && v !== null) cell = { s: v };
      else if (t === 'b' && v !== null) cell = { n: Number(v) };
      else if (t === 'e') cell = null;
      else if (v !== null && v !== '') {
        const n = Number(v);
        const kind = xfKinds[Number(c.getAttribute('s') ?? 0)] ?? null;
        if (!Number.isFinite(n)) cell = { s: v };
        else if (kind === 'time') cell = { n: Math.round((n % 1) * 86400 * 1000) / 1000, kind };
        else if (kind) cell = { n: serialToPspp(n + offset1904), kind };
        else cell = { n };
      }
      out[col] = cell;
      col++;
    }
    rowNo++;
  }
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  for (const r of grid) for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = null;
  return { ...gridToDataset(grid, name, { header: opts.header }), sheets: sheets.map((s) => s.name) };
}

// ------------------------------------------------------------------ write

const x = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Style ids in styles.xml below. */
const ST = { normal: 0, head: 1, date: 2, datetime: 3, time: 4, wrap: 5 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="[h]:mm:ss"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EFEA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8F8B83"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

type OutCell = { n: number; s?: number } | { t: string; s?: number } | null;

function sheetXml(rows: OutCell[][], widths: number[], freeze: boolean): string {
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((c, ci) => {
          if (c === null) return '';
          const ref = `${colName(ci)}${ri + 1}`;
          const s = c.s ? ` s="${c.s}"` : '';
          if ('n' in c) return Number.isFinite(c.n) ? `<c r="${ref}"${s}><v>${c.n}</v></c>` : '';
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${x(c.t)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const pane = freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const last = rows.length && widths.length ? `${colName(widths.length - 1)}${rows.length}` : 'A1';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${last}"/>${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${freeze && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}

export interface DictionaryLabels {
  sheetData: string;
  sheetVars: string;
  cols: string[]; // name, label, type, format, measure, value labels, missing
  type: { numeric: string; string: string };
  measure: Record<string, string>;
}

function describeMissing(v: Variable): string {
  const parts = v.missing.values.map(String);
  if (v.missing.range) parts.unshift(`${v.missing.range.low} – ${v.missing.range.high}`);
  return parts.join('; ');
}

/** Rows of the variable dictionary: name, label, type, format, measure, value labels, missing values. */
export function dictionaryRows(ds: Dataset, L: DictionaryLabels): string[][] {
  return ds.variables.map((v) => [
    v.name,
    v.label,
    L.type[v.type],
    formatSpec(v.print),
    L.measure[v.measure] ?? v.measure,
    v.valueLabels.map((l) => `${typeof l.value === 'string' ? l.value.trimEnd() : l.value} = ${l.label}`).join('; '),
    describeMissing(v),
  ]);
}

export function datasetToXlsx(ds: Dataset, L: DictionaryLabels, opts: { labels?: boolean } = {}): Uint8Array {
  const n = Math.max(0, ...ds.columns.map((c) => c.length));
  const rows: OutCell[][] = [ds.variables.map((v) => ({ t: v.name, s: ST.head }))];
  const kinds = ds.variables.map((v) => (v.type === 'numeric' ? dateKind(v.print.type) : null));
  const widths = ds.variables.map((v, i) => Math.max(8, Math.min(40, v.name.length + 3, kinds[i] === 'datetime' ? 20 : kinds[i] === 'date' ? 12 : 99)));
  for (let r = 0; r < n; r++) {
    rows.push(
      ds.variables.map((v, i) => {
        const c = ds.columns[i][r] ?? null;
        if (c === null) return null;
        if (opts.labels) {
          const l = labelOf(v, c);
          if (l !== undefined) {
            widths[i] = Math.min(40, Math.max(widths[i], l.length + 2));
            return { t: l };
          }
        }
        if (typeof c === 'string') {
          const s = c.trimEnd();
          widths[i] = Math.min(40, Math.max(widths[i], s.length + 2));
          return s === '' ? null : { t: s };
        }
        const k = kinds[i];
        if (k === 'date') return { n: psppToSerial(c), s: ST.date };
        if (k === 'datetime') return { n: psppToSerial(c), s: ST.datetime };
        if (k === 'time') return { n: c / 86400, s: ST.time };
        return { n: c };
      }),
    );
  }
  const dict: OutCell[][] = [L.cols.map((t) => ({ t, s: ST.head })), ...dictionaryRows(ds, L).map((r) => r.map((t, i) => (t ? { t, s: i === 5 ? ST.wrap : 0 } : null)))];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(ds.fileLabel || ds.name)}</dc:title><dc:creator>PSPP Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
    ),
    'docProps/app.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PSPP Studio</Application></Properties>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${x(L.sheetData.slice(0, 31))}" sheetId="1" r:id="rId1"/><sheet name="${x(L.sheetVars.slice(0, 31))}" sheetId="2" r:id="rId2"/></sheets>${rows.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${x(L.sheetData.slice(0, 31))}'!$A$1:$${colName(Math.max(0, ds.variables.length - 1))}$${rows.length}</definedName></definedNames>` : ''}</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(rows, widths, true)),
    'xl/worksheets/sheet2.xml': strToU8(sheetXml(dict, [14, 32, 10, 10, 12, 50, 16], true)),
  };
  return zipSync(files, { level: 6 });
}
