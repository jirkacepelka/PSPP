/*
 * Data files handled in the browser without the PSPP engine: delimited text (CSV, TSV, TXT),
 * Excel (.xlsx), OpenDocument (.ods) and PSPP Studio JSON. SPSS formats (.sav, .zsav, .por) go
 * through the engine (app/files.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset } from '../../engine/types';
import { datasetToDelimited, delimitedToDataset, detectDelimiter, guessDecimalComma, parseDelimited } from '../csv';
import { datasetFromJson, datasetToJson, decodeText, type TextEncoding } from './common';
import { odsToDataset, datasetToOds } from './ods';
import { datasetToXlsx, xlsxToDataset, type DictionaryLabels } from './xlsx';

export type { DictionaryLabels } from './xlsx';
export type { TextEncoding } from './common';

export type ImportKind = 'text' | 'xlsx' | 'ods' | 'json';

/** Which in-browser reader handles a file name, or null for the engine (SPSS formats, syntax). */
export function importKind(name: string): ImportKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (['csv', 'tsv', 'txt', 'dat', 'tab', 'prn'].includes(ext)) return 'text';
  if (['xlsx', 'xlsm'].includes(ext)) return 'xlsx';
  if (ext === 'ods') return 'ods';
  if (ext === 'json') return 'json';
  return null;
}

export interface ImportOptions {
  /** text: delimiter ('auto' detects it) */
  delimiter?: string;
  decimal?: 'auto' | 'dot' | 'comma';
  encoding?: TextEncoding;
  /** first row holds variable names; guessed when undefined */
  header?: boolean;
  /** spreadsheets: sheet index */
  sheet?: number;
}

export interface ImportResult {
  dataset: Dataset;
  /** spreadsheets: sheet names */
  sheets?: string[];
  /** text: what was used (for the import dialog) */
  detected?: { delimiter: string; decimalComma: boolean; encoding: string; header: boolean };
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export function readDataFile(name: string, bytes: Uint8Array, o: ImportOptions = {}): ImportResult {
  const kind = importKind(name);
  const title = baseName(name);
  switch (kind) {
    case 'text': {
      const { text, encoding } = decodeText(bytes, o.encoding ?? 'auto');
      const ext = name.toLowerCase().split('.').pop();
      const delimiter = !o.delimiter || o.delimiter === 'auto' ? (ext === 'tsv' || ext === 'tab' ? '\t' : detectDelimiter(text)) : o.delimiter;
      const sample = parseDelimited(text.slice(0, 200_000), delimiter);
      const decimalComma = o.decimal === 'comma' ? true : o.decimal === 'dot' ? false : guessDecimalComma(sample, delimiter);
      const dataset = delimitedToDataset(text, title, { delimiter, decimalComma, header: o.header });
      const header = o.header ?? !dataset.variables.every((v) => /^VAR\d{5}$/.test(v.name));
      return { dataset, detected: { delimiter, decimalComma, encoding, header } };
    }
    case 'xlsx': {
      const { sheets, ...dataset } = xlsxToDataset(bytes, title, { sheet: o.sheet, header: o.header });
      return { dataset, sheets };
    }
    case 'ods': {
      const { sheets, ...dataset } = odsToDataset(bytes, title, { sheet: o.sheet, header: o.header });
      return { dataset, sheets };
    }
    case 'json':
      return { dataset: datasetFromJson(decodeText(bytes, 'utf-8').text, title) };
    default:
      throw new Error(`Unsupported file: ${name}`);
  }
}

export type ClientFormat = 'csv' | 'tsv' | 'xlsx' | 'ods' | 'json';
export const CLIENT_FORMATS: ClientFormat[] = ['csv', 'tsv', 'xlsx', 'ods', 'json'];

export interface ExportOptions {
  /** write value labels instead of the codes */
  labels?: boolean;
  /** csv: ';' with decimal comma (Czech Excel) instead of ',' with a decimal point */
  semicolon?: boolean;
}

export const MIME: Record<ClientFormat, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  json: 'application/json',
};

const BOM = '﻿';

export function writeDataFile(ds: Dataset, format: ClientFormat, L: DictionaryLabels, o: ExportOptions = {}): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  switch (format) {
    // a byte-order mark makes Excel read UTF-8 (accents) correctly
    case 'csv':
      return enc(BOM + datasetToDelimited(ds, o.semicolon ? ';' : ',', !!o.labels, !!o.semicolon));
    case 'tsv':
      return enc(BOM + datasetToDelimited(ds, '\t', !!o.labels));
    case 'xlsx':
      return datasetToXlsx(ds, L, { labels: o.labels });
    case 'ods':
      return datasetToOds(ds, L, { labels: o.labels });
    case 'json':
      return enc(datasetToJson(ds));
  }
}
