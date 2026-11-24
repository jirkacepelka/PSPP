/* The style layer: ChartStyle (appearance overrides, see studioTypes.ts) reaches the shared plumbing
   in shell.tsx through React context, so every renderer gets titles, palette, grid, reference lines
   and annotations without code of its own.  SPDX-License-Identifier: GPL-3.0-or-later */

import { createContext, useContext, type ReactNode } from 'react';
import type { ChartStyle } from './studioTypes';
import { measureText, truncateText } from './scale';

export const StyleCtx = createContext<ChartStyle | undefined>(undefined);
export const useStyle = (): ChartStyle | undefined => useContext(StyleCtx);

/** Where the plot rectangle is and how data values map to pixels.  The axes (YAxis, XAxis, or a
    renderer with a categorical axis) fill it in while rendering; StyleOverlay reads it afterwards. */
export interface AxisReg {
  x?: (v: number) => number;
  y?: (v: number) => number;
  left?: number;
  width?: number;
  top?: number;
  height?: number;
  /** Pixel boxes of drawn value labels; annotations are placed clear of them. Reset by the shell on every render. */
  avoid?: Box[];
  /** width of the whole plot area (set by the shell): reference labels go outside the plot when the margin holds them */
  outerWidth?: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Register the box of a value label centred (anchor middle) or starting (anchor start) / ending (end) at x. */
export function avoidText(reg: AxisReg, x: number, baseline: number, width: number, size: number, anchor: 'start' | 'middle' | 'end' = 'middle'): void {
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'start' ? x : x - width;
  (reg.avoid ??= []).push({ x0, x1: x0 + width, y0: baseline - size, y1: baseline + 3 });
}

/** Widest label a horizontal reference line may print right of the plot (px). */
const REF_LABEL_MAX = 96;

/** Extra right margin that lets labelled horizontal reference lines print their label outside the plot. */
export function refLabelRoom(style?: ChartStyle): number {
  const labels = (style?.refLines ?? []).filter((l) => l.axis === 'y' && l.label);
  if (!labels.length) return 0;
  const fsz = 11 * (style?.fontScale ?? 1);
  return Math.ceil(Math.max(...labels.map((l) => measureText(truncateText(l.label!, REF_LABEL_MAX, fsz), fsz)))) + 8;
}

const NOOP_REG: AxisReg = {};
export const RegCtx = createContext<AxisReg>(NOOP_REG);
export const useAxisReg = (): AxisReg => useContext(RegCtx);

/** The title of an axis after the style override; undefined = none (hidden by showTitle: false). */
export function axisTitle(style: ChartStyle | undefined, which: 'x' | 'y' | 'z', fallback?: string): string | undefined {
  if (style?.showTitle === false) return undefined;
  const o = which === 'x' ? style?.xTitle : which === 'y' ? style?.yTitle : style?.zTitle;
  const s = o !== undefined ? o : fallback;
  return s ? s : undefined;
}

interface Placement {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  box: Box;
}

/** First free spot for an annotation label: four corners around the dot, then a second ring further out. */
function placeNote(o: { px: number; py: number; w: number; fsz: number; flip0: boolean; up0: boolean; left: number; right: number; taken: Box[]; dot: Box }): Placement | null {
  for (const ring of [0, 1]) {
    for (const dx of [o.flip0 ? -1 : 1, o.flip0 ? 1 : -1]) {
      for (const dy of [o.up0 ? -1 : 1, o.up0 ? 1 : -1]) {
        const x = o.px + dx * 7;
        const y = dy < 0 ? o.py - 7 - ring * (o.fsz + 6) : o.py + o.fsz + 4 + ring * (o.fsz + 6);
        const anchor = dx < 0 ? 'end' : 'start';
        const x0 = anchor === 'end' ? x - o.w : x;
        const box: Box = { x0, x1: x0 + o.w, y0: y - o.fsz, y1: y + 3 };
        if (box.x0 >= o.left - 2 && box.x1 <= o.right + 2 && !o.taken.some((b) => b !== o.dot && hit(b, box))) return { x, y, anchor, box };
      }
    }
  }
  return null;
}

/** Reference lines and annotations, drawn on top of the plot in plot coordinates. */
export function StyleOverlay({ reg, style, fs, uid }: { reg: AxisReg; style?: ChartStyle; fs: number; uid: string }): ReactNode {
  const lines = style?.refLines ?? [];
  const notes = style?.annotations ?? [];
  const { left, width, top, height } = reg;
  if ((!lines.length && !notes.length) || left === undefined || width === undefined || top === undefined || height === undefined) return null;
  const right = left + width;
  const bottom = top + height;
  const fsz = 11 * fs;
  const clipId = uid + '-sl';
  return (
    <g className="pspp-chart__style-layer">
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={top} width={width} height={height} />
        </clipPath>
      </defs>
      <g aria-hidden="true">
        {lines.map((l, i) => {
          const f = l.axis === 'x' ? reg.x : reg.y;
          if (!f) return null;
          const p = f(l.value);
          if (!isFinite(p)) return null;
          const color = l.color || 'var(--c-reference)';
          const dash = l.dash === false ? undefined : '6 4';
          if (l.axis === 'x') {
            if (p < left - 0.5 || p > right + 0.5) return null;
            const x = Math.round(p) + 0.5;
            const flip = x > right - 90;
            return (
              <g key={i}>
                <line className="pspp-chart__ref pspp-chart__ref--user" x1={x} x2={x} y1={top} y2={bottom} style={{ stroke: color, strokeDasharray: dash }} />
                {l.label && (
                  <text className="pspp-chart__note-text" x={flip ? x - 4 : x + 4} y={top + 10 + fsz / 2} textAnchor={flip ? 'end' : 'start'} style={{ fontSize: fsz }}>
                    {truncateText(l.label, 140, fsz)}
                  </text>
                )}
              </g>
            );
          }
          if (p < top - 0.5 || p > bottom + 0.5) return null;
          const y = Math.round(p) + 0.5;
          const lw = l.label ? measureText(truncateText(l.label, Math.max(60, width * 0.6), fsz), fsz) : 0;
          const outText = l.label ? truncateText(l.label, REF_LABEL_MAX, fsz) : '';
          const outside = !!l.label && reg.outerWidth !== undefined && right + 6 + measureText(outText, fsz) <= reg.outerWidth + 0.5;
          const labelBox = (ty: number): Box => ({ x0: right - 4 - lw, x1: right - 4, y0: ty - fsz, y1: ty + 3 });
          // above the line unless the room is short or a value label is there already
          const below = y < top + fsz + 6 || ((reg.avoid ?? []).some((b) => hit(b, labelBox(y - 5))) && !(reg.avoid ?? []).some((b) => hit(b, labelBox(y + fsz))));
          return (
            <g key={i}>
              <line className="pspp-chart__ref pspp-chart__ref--user" x1={left} x2={right} y1={y} y2={y} style={{ stroke: color, strokeDasharray: dash }} />
              {l.label && outside && (
                <text className="pspp-chart__note-text" x={right + 6} y={y} dominantBaseline="central" style={{ fontSize: fsz }}>
                  {outText}
                </text>
              )}
              {l.label && !outside && (
                <text className="pspp-chart__note-text" x={right - 4} y={below ? y + fsz : y - 5} textAnchor="end" style={{ fontSize: fsz }}>
                  {truncateText(l.label, Math.max(60, width * 0.6), fsz)}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g clipPath={`url(#${clipId})`} aria-hidden="true">
        {(() => {
          // Each label tries four corners around its dot, then a second ring further out; a label that
          // would cover a value label or an earlier annotation moves on, and when nothing is free only the dot stays.
          const taken: Box[] = [...(reg.avoid ?? [])];
          return notes.map((a, i) => {
            if (!reg.x || !reg.y) return null;
            const px = reg.x(a.x);
            const py = reg.y(a.y);
            if (!isFinite(px) || !isFinite(py)) return null;
            const label = truncateText(a.text, 180, fsz);
            const w = measureText(label, fsz);
            const dot: Box = { x0: px - 4, x1: px + 4, y0: py - 4, y1: py + 4 };
            taken.push(dot);
            const flip0 = px > right - 150;
            const up0 = py > top + fsz + 12;
            const chosen = placeNote({ px, py, w, fsz, flip0, up0, left, right, taken, dot });
            if (chosen) taken.push(chosen.box);
            return (
              <g key={i}>
                <circle cx={px} cy={py} r={3.5} className="pspp-chart__note-dot" />
                {chosen && (
                  <text className="pspp-chart__note-text" x={chosen.x} y={chosen.y} textAnchor={chosen.anchor} style={{ fontSize: fsz }}>
                    {label}
                  </text>
                )}
              </g>
            );
          });
        })()}
      </g>
    </g>
  );
}
