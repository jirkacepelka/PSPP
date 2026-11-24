/* Marginal plots of a scatterplot: histogram, density or box plot above (x) and to the right (y) of the main plot, drawn
   in the main plot's pixel scales so they share its axis ranges and line up with its axes.
   SPDX-License-Identifier: GPL-3.0-or-later */

import type { ReactNode } from 'react';
import type { TipApi } from './shell';
import { formatValue } from './scale';
import { boxStats, histCounts, kdeCurve, marginalBins } from './phase4Math';
import type { PlotGeometry } from './xy';

export type MarginalKind = 'histogram' | 'density' | 'box';

export interface MarginalGroup {
  name: string;
  color: string;
  xs: number[];
  ys: number[];
}

interface Opts {
  kind: MarginalKind;
  groups: MarginalGroup[];
  /** thickness of each marginal plot in px */
  size: number;
  /** gap between the main plot and a marginal plot */
  gap: number;
  tip: TipApi;
  uid: string;
  locale?: string;
  names: { x: string; y: string; count: string; median: string; q1: string; q3: string; group: string };
  label: (axis: 'x' | 'y') => string;
}

const f1 = (v: number) => v.toFixed(1);

/** The two marginal plots as one <g>; `axis` x = on top (follows the x scale), y = on the right (follows the y scale). */
export function drawMarginals(o: Opts, g: PlotGeometry): ReactNode {
  const named = o.groups.length > 1;
  const fv = (v: number) => formatValue(v, o.locale);
  const one = (axis: 'x' | 'y'): ReactNode => {
    const horiz = axis === 'x';
    // along = the axis shared with the main plot, across = the marginal's own thickness
    const dom = horiz ? g.xDomain : g.yDomain;
    const scale = horiz ? g.sx : g.sy;
    const base = horiz ? g.top - o.gap : g.left + g.width + o.gap;
    const room = o.size - o.gap - 2;
    const vals = (gr: MarginalGroup) => (horiz ? gr.xs : gr.ys);
    // pixel position of (along, offset away from the main plot)
    const P = (a: number, off: number) => (horiz ? `${f1(scale(a))},${f1(base - off)}` : `${f1(base + off)},${f1(scale(a))}`);
    const clipId = `${o.uid}-mg${axis}`;
    const clip = horiz ? { x: g.left, y: g.top - o.size, width: g.width, height: o.size } : { x: g.left + g.width, y: g.top, width: o.size, height: g.height };
    const body: ReactNode[] = [];

    if (o.kind === 'histogram') {
      const bins = marginalBins(Math.max(...o.groups.map((gr) => vals(gr).length)));
      const counts = o.groups.map((gr) => histCounts(vals(gr), dom[0], dom[1], bins));
      const max = Math.max(1, ...counts.flat());
      o.groups.forEach((gr, gi) =>
        counts[gi].forEach((n, b) => {
          if (!n) return;
          const a0 = dom[0] + ((dom[1] - dom[0]) * b) / bins;
          const a1 = dom[0] + ((dom[1] - dom[0]) * (b + 1)) / bins;
          const len = (n / max) * room;
          const p0 = scale(a0);
          const p1 = scale(a1);
          const lo = Math.min(p0, p1);
          const span = Math.max(1, Math.abs(p1 - p0) - 1);
          const content = { title: `${horiz ? o.names.x : o.names.y}: ${fv(a0)} – ${fv(a1)}`, rows: [{ label: named ? gr.name : o.names.count, value: named ? fv(n) : fv(n), color: gr.color, key: 'rect' as const }] };
          body.push(
            <rect
              key={`${gi}:${b}`}
              x={horiz ? lo + 0.5 : base}
              y={horiz ? base - len : lo + 0.5}
              width={horiz ? span : len}
              height={horiz ? len : span}
              style={{ fill: gr.color, fillOpacity: named ? 0.5 : 0.75, stroke: gr.color, strokeWidth: 1 }}
              onPointerEnter={(e) => o.tip.show(e, content)}
              onPointerMove={(e) => o.tip.show(e, content)}
              onPointerLeave={() => o.tip.hide()}
            />,
          );
        }),
      );
    } else if (o.kind === 'density') {
      const curves = o.groups.map((gr) => kdeCurve(vals(gr), dom[0], dom[1]));
      const max = Math.max(1e-12, ...curves.flatMap((cv) => cv.map((p) => p[1])));
      o.groups.forEach((gr, gi) => {
        const cv = curves[gi];
        if (cv.length < 2) return;
        const line = cv.map((p) => P(p[0], (p[1] / max) * room)).join('L');
        const closed = `${P(cv[0][0], 0)}L${line}L${P(cv[cv.length - 1][0], 0)}Z`;
        body.push(<path key={'f' + gi} d={'M' + closed} style={{ fill: gr.color, fillOpacity: 0.18, stroke: 'none' }} />);
        body.push(<path key={'l' + gi} d={'M' + line} className="pspp-chart__line" style={{ stroke: gr.color, strokeWidth: 1.5 }} />);
      });
    } else {
      const rows = o.groups.length;
      const slot = room / rows;
      const bh = Math.min(slot * 0.6, 14);
      o.groups.forEach((gr, gi) => {
        const st = boxStats(vals(gr));
        if (!st) return;
        const mid = (gi + 0.5) * slot;
        const A = (a: number) => scale(a);
        // box geometry in (along, across) then mapped to x/y
        const rect = (a0: number, a1: number, c0: number, c1: number) => {
          const lo = Math.min(A(a0), A(a1));
          const len = Math.abs(A(a1) - A(a0));
          return horiz ? { x: lo, y: base - c1, width: len, height: c1 - c0 } : { x: base + c0, y: lo, width: c1 - c0, height: len };
        };
        const seg = (a0: number, a1: number, c: number) => (horiz ? `M${f1(A(a0))},${f1(base - c)}H${f1(A(a1))}` : `M${f1(base + c)},${f1(A(a0))}V${f1(A(a1))}`);
        const tick = (a: number) => (horiz ? `M${f1(A(a))},${f1(base - mid - bh / 3)}V${f1(base - mid + bh / 3)}` : `M${f1(base + mid - bh / 3)},${f1(A(a))}H${f1(base + mid + bh / 3)}`);
        const content = {
          title: named ? gr.name : undefined,
          rows: [
            { label: o.names.q3, value: fv(st.q3), color: gr.color, key: 'rect' as const },
            { label: o.names.median, value: fv(st.median), key: 'none' as const },
            { label: o.names.q1, value: fv(st.q1), key: 'none' as const },
          ],
        };
        body.push(
          <g key={gi} onPointerEnter={(e) => o.tip.show(e, content)} onPointerMove={(e) => o.tip.show(e, content)} onPointerLeave={() => o.tip.hide()}>
            <path d={seg(st.lo, st.q1, mid) + seg(st.q3, st.hi, mid) + tick(st.lo) + tick(st.hi)} className="pspp-chart__whisker" fill="none" style={{ stroke: gr.color }} />
            <rect {...rect(st.q1, st.q3, mid - bh / 2, mid + bh / 2)} style={{ fill: gr.color, fillOpacity: 0.28, stroke: gr.color, strokeWidth: 1.5 }} />
            <path d={horiz ? `M${f1(A(st.median))},${f1(base - mid - bh / 2)}V${f1(base - mid + bh / 2)}` : `M${f1(base + mid - bh / 2)},${f1(A(st.median))}H${f1(base + mid + bh / 2)}`} className="pspp-chart__median" style={{ strokeWidth: 2 }} />
            {st.outliers.slice(0, 80).map((v, k) => (
              <circle key={k} cx={horiz ? A(v) : base + mid} cy={horiz ? base - mid : A(v)} r={1.6} style={{ fill: gr.color, fillOpacity: 0.7 }} />
            ))}
          </g>,
        );
      });
    }
    return (
      <g key={axis} role="img" aria-label={o.label(axis)}>
        <defs>
          <clipPath id={clipId}>
            <rect {...clip} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{body}</g>
        <line className="pspp-chart__baseline" x1={horiz ? g.left : base} x2={horiz ? g.left + g.width : base} y1={horiz ? base : g.top} y2={horiz ? base : g.top + g.height} aria-hidden="true" />
      </g>
    );
  };
  return (
    <g>
      {one('x')}
      {one('y')}
    </g>
  );
}
