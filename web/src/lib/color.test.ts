/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, DEFAULT_ACCENT, accentPalette, checkAccent, contrast, normalizeAccent, SURFACES } from './color';

describe('accent palette', () => {
  it('every preset passes WCAG AA in both themes', () => {
    for (const p of ACCENT_PRESETS) {
      for (const dark of [false, true]) {
        const c = checkAccent(p.light, dark);
        expect(c.passesAA, `${p.id} ${dark ? 'dark' : 'light'} ${JSON.stringify(c)}`).toBe(true);
      }
    }
  });

  it('keeps preset colours exact and uses the paired dark variant', () => {
    expect(accentPalette('#0f7b5f', false).primary).toBe('#0f7b5f');
    expect(accentPalette('#0f7b5f', true).primary).toBe('#34c79a');
  });

  it('fixes low-contrast custom accents', () => {
    for (const hex of ['#ffeb3b', '#a0e0ff', '#222222', '#ff00ff', '#777']) {
      for (const dark of [false, true]) expect(checkAccent(hex, dark).passesAA, `${hex} ${dark}`).toBe(true);
    }
    expect(contrast(accentPalette('#ffeb3b', false).primary, SURFACES.light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('migrates the old default and rejects junk', () => {
    expect(normalizeAccent('#1a73e8')).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent('nonsense')).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent('#ABC')).toBe('#aabbcc');
    expect(accentPalette('#1A73E8', false).primary).toBe('#0f7b5f');
  });
});
