/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { formatNumber, parseCell, parseDate, parseNumber, formatCell, formatStat, labelIndex, labelValueText, valueLabelFor } from './format';
import { makeVariable } from './variables';

describe('format', () => {
  it('formats numeric formats', () => {
    expect(formatNumber(1234.567, { type: 'F', w: 8, d: 2 })).toBe('1234.57');
    expect(formatNumber(1234.567, { type: 'F', w: 8, d: 2 }, { decimalSeparator: ',' })).toBe('1234,57');
    expect(formatNumber(1234567.891, { type: 'COMMA', w: 12, d: 1 })).toBe('1,234,567.9');
    expect(formatNumber(1234567.891, { type: 'DOT', w: 12, d: 1 })).toBe('1.234.567,9');
    expect(formatNumber(-1500, { type: 'DOLLAR', w: 9, d: 0 })).toBe('-$1,500');
    expect(formatNumber(12345, { type: 'E', w: 10, d: 2 })).toBe('1.23E+04');
    expect(formatNumber(42, { type: 'N', w: 5, d: 0 })).toBe('00042');
  });
  it('round-trips dates', () => {
    for (const [fmt, text] of [['DATE', '15-JUL-2024'], ['ADATE', '07/15/2024'], ['EDATE', '15.07.2024'], ['SDATE', '2024/07/15']] as const) {
      const v = parseDate(text, fmt);
      expect(v).not.toBeNull();
      expect(formatNumber(v!, { type: fmt, w: 11, d: 0 })).toBe(text);
    }
    const dt = parseDate('2024-07-15 13:45:10', 'YMDHMS');
    expect(formatNumber(dt!, { type: 'YMDHMS', w: 19, d: 0 })).toBe('2024-07-15 13:45:10');
    expect(formatNumber(3725, { type: 'TIME', w: 8, d: 0 })).toBe('01:02:05');
  });
  it('parses user input', () => {
    expect(parseNumber('1,5', { decimalSeparator: ',' })).toBe(1.5);
    expect(parseNumber('1.234,5', { decimalSeparator: ',' })).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('abc')).toBeNull();
    const v = makeVariable('g', { valueLabels: [{ value: 1, label: 'Female' }] });
    expect(parseCell('female', v)).toEqual({ ok: true, value: 1 });
    expect(parseCell('', v)).toEqual({ ok: true, value: null });
    expect(formatCell(1, v, { valueLabels: true })).toBe('Female');
    const s = makeVariable('s', { type: 'string', width: 3 });
    expect(parseCell('abcdef', s)).toEqual({ ok: true, value: 'abc' });
  });
});

describe('value-label helpers', () => {
  it('looks labels up by code, trimming padded strings', () => {
    const v = makeVariable('g', { valueLabels: [{ value: 1, label: 'Female' }, { value: 2, label: 'Male' }] });
    expect(valueLabelFor(2, v)).toBe('Male');
    expect(valueLabelFor(3, v)).toBeUndefined();
    expect(valueLabelFor(null, v)).toBeUndefined();
    const s = makeVariable('c', { type: 'string', width: 4, valueLabels: [{ value: 'A', label: 'Alpha' }] });
    expect(valueLabelFor('A   ', s)).toBe('Alpha');
    expect(labelIndex(s)).toBe(labelIndex(s)); // cached
  });
  it('maps typed label text to the code for string variables', () => {
    const s = makeVariable('c', { type: 'string', width: 4, valueLabels: [{ value: 'A', label: 'Alpha' }] });
    expect(parseCell('alpha', s)).toEqual({ ok: true, value: 'A' });
    expect(parseCell('B', s)).toEqual({ ok: true, value: 'B' });
  });
  it('formats codes and statistics', () => {
    const v = makeVariable('x');
    expect(labelValueText(1.5, v, { decimalSeparator: ',' })).toBe('1,5');
    expect(formatStat(2.345, 2, { decimalSeparator: ',' })).toBe('2,35');
    expect(formatStat(null)).toBe('–');
    expect(formatStat(-0.0000000000001, 1)).toBe('0.0');
  });
});
