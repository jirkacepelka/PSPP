/* One overlay with a single set of handlers for charts with very many categories: the pointer position
   picks the nearest category (arrow keys step through them), instead of one focusable mark per category.
   SPDX-License-Identifier: GPL-3.0-or-later */

import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { nearestIndex } from './xvalues';
import type { TipApi, TipContent } from './shell';

/** Above this many categories charts switch to the dense drawing mode. */
export const DENSE = 300;

export function DenseHover({
  tip,
  left,
  top,
  width,
  height,
  n,
  xAt,
  tipFor,
  ariaLabel,
  xs,
  vertical,
}: {
  tip: TipApi;
  left: number;
  top: number;
  width: number;
  height: number;
  n: number;
  /** pixel x of category i (centre) */
  xAt: (i: number) => number;
  tipFor: (i: number) => TipContent;
  ariaLabel: string;
  /** pixel x of every category when they are not evenly spaced (ascending) */
  xs?: number[];
  /** categories run top to bottom (horizontal bars): xAt then gives the pixel y of category i */
  vertical?: boolean;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const band = (vertical ? height : width) / Math.max(1, n);
  const pick = (i: number, at: { clientX: number; clientY: number }) => {
    setHi(i);
    tip.show(at, tipFor(i));
  };
  const leave = () => {
    setHi(null);
    tip.hide();
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rc = e.currentTarget.getBoundingClientRect();
    const off = vertical ? e.clientY - rc.top : e.clientX - rc.left;
    pick(xs ? nearestIndex(xs, off + left) : Math.min(n - 1, Math.max(0, Math.floor(off / band))), e);
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (!n) return;
    let i = hi ?? -1;
    const jump = Math.max(1, Math.round(n / 50));
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
    else if (e.key === 'PageDown') i = Math.min(n - 1, i + jump);
    else if (e.key === 'PageUp') i = Math.max(0, i - jump);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Escape') {
      leave();
      return;
    } else return;
    e.preventDefault();
    const rc = e.currentTarget.getBoundingClientRect();
    pick(i, vertical ? { clientX: rc.left + width / 2, clientY: rc.top + xAt(i) - top } : { clientX: rc.left + xAt(i) - left, clientY: rc.top + height / 2 });
  };
  return (
    <g>
      {hi !== null && <line data-export="omit" pointerEvents="none" className="pspp-chart__grid" x1={vertical ? left : xAt(hi)} x2={vertical ? left + width : xAt(hi)} y1={vertical ? xAt(hi) : top} y2={vertical ? xAt(hi) : top + height} style={{ strokeDasharray: '3 3', stroke: 'var(--c-axis)' }} />}
      <rect
        data-export="omit"
        className="pspp-chart__hit"
        x={left}
        y={top}
        width={width}
        height={height}
        tabIndex={0}
        role="graphics-symbol"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={leave}
        onKeyDown={onKey}
        onBlur={leave}
      />
    </g>
  );
}
