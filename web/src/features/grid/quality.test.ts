/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { makeVariable } from '../../lib/variables';
import { cellChecker, columnQuality } from './quality';

const labels = [
  { value: 1, label: 'Very dissatisfied' },
  { value: 2, label: 'Dissatisfied' },
  { value: 3, label: 'Neutral' },
  { value: 9, label: 'No answer' },
];

describe('data-quality flags', () => {
  it('flags unlabelled codes in labelled categorical variables', () => {
    const v = makeVariable('satisf', { measure: 'ordinal', valueLabels: labels, missing: { values: [9] } });
    const check = cellChecker(v);
    expect(check(1)).toBeNull();
    expect(check(7)).toBe('noLabel');
    expect(check(null)).toBeNull();
    expect(check(9)).toBeNull();
  });
  it('ignores scale variables without a range and single-label variables', () => {
    expect(cellChecker(makeVariable('x', { valueLabels: labels }))(7)).toBeNull();
    expect(cellChecker(makeVariable('y', { measure: 'nominal', valueLabels: [labels[0]] }))(7)).toBeNull();
  });
  it('flags values outside the valid range', () => {
    const v = makeVariable('age', { validRange: { min: 15, max: 99 }, missing: { values: [999] } });
    const check = cellChecker(v);
    expect(check(14)).toBe('outOfRange');
    expect(check(40)).toBeNull();
    expect(check(999)).toBeNull();
  });
  it('flags suspicious strings', () => {
    const v = makeVariable('city', { type: 'string', width: 10, measure: 'nominal', valueLabels: [{ value: 'PRG', label: 'Praha' }, { value: 'BRN', label: 'Brno' }] });
    const check = cellChecker(v);
    expect(check('PRG   ')).toBeNull();
    expect(check(' PRG')).toBe('whitespace');
    expect(check('prg')).toBe('caseVariant');
    expect(check('OVA')).toBe('noLabel');
    expect(check('')).toBeNull();
  });
  it('summarises a column', () => {
    const v = makeVariable('satisf', { measure: 'ordinal', valueLabels: labels });
    const q = columnQuality(v, [1, 7, 7, 8, null, 2]);
    expect(q.total).toBe(3);
    expect(q.byKind).toEqual({ noLabel: 3 });
    expect(q.examples).toEqual([7, 8]);
    expect(q.rows).toEqual([1, 2, 3]);
  });
});
