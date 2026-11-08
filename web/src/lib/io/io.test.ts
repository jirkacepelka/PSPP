/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
// @ts-expect-error jsdom ships no type declarations here
import { JSDOM } from 'jsdom';
// node environment (fflate checks `instanceof Uint8Array`, which jsdom's realm breaks) plus a DOMParser
(globalThis as { DOMParser?: unknown }).DOMParser ??= new JSDOM('').window.DOMParser;
import { unzipSync, strFromU8 } from 'fflate';
import type { Dataset } from '../../engine/types';
import { makeVariable } from '../variables';
import { parseDate } from '../format';
import { readDataFile, writeDataFile, importKind, type DictionaryLabels } from './index';
import { formatCodeKind } from './xlsx';

const L: DictionaryLabels = {
  sheetData: 'Data',
  sheetVars: 'Variables',
  cols: ['Name', 'Label', 'Type', 'Format', 'Measure', 'Value labels', 'Missing'],
  type: { numeric: 'Numeric', string: 'String' },
  measure: { nominal: 'Nominal', ordinal: 'Ordinal', scale: 'Scale', unknown: '' },
};

const d = (s: string) => parseDate(s, 'SDATE')!;
const sample = (): Dataset => ({
  name: 'test',
  variables: [
    makeVariable('id', { print: { type: 'F', w: 4, d: 0 }, write: { type: 'F', w: 4, d: 0 } }),
    makeVariable('pohlavi', { label: 'Pohlaví', valueLabels: [{ value: 1, label: 'muž' }, { value: 2, label: 'žena' }], measure: 'nominal' }),
    makeVariable('skore', { print: { type: 'F', w: 8, d: 2 }, write: { type: 'F', w: 8, d: 2 } }),
    makeVariable('jmeno', { type: 'string', width: 12 }),
    makeVariable('datum', { print: { type: 'EDATE', w: 10, d: 0 }, write: { type: 'EDATE', w: 10, d: 0 } }),
  ],
  columns: [
    [1, 2, 3],
    [1, 2, null],
    [3.25, -1.5, 10],
    ['Řehoř & syn', 'Šárka <x>', ''],
    [d('2024/03/01'), d('1999/12/31'), null],
  ],
  weight: null,
  filter: null,
  split: [],
  documents: [],
});

describe('importKind', () => {
  it('routes file names', () => {
    expect(importKind('a.CSV')).toBe('text');
    expect(importKind('a.xlsx')).toBe('xlsx');
    expect(importKind('a.ods')).toBe('ods');
    expect(importKind('a.json')).toBe('json');
    expect(importKind('a.sav')).toBeNull();
  });
});

describe('xlsx', () => {
  it('round-trips values, strings and dates', () => {
    const bytes = writeDataFile(sample(), 'xlsx', L);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('xl/worksheets/sheet2.xml');
    expect(strFromU8(files['xl/worksheets/sheet2.xml'])).toContain('1 = muž; 2 = žena');
    const { dataset: ds, sheets } = readDataFile('t.xlsx', bytes);
    expect(sheets).toEqual(['Data', 'Variables']);
    expect(ds.variables.map((v) => v.name)).toEqual(['id', 'pohlavi', 'skore', 'jmeno', 'datum']);
    expect(ds.columns[0]).toEqual([1, 2, 3]);
    expect(ds.columns[1]).toEqual([1, 2, null]);
    expect(ds.columns[2]).toEqual([3.25, -1.5, 10]);
    expect(ds.variables[2].print.d).toBe(2);
    expect(ds.columns[3]).toEqual(['Řehoř & syn', 'Šárka <x>', '']);
    expect(ds.variables[4].print.type).toBe('EDATE');
    expect(ds.columns[4]).toEqual([d('2024/03/01'), d('1999/12/31'), null]);
  });
  it('writes labels instead of codes on request', () => {
    const { dataset: ds } = readDataFile('t.xlsx', writeDataFile(sample(), 'xlsx', L, { labels: true }));
    expect(ds.variables[1].type).toBe('string');
    expect(ds.columns[1]).toEqual(['muž', 'žena', '']);
  });
  it('recognises date number formats', () => {
    expect(formatCodeKind('d.m.yyyy')).toBe('date');
    expect(formatCodeKind('[$-405]d\\. mmmm yyyy')).toBe('date');
    expect(formatCodeKind('dd/mm/yyyy hh:mm')).toBe('datetime');
    expect(formatCodeKind('[h]:mm:ss')).toBe('time');
    expect(formatCodeKind('0.00')).toBeNull();
    expect(formatCodeKind('#,##0 "Kč"')).toBeNull();
    expect(formatCodeKind('[Red]0.0')).toBeNull();
  });
});

describe('ods', () => {
  it('round-trips and starts with an uncompressed mimetype', () => {
    const bytes = writeDataFile(sample(), 'ods', L);
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe('mimetype');
    const { dataset: ds, sheets } = readDataFile('t.ods', bytes);
    expect(sheets).toEqual(['Data', 'Variables']);
    expect(ds.columns[0]).toEqual([1, 2, 3]);
    expect(ds.columns[2]).toEqual([3.25, -1.5, 10]);
    expect(ds.columns[3]).toEqual(['Řehoř & syn', 'Šárka <x>', '']);
    expect(ds.columns[4]).toEqual([d('2024/03/01'), d('1999/12/31'), null]);
    expect(readDataFile('t.ods', bytes, { sheet: 1 }).dataset.columns[0]).toEqual(['id', 'pohlavi', 'skore', 'jmeno', 'datum']);
    expect(readDataFile('t.ods', bytes, { sheet: 1, header: false }).dataset.columns[0][0]).toBe('Name');
  });
});

describe('text', () => {
  it('reads Czech CSV in Windows-1250 with semicolons and decimal commas', () => {
    const text = 'jméno;výška;datum\r\nŽofie;1,72;01.03.2024\r\nŠimon;1,85;15.04.2023\r\n';
    const bytes = new Uint8Array([...text].map((ch) => ({ é: 0xe9, ý: 0xfd, Ž: 0x8e, Š: 0x8a, š: 0x9a })[ch] ?? ch.charCodeAt(0)));
    const r = readDataFile('cz.csv', bytes);
    expect(r.detected).toMatchObject({ delimiter: ';', decimalComma: true, encoding: 'windows-1250', header: true });
    expect(r.dataset.variables.map((v) => v.label || v.name)).toEqual(['jméno', 'výška', 'datum']);
    expect(r.dataset.columns[0]).toEqual(['Žofie', 'Šimon']);
    expect(r.dataset.columns[1]).toEqual([1.72, 1.85]);
    expect(r.dataset.variables[2].print.type).toBe('EDATE');
  });
  it('honours explicit options', () => {
    const r = readDataFile('x.txt', new TextEncoder().encode('1|2,5\n3|4,5\n'), { delimiter: '|', decimal: 'comma', header: false });
    expect(r.dataset.columns).toEqual([[1, 3], [2.5, 4.5]]);
  });
  it('writes CSV with a BOM, and semicolons with decimal commas on request', () => {
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(writeDataFile(sample(), 'csv', L, { semicolon: true, labels: true }));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[1]).toBe('1;muž;3,25;Řehoř & syn;01.03.2024');
    const back = readDataFile('b.csv', writeDataFile(sample(), 'csv', L));
    expect(back.dataset.columns[2]).toEqual([3.25, -1.5, 10]);
  });
  it('reads ISO date-times', () => {
    const r = readDataFile('t.csv', new TextEncoder().encode('t\n2024-01-05 10:30:00\n2024-01-06T08:00\n'));
    expect(r.dataset.variables[0].print.type).toBe('YMDHMS');
  });
});

describe('json', () => {
  it('round-trips the dataset', () => {
    const ds = sample();
    const back = readDataFile('a.json', writeDataFile(ds, 'json', L)).dataset;
    expect(back.columns).toEqual(ds.columns);
    expect(back.variables[1].valueLabels).toEqual(ds.variables[1].valueLabels);
  });
});
