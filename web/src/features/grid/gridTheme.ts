/*
 * Builds the glide-data-grid theme (and a small palette for custom canvas drawing) from the
 * Calm Workspace design tokens. Re-evaluated when the theme, accent, density, zoom or grid
 * font change, and once the web fonts (Inter, Material Symbols) have loaded.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import type { Theme } from '@glideapps/glide-data-grid';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';

function cssVar(name: string, fallback = '#000'): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Mixes COLOR with transparency (works for any CSS colour via color-mix-free rgba parsing). */
function alpha(color: string, a: number): string {
  const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

export type MeasureKey = 'nominal' | 'ordinal' | 'scale' | 'string';

/** Colours used by the custom cell and header renderers (resolved token values). */
export interface GridPalette {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  lineStrong: string;
  surface: string;
  sunken: string;
  hover: string;
  canvas: string;
  accent: string;
  accentText: string;
  accentTint: string;
  accentTintStrong: string;
  warning: string;
  warningTint: string;
  danger: string;
  measure: Record<MeasureKey, string>;
  measureTint: Record<MeasureKey, string>;
}

export interface GridMetrics {
  theme: Partial<Theme>;
  palette: GridPalette;
  rowHeight: number;
  headerHeight: number;
  zoom: number;
  /** px font size of body cells */
  fontSize: number;
  fontFamily: string;
  /** legacy aliases */
  muted: string;
  error: string;
  charWidth: number;
  /** changes whenever anything visual changes; use as a memo key */
  key: number;
}

let fontsTick = 0;

export function useGridTheme(): GridMetrics {
  const [tick, setTick] = useState(0);
  const zoom = useUi((s) => s.zoom);
  const density = useSettings((s) => s.density);
  const font = useSettings((s) => s.gridFont);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('pspp-theme-changed', on);
    let alive = true;
    // icon glyphs and Inter metrics are only right after the fonts load
    void Promise.all([
      document.fonts?.load?.("20px 'Material Symbols Rounded'", 'category').catch(() => undefined),
      document.fonts?.load?.("13px 'Inter'").catch(() => undefined),
    ]).then(() => {
      if (!alive) return;
      fontsTick++;
      on();
    });
    return () => {
      alive = false;
      window.removeEventListener('pspp-theme-changed', on);
    };
  }, []);
  return useMemo(() => {
    void tick;
    const accent = cssVar('--accent', cssVar('--primary', '#0f7b5f'));
    const fs = Math.round(13 * zoom);
    const rowH = Math.round(parseFloat(cssVar('--grid-row-h', '30')) * zoom) || 30;
    const headH = Math.round((parseFloat(cssVar('--grid-header-h', '34')) + 10) * zoom) || 44;
    // "system" (the default) means the app's UI face, Inter
    const family = font === 'system' ? cssVar('--font-ui', 'Inter, system-ui, sans-serif') : cssVar('--font-grid', 'system-ui');
    const m = (k: MeasureKey) => cssVar(`--measure-${k}`, '#6b6862');
    const mt = (k: MeasureKey) => cssVar(`--measure-${k}-tint`, '#f1f0ec');
    const palette: GridPalette = {
      ink: cssVar('--ink', '#1f1e1b'),
      ink2: cssVar('--ink-2', '#4a4843'),
      ink3: cssVar('--ink-3', '#6b6862'),
      line: cssVar('--line', '#e7e5df'),
      lineStrong: cssVar('--line-strong', '#d9d6ce'),
      surface: cssVar('--surface', '#fff'),
      sunken: cssVar('--surface-sunken', '#f4f3ef'),
      hover: cssVar('--surface-hover', '#f1f0ec'),
      canvas: cssVar('--canvas', '#f9f8f5'),
      accent,
      accentText: cssVar('--accent-text', accent),
      accentTint: cssVar('--accent-tint', alpha(accent, 0.06)),
      accentTintStrong: cssVar('--accent-tint-strong', alpha(accent, 0.12)),
      warning: cssVar('--warning', '#8a5a00'),
      warningTint: cssVar('--warning-tint', '#fbf3e2'),
      danger: cssVar('--danger', '#b3412e'),
      measure: { nominal: m('nominal'), ordinal: m('ordinal'), scale: m('scale'), string: m('string') },
      measureTint: { nominal: mt('nominal'), ordinal: mt('ordinal'), scale: mt('scale'), string: mt('string') },
    };
    const theme: Partial<Theme> = {
      accentColor: accent,
      accentFg: cssVar('--accent-ink', '#fff'),
      accentLight: alpha(accent, 0.1),
      textDark: palette.ink,
      textMedium: palette.ink2,
      textLight: palette.ink3,
      textBubble: palette.ink,
      bgIconHeader: palette.ink3,
      fgIconHeader: palette.sunken,
      textHeader: palette.ink2,
      textGroupHeader: palette.ink3,
      textHeaderSelected: palette.ink,
      bgCell: palette.surface,
      bgCellMedium: palette.sunken,
      bgHeader: palette.sunken,
      bgHeaderHasFocus: palette.accentTint,
      bgHeaderHovered: palette.hover,
      bgBubble: palette.hover,
      bgBubbleSelected: palette.surface,
      bgSearchResult: alpha(palette.warning, 0.22),
      borderColor: palette.line,
      horizontalBorderColor: palette.line,
      headerBottomBorderColor: palette.lineStrong,
      drilldownBorder: palette.lineStrong,
      linkColor: palette.accentText,
      cellHorizontalPadding: Math.round(10 * zoom),
      cellVerticalPadding: 3,
      headerFontStyle: `600 ${Math.round(12.5 * zoom)}px`,
      headerIconSize: Math.round(18 * zoom),
      baseFontStyle: `${fs}px`,
      markerFontStyle: `${Math.round(11 * zoom)}px`,
      fontFamily: family,
      editorFontSize: `${fs}px`,
      lineHeight: 1.4,
      resizeIndicatorColor: accent,
      roundingRadius: 4,
    };
    return {
      theme,
      palette,
      rowHeight: rowH,
      headerHeight: headH,
      zoom,
      fontSize: fs,
      fontFamily: family,
      muted: palette.ink3,
      error: palette.danger,
      charWidth: 7.5 * zoom,
      key: tick * 1000 + fontsTick,
    };
  }, [tick, zoom, density, font]);
}
