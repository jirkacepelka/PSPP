/* The style layer: ChartStyle (appearance overrides, see studioTypes.ts) reaches the shared plumbing
   in shell.tsx through React context, so every renderer gets titles, palette, grid, reference lines
   and annotations without code of its own.  SPDX-License-Identifier: GPL-3.0-or-later */

import { createContext, useContext, type ReactNode } from 'react';
import type { ChartStyle } from './studioTypes';
import { truncateText } from './scale';

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
}

const NOOP_REG: AxisReg = {};
export const RegCtx = createContext<AxisReg>(NOOP_REG);
export const useAxisReg = (): AxisReg => useContext(RegCtx);

/** The title of an axis after the style override; undefined = none (hidden by showTitle: false). */
export function axisTitle(style: ChartStyle | undefined, which: 'x' | 'y', fallback?: string): string | undefined {
  if (style?.showTitle === false) return undefined;
  const o = which === 'x' ? style?.xTitle : style?.yTitle;
  const s = o !== undefined ? o : fallback;
  return s ? s : undefined;
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
          const below = y < top + fsz + 6;
          return (
            <g key={i}>
              <line className="pspp-chart__ref pspp-chart__ref--user" x1={left} x2={right} y1={y} y2={y} style={{ stroke: color, strokeDasharray: dash }} />
              {l.label && (
                <text className="pspp-chart__note-text" x={right - 4} y={below ? y + fsz : y - 5} textAnchor="end" style={{ fontSize: fsz }}>
                  {truncateText(l.label, Math.max(60, width * 0.6), fsz)}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g clipPath={`url(#${clipId})`} aria-hidden="true">
        {notes.map((a, i) => {
          if (!reg.x || !reg.y) return null;
          const px = reg.x(a.x);
          const py = reg.y(a.y);
          if (!isFinite(px) || !isFinite(py)) return null;
          const label = truncateText(a.text, 180, fsz);
          const flip = px > right - 150;
          const up = py > top + fsz + 12;
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={3.5} className="pspp-chart__note-dot" />
              <text className="pspp-chart__note-text" x={flip ? px - 7 : px + 7} y={up ? py - 7 : py + fsz + 4} textAnchor={flip ? 'end' : 'start'} style={{ fontSize: fsz }}>
                {label}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}
