/* Small helpers shared by the phase 4 chart renderers.  SPDX-License-Identifier: GPL-3.0-or-later */

import { markTip, type TipApi, type TipContent } from './shell';

/** Centred "no data" message of an empty plot. */
export function EmptyPlot({ width, height, text }: { width: number; height: number; text: string }) {
  return (
    <text className="pspp-chart__empty" x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="central">
      {text}
    </text>
  );
}

/** Hover props for a mark; keyboard focus only when `focusable` (charts with hundreds of marks keep the tab order short and
    rely on the data table instead). */
export function tipProps(tip: TipApi, content: TipContent, focusable: boolean, ariaLabel?: string) {
  if (focusable) return markTip(tip, content, ariaLabel);
  return {
    onPointerEnter: (e: React.PointerEvent) => tip.show(e, content),
    onPointerMove: (e: React.PointerEvent) => tip.show(e, content),
    onPointerLeave: () => tip.hide(),
  };
}

/** Colour of group slot `i` of `n` groups: the first eight get their own slot, the rest the neutral colour. */
export const groupSlot = (i: number): number => (i < 8 ? i : -1);

/** Signed number text for changes ("+12", "−5"). */
export function signed(v: number, fmt: (v: number) => string): string {
  return v > 0 ? '+' + fmt(v) : v < 0 ? '−' + fmt(Math.abs(v)) : fmt(v);
}
