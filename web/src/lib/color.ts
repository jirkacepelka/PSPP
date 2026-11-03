/*
 * Color helpers for deriving accessible accent palettes ("Calm Workspace" design system).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The accent is user-configurable. accentPalette() turns any hex into the five runtime
 * tokens app/theme.ts writes on <html> (--primary, --on-primary, --primary-container,
 * --on-primary-container, --primary-soft), guaranteeing WCAG AA on the warm "paper" and
 * "graphite" surfaces. Calm style: the container/soft tones are faint washes, not tonal fills.
 */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n) || h.length < 6) return [15, 123, 95];
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
  for (let i = 0; i <= 40 && contrast(c, bg) < ratio; i++) c = mix(color, target, i / 40);
  return c;
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Surfaces the accent must work on (keep in sync with src/styles/tokens.css). */
export const SURFACES = {
  light: { canvas: '#f9f8f5', surface: '#ffffff', sunken: '#f4f3ef', ink: '#1f1e1b' },
  dark: { canvas: '#191816', surface: '#201f1c', sunken: '#1c1b19', ink: '#eceae4' },
} as const;

export interface AccentPreset {
  id: string;
  /** Czech / English display names (settings UI picks by language). */
  name: { cs: string; en: string };
  light: string;
  dark: string;
}

/** Accent presets tuned for the calm palette. All pass AA in both themes (see color.test.ts). */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'emerald', name: { cs: 'Smaragd', en: 'Emerald' }, light: '#0f7b5f', dark: '#34c79a' },
  { id: 'teal', name: { cs: 'Modrozelená', en: 'Teal' }, light: '#0e6e80', dark: '#4fc3d6' },
  { id: 'indigo', name: { cs: 'Indigo', en: 'Indigo' }, light: '#4a55b0', dark: '#9aa3f0' },
  { id: 'plum', name: { cs: 'Švestka', en: 'Plum' }, light: '#86497a', dark: '#dc9ccd' },
  { id: 'ochre', name: { cs: 'Okr', en: 'Ochre' }, light: '#93600c', dark: '#e2b15a' },
  { id: 'slate', name: { cs: 'Břidlice', en: 'Slate' }, light: '#4d5966', dark: '#a9b6c4' },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].light;

/** Hex values the store may hold that the presets list stores as their light variant. */
export const ACCENT_PRESET_HEXES = ACCENT_PRESETS.map((p) => p.light);

/**
 * Old Material-era defaults → new default. The settings store still ships '#1a73e8'
 * as its default accent; until it imports ACCENT_PRESETS from here, untouched installs
 * (and saved settings holding the old default) get the new emerald default.
 */
const LEGACY_DEFAULTS = new Set(['#1a73e8']);

export function normalizeAccent(accent: string | undefined | null): string {
  const a = (accent ?? '').trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(a)) return DEFAULT_ACCENT;
  if (LEGACY_DEFAULTS.has(a)) return DEFAULT_ACCENT;
  return a.length === 4 ? rgbToHex(hexToRgb(a)) : a;
}

export function findPreset(accent: string): AccentPreset | undefined {
  const a = normalizeAccent(accent);
  return ACCENT_PRESETS.find((p) => p.light === a || p.dark === a);
}

export interface AccentPalette {
  /** solid accent: primary buttons, focus ring, active indicators */
  primary: string;
  /** text/icons on a solid accent fill */
  onPrimary: string;
  /** faint selected wash (calm: ~10% tint) */
  container: string;
  /** accent-coloured text/icons on surfaces and on `container` (links, active tab icon) */
  onContainer: string;
  /** the faintest wash: drop targets, current line */
  soft: string;
  /** hover / pressed shades of `primary` */
  hover: string;
  pressed: string;
}

/** Light-theme accent derived from any user hex. */
function lightPrimary(accent: string): string {
  // must reach AA (4.5:1) on both the white work surface and the warm canvas
  const { canvas } = SURFACES.light;
  return ensureContrast(accent, canvas, 4.6, '#000000');
}

/** Dark-theme accent: lift lightness in HSL (keeps hue and most chroma, unlike mixing with white). */
function darkPrimary(accent: string): string {
  const { surface } = SURFACES.dark;
  const [h, s, l] = rgbToHsl(hexToRgb(accent));
  let L = Math.max(l, 0.45);
  const S = Math.min(s, 0.62);
  let c = hslToHex(h, S, L);
  while (contrast(c, surface) < 6 && L < 0.92) {
    L += 0.02;
    c = hslToHex(h, S, L);
  }
  return c;
}

export function accentPalette(accent: string, dark: boolean): AccentPalette {
  const a = normalizeAccent(accent);
  const preset = findPreset(a);
  if (!dark) {
    const { surface, ink } = SURFACES.light;
    const primary = lightPrimary(preset ? preset.light : a);
    const onPrimary = contrast('#ffffff', primary) >= 4.5 ? '#ffffff' : '#12110f';
    const container = mix(surface, primary, 0.1);
    const onContainer = ensureContrast(mix(primary, '#000000', 0.22), container, 6, '#000000');
    return {
      primary,
      onPrimary,
      container,
      onContainer,
      soft: mix(surface, primary, 0.055),
      hover: mix(primary, ink, 0.14),
      pressed: mix(primary, ink, 0.24),
    };
  }
  const { surface, ink } = SURFACES.dark;
  const primary = preset ? preset.dark : darkPrimary(a);
  const onPrimary = ensureContrast(mix(primary, '#000000', 0.82), primary, 7, '#000000');
  const container = mix(surface, primary, 0.15);
  const onContainer = ensureContrast(mix(primary, '#ffffff', 0.55), container, 7, '#ffffff');
  return {
    primary,
    onPrimary,
    container,
    onContainer,
    soft: mix(surface, primary, 0.09),
    hover: mix(primary, ink, 0.14),
    pressed: mix(primary, ink, 0.24),
  };
}

/** CSS custom properties for an accent, ready for `style.setProperty`. */
export function accentTokens(accent: string, dark: boolean): Record<string, string> {
  const p = accentPalette(accent, dark);
  return {
    '--primary': p.primary,
    '--on-primary': p.onPrimary,
    '--primary-container': p.container,
    '--on-primary-container': p.onContainer,
    '--primary-soft': p.soft,
  };
}

/** Writes accent tokens on an element (default: <html>). */
export function applyAccent(accent: string, dark: boolean, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(accentTokens(accent, dark))) el.style.setProperty(k, v);
}

export interface AccentCheck {
  /** contrast of the solid accent against the canvas */
  accentOnCanvas: number;
  /** contrast of text on the solid accent */
  textOnAccent: number;
  /** contrast of accent-coloured text on the selected wash */
  textOnTint: number;
  /** true when every pair reaches WCAG AA (4.5:1) */
  passesAA: boolean;
}

/** Reports the contrast the generated palette achieves (for a settings hint or tests). */
export function checkAccent(accent: string, dark: boolean): AccentCheck {
  const p = accentPalette(accent, dark);
  const s = dark ? SURFACES.dark : SURFACES.light;
  const accentOnCanvas = contrast(p.primary, s.canvas);
  const textOnAccent = contrast(p.onPrimary, p.primary);
  const textOnTint = contrast(p.onContainer, p.container);
  return { accentOnCanvas, textOnAccent, textOnTint, passesAA: accentOnCanvas >= 4.5 && textOnAccent >= 4.5 && textOnTint >= 4.5 };
}
