/*
 * Small canvas helpers shared by the data and variable grids (text truncation with a
 * measurement cache, rounded tags, icon-font glyphs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const widthCache = new Map<string, Map<string, number>>();

/** ctx.measureText(...).width, cached per font (the grid redraws the same strings constantly). */
export function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let m = widthCache.get(ctx.font);
  if (!m) {
    m = new Map();
    widthCache.set(ctx.font, m);
  }
  let w = m.get(text);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    if (m.size > 20000) m.clear();
    m.set(text, w);
  }
  return w;
}

/** Truncates TEXT with an ellipsis to fit MAX px in the current ctx.font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (textWidth(ctx, text) <= max) return text;
  const ell = '…';
  const ew = textWidth(ctx, ell);
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(ctx, text.slice(0, mid)) + ew <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + ell : '';
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

let iconsReady: boolean | null = null;
/** Whether the Material Symbols font is loaded (canvas cannot fall back to ligature text). */
export function iconFontReady(): boolean {
  if (iconsReady) return true;
  try {
    iconsReady = document.fonts.check("16px 'Material Symbols Rounded'");
  } catch {
    iconsReady = false;
  }
  return iconsReady;
}

/** Draws an icon-font glyph (ligature NAME) centred vertically at (x, cy). Returns its width. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, cy: number, size: number, color: string): number {
  if (!iconFontReady()) return 0;
  ctx.save();
  ctx.font = `${size}px 'Material Symbols Rounded'`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(name, x, cy + 0.5);
  ctx.restore();
  return size;
}
