/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { makeVariable } from '../../lib/variables';
import { conversionPreview, parseLabelPaste } from './labelTools';

describe('variable dialog helpers', () => {
  it('parses pasted label lists', () => {
    expect(parseLabelPaste('1\tFemale\n2\tMale\n')).toEqual([
      { value: '1', label: 'Female' },
      { value: '2', label: 'Male' },
    ]);
    expect(parseLabelPaste('1;Ano\n0;Ne')).toEqual([
      { value: '1', label: 'Ano' },
      { value: '0', label: 'Ne' },
    ]);
    expect(parseLabelPaste('1 Velmi spokojen\n2 Spokojen')).toEqual([
      { value: '1', label: 'Velmi spokojen' },
      { value: '2', label: 'Spokojen' },
    ]);
    expect(parseLabelPaste('just text')).toBeNull();
  });
  it('previews a string → numeric conversion', () => {
    const v = makeVariable('s', { type: 'string', width: 8 });
    const r = conversionPreview(v, ['1', '2,5', 'n/a', '', 'x'], 'numeric', { type: 'F', w: 8, d: 2 });
    expect(r).toEqual({ kept: 2, lost: 2, truncated: 0, example: 'n/a' });
    const t = conversionPreview(v, ['abcdef', 'ab'], 'string', { type: 'A', w: 3, d: 0 });
    expect(t.truncated).toBe(1);
  });
});
