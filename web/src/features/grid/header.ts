/*
 * Column header renderer for the Data View (DV-3, F3, DV-8): measurement-level glyph in its
 * level colour, the variable name, the variable label as a muted second line, a menu chevron on
 * hover, and a single quiet "+ new variable" affordance after the last variable.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DrawHeaderCallback } from '@glideapps/glide-data-grid';
import type { GridPalette, MeasureKey } from './gridTheme';
import { drawIcon, fitText } from './canvas';

export type HeaderInfo =
  | { kind: 'var'; name: string; label: string; measure: MeasureKey; icon: string }
  | { kind: 'add'; text: string }
  | { kind: 'blank' };

export function makeDrawHeader(getInfo: (col: number) => HeaderInfo, getPalette: () => GridPalette, getZoom: () => number, showLabels: () => boolean): DrawHeaderCallback {
  return (args) => {
    const { ctx, rect, columnIndex, isSelected, isHovered, hasSelectedCell, menuBounds, theme } = args;
    const pal = getPalette();
    const z = getZoom();
    const info = getInfo(columnIndex);
    const bg = isSelected ? pal.accentTintStrong : hasSelectedCell ? pal.accentTint : isHovered ? pal.hover : pal.sunken;
    ctx.fillStyle = bg;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (isSelected) {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2);
    }
    const pad = Math.round(10 * z);
    const cy = rect.y + rect.height / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (info.kind === 'blank') return;
    if (info.kind === 'add') {
      ctx.font = `500 ${Math.round(12 * z)}px ${theme.fontFamily}`;
      ctx.fillStyle = isHovered ? pal.accentText : pal.ink3;
      const iw = drawIcon(ctx, 'add', rect.x + pad - 2, cy, Math.round(16 * z), isHovered ? pal.accentText : pal.ink3);
      ctx.fillText(fitText(ctx, info.text, rect.width - 2 * pad - iw), rect.x + pad + iw + 2, cy + 0.5);
      return;
    }
    const iconSize = Math.round(16 * z);
    const menuW = isHovered || isSelected ? Math.round(20 * z) : 0;
    const textX = rect.x + pad + iconSize + Math.round(6 * z);
    const maxW = rect.x + rect.width - pad - menuW - textX;
    const twoLines = showLabels() && info.label !== '' && rect.height >= 38 * z;
    const nameY = twoLines ? rect.y + rect.height * 0.36 : cy;
    drawIcon(ctx, info.icon, rect.x + pad - 1, nameY, iconSize, pal.measure[info.measure]);
    ctx.font = `600 ${Math.round(12.5 * z)}px ${theme.fontFamily}`;
    ctx.fillStyle = pal.ink;
    ctx.fillText(fitText(ctx, info.name, maxW), textX, nameY + 0.5);
    if (twoLines) {
      ctx.font = `${Math.round(11.5 * z)}px ${theme.fontFamily}`;
      ctx.fillStyle = pal.ink3;
      ctx.fillText(fitText(ctx, info.label, rect.x + rect.width - pad - menuW - (rect.x + pad)), rect.x + pad, rect.y + rect.height * 0.7 + 0.5);
    }
    if (menuW) {
      const mx = menuBounds.x + (menuBounds.width - iconSize) / 2;
      drawIcon(ctx, 'expand_more', Math.min(mx, rect.x + rect.width - pad - iconSize + 4), nameY, iconSize, pal.ink3);
    }
  };
}
