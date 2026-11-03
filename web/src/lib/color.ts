/*
 * Color helpers for deriving accessible accent palettes.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [26, 115, 232];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Moves `color` towards `target` until it reaches `ratio` contrast against `bg`. */
export function ensureContrast(color: string, bg: string, ratio: number, target: string): string {
  let c = color;
  for (let i = 0; i <= 20 && contrast(c, bg) < ratio; i++) c = mix(color, target, i / 20);
  return c;
}

export interface AccentPalette {
  primary: string;
  onPrimary: string;
  container: string;
  onContainer: string;
  soft: string;
}

export function accentPalette(accent: string, dark: boolean): AccentPalette {
  if (!dark) {
    const primary = ensureContrast(accent, '#ffffff', 4.6, '#000000');
    const container = mix(accent, '#ffffff', 0.84);
    return {
      primary,
      onPrimary: contrast('#ffffff', primary) >= 4.5 ? '#ffffff' : '#000000',
      container,
      onContainer: ensureContrast(mix(accent, '#000000', 0.6), container, 7, '#000000'),
      soft: mix(accent, '#ffffff', 0.92),
    };
  }
  const bg = '#1e1f20';
  const primary = ensureContrast(mix(accent, '#ffffff', 0.45), bg, 6, '#ffffff');
  const container = mix(accent, '#131314', 0.6);
  return {
    primary,
    onPrimary: ensureContrast(mix(accent, '#000000', 0.7), primary, 7, '#000000'),
    container,
    onContainer: ensureContrast(mix(accent, '#ffffff', 0.85), container, 7, '#ffffff'),
    soft: mix(accent, '#131314', 0.82),
  };
}
