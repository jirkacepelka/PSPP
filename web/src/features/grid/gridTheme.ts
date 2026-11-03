/*
 * Builds a glide-data-grid theme from the app's CSS custom properties.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import type { Theme } from '@glideapps/glide-data-grid';
import { hexToRgb } from '../../lib/color';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';

function cssVar(name: string, fallback = '#000'): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function alpha(color: string, a: number): string {
  if (color.startsWith('#')) {
    const [r, g, b] = hexToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

export interface GridMetrics {
  theme: Partial<Theme>;
  rowHeight: number;
  headerHeight: number;
  zoom: number;
  muted: string;
  error: string;
  charWidth: number;
}

export function useGridTheme(): GridMetrics {
  const [tick, setTick] = useState(0);
  const zoom = useUi((s) => s.zoom);
  const density = useSettings((s) => s.density);
  const font = useSettings((s) => s.gridFont);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('pspp-theme-changed', on);
    return () => window.removeEventListener('pspp-theme-changed', on);
  }, []);
  return useMemo(() => {
    void tick;
    void font;
    const primary = cssVar('--primary', '#1a73e8');
    const fs = Math.round(13 * zoom);
    const rowH = Math.round(parseFloat(cssVar('--grid-row-h', '30')) * zoom) || 30;
    const headH = Math.round(parseFloat(cssVar('--grid-header-h', '34')) * zoom) || 34;
    const family = cssVar('--font-grid', 'system-ui');
    const theme: Partial<Theme> = {
      accentColor: primary,
      accentFg: cssVar('--on-primary', '#fff'),
      accentLight: alpha(primary, 0.14),
      textDark: cssVar('--on-surface'),
      textMedium: cssVar('--on-surface-variant'),
      textLight: cssVar('--on-surface-muted', '#888'),
      textBubble: cssVar('--on-surface'),
      bgIconHeader: cssVar('--on-surface-variant'),
      fgIconHeader: cssVar('--grid-header-bg'),
      textHeader: cssVar('--grid-header-text'),
      textHeaderSelected: cssVar('--on-primary', '#fff'),
      bgCell: cssVar('--surface', '#fff'),
      bgCellMedium: cssVar('--surface-container-low'),
      bgHeader: cssVar('--grid-header-bg'),
      bgHeaderHasFocus: cssVar('--surface-container-high'),
      bgHeaderHovered: cssVar('--surface-container'),
      bgBubble: cssVar('--surface-container'),
      bgBubbleSelected: cssVar('--surface'),
      bgSearchResult: alpha(cssVar('--warning', '#fbbc04'), 0.3),
      borderColor: cssVar('--grid-line'),
      horizontalBorderColor: cssVar('--grid-line'),
      headerBottomBorderColor: cssVar('--outline-variant'),
      drilldownBorder: cssVar('--outline-variant'),
      linkColor: primary,
      cellHorizontalPadding: 8,
      cellVerticalPadding: 3,
      headerFontStyle: `500 ${Math.round(12.5 * zoom)}px`,
      headerIconSize: Math.round(18 * zoom),
      baseFontStyle: `${fs}px`,
      markerFontStyle: `${Math.round(11.5 * zoom)}px`,
      fontFamily: family,
      editorFontSize: `${fs}px`,
      lineHeight: 1.4,
      resizeIndicatorColor: primary,
    };
    return { theme, rowHeight: rowH, headerHeight: headH, zoom, muted: cssVar('--on-surface-muted'), error: cssVar('--error'), charWidth: 7.5 * zoom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, zoom, density, font]);
}
