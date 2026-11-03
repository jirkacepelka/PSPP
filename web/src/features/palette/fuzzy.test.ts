/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { editDistance, norm, score } from './fuzzy';

describe('palette fuzzy matching', () => {
  it('ignores diacritics and case', () => {
    expect(norm('Četnosti ŽLUŤOUČKÝ')).toBe('cetnosti zlutoucky');
    expect(score('cetnosti', { label: 'Četnosti…', keywords: '' })).toBeGreaterThan(0);
    expect(score('ČETN', { label: 'Četnosti…', keywords: '' })).toBeGreaterThan(0);
  });
  it('matches prefixes, abbreviations and squashed words', () => {
    expect(score('korel', { label: 'Korelace', keywords: '' })).toBeGreaterThan(0);
    expect(score('ttest', { label: 'T-test pro nezávislé výběry', keywords: '' })).toBeGreaterThan(0);
  });
  it('tolerates one typo in longer words', () => {
    expect(editDistance('korelace', 'korelance')).toBe(1);
    expect(score('korelance', { label: 'Korelace', keywords: '' })).toBeGreaterThan(0);
    expect(score('xyz', { label: 'Korelace', keywords: '' })).toBe(0);
  });
  it('requires every word and ranks label matches above keyword matches', () => {
    const a = score('popisne', { label: 'Popisné statistiky', keywords: '' });
    const b = score('popisne', { label: 'Explorace', keywords: 'popisne' });
    expect(a).toBeGreaterThan(b);
    expect(score('porovnat skupiny', { label: 'Průvodce', keywords: 'porovnat skupiny rozdíl' })).toBeGreaterThan(0);
    expect(score('porovnat zebra', { label: 'Průvodce', keywords: 'porovnat skupiny' })).toBe(0);
  });
});
