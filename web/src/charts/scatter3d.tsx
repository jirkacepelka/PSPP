/* 3D scatterplot: software projection, depth sorted points sized and faded by depth, optional least
   squares plane.  Studio only (Scatter3dSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useMemo, useRef, useState } from 'react';
import { ChartShell, GROUP_SHAPES, seriesColor, shapePath, type ChartCommonProps, type LegendItem, type MarkerShape } from './shell';
import { formatValue } from './scale';
import { axisTitle, useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';
import { boxRadius, clampNum, clipPlane, depthOrder, evenIndices, fitPlane, makeCam, project, type Box3 } from './proj3d';
import { tr } from './strings';
import type { Scatter3dSpec, View3d } from './studioTypes';
import { ViewButtons, ViewSurface, buildFrame, numAxis, numAxisDef, useView3d } from './view3d';

/** Above this many points the drawing uses an even subset (the table keeps all of them). */
export const DRAW_LIMIT = 4000;
const BOX: Box3 = { bx: 1, by: 1, bz: 0.75 };
const BUCKETS = 6;

export function Scatter3dChart({ spec, ...c }: { spec: Scatter3dSpec & { view3d?: View3d } } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const ctl = useView3d(spec.view3d, c.onView3dChange);
  const title = spec.title || tr(t, 'scatter3d');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const zName = spec.zlabel || 'Z';
  const [sel, setSel] = useState<number | null>(null);
  const proj = useRef<{ px: Float32Array; py: Float32Array; pd: Float32Array } | null>(null);

  const prep = useMemo(() => {
    const pts = spec.points;
    const ext = (f: (p: (typeof pts)[number]) => number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of pts) {
        const v = f(p);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return pts.length ? ([lo, hi] as const) : ([0, 1] as const);
    };
    const xa = numAxis(...ext((p) => p.x), style?.xMin, style?.xMax, locale);
    const ya = numAxis(...ext((p) => p.y), style?.yMin, style?.yMax, locale);
    const za = numAxis(...ext((p) => p.z), null, null, locale);
    // points outside an explicit axis range are left out
    const inside = (p: (typeof pts)[number]) => p.x >= xa.domain[0] && p.x <= xa.domain[1] && p.y >= ya.domain[0] && p.y <= ya.domain[1];
    const kept = pts.filter(inside);
    const drawIdx = evenIndices(kept.length, DRAW_LIMIT);
    const drawn = drawIdx.map((i) => kept[i]);
    // groups by first appearance, at most 8 own colours, the rest share 'other'
    const order: string[] = [];
    const slot = new Map<string, number>();
    const miss = tr(t, 'missing');
    for (const p of kept) {
      const g = p.group === null ? '' : p.group || miss;
      if (!slot.has(g) && order.length < 8) (slot.set(g, order.length), order.push(g));
    }
    const hasGroups = kept.some((p) => p.group !== null);
    const groupOf = (p: (typeof pts)[number]) => (hasGroups ? slot.get(p.group === null ? '' : p.group || miss) ?? 8 : 0);
    const nx = (v: number) => ((v - xa.domain[0]) / (xa.domain[1] - xa.domain[0]) - 0.5) * BOX.bx;
    const ny = (v: number) => ((v - ya.domain[0]) / (ya.domain[1] - ya.domain[0]) - 0.5) * BOX.by;
    const nz = (v: number) => ((v - za.domain[0]) / (za.domain[1] - za.domain[0]) - 0.5) * BOX.bz;
    const n = drawn.length;
    const wx = new Float64Array(n);
    const wy = new Float64Array(n);
    const wz = new Float64Array(n);
    const gi = new Uint8Array(n);
    drawn.forEach((p, i) => {
      wx[i] = nx(p.x);
      wy[i] = ny(p.y);
      wz[i] = nz(p.z);
      gi[i] = groupOf(p);
    });
    // Least squares plane z = a + b x + c y (normal equations on centred data, see fitPlane) over every kept
    // point, not only the drawn ones.  In box coordinates it is again a plane, zw = A + B xw + C yw; its
    // coefficients come from three samples.
    const fit = spec.fit === 'plane' ? fitPlane(kept) : null;
    let plane: { A: number; B: number; C: number; poly: [number, number, number][]; r2: number | null; formula: string } | null = null;
    if (fit) {
      const f = (x: number, y: number) => nz(fit.a + fit.b * x + fit.c * y);
      const x0 = xa.domain[0];
      const y0 = ya.domain[0];
      const poly = clipPlane(fit, x0, xa.domain[1], y0, ya.domain[1], za.domain[0], za.domain[1]).map(([x, y, z]): [number, number, number] => [nx(x), ny(y), nz(z)]);
      const A = f(x0, y0); // box height at xw = -bx/2, yw = -by/2
      const fx = f(xa.domain[1], y0) - A;
      const fy = f(x0, ya.domain[1]) - A;
      const B = fx / BOX.bx;
      const C = fy / BOX.by;
      // zw = A + B (xw + bx/2) + C (yw + by/2)
      plane = { A: A + (B * BOX.bx) / 2 + (C * BOX.by) / 2, B, C, poly, r2: fit.r2, formula: `z = ${formatValue(fit.a, locale, 3)} ${fit.b < 0 ? '−' : '+'} ${formatValue(Math.abs(fit.b), locale, 3)} x ${fit.c < 0 ? '−' : '+'} ${formatValue(Math.abs(fit.c), locale, 3)} y` };
    }
    return { xa, ya, za, kept, drawn, wx, wy, wz, gi, order, hasGroups, plane, decimated: kept.length > drawn.length, total: spec.points.length };
  }, [spec, style?.xMin, style?.xMax, style?.yMin, style?.yMax, locale, t]);

  const groupNames = prep.order.map((g) => g || tr(t, 'missing'));
  const hasOther = prep.hasGroups && prep.kept.some((p) => p.group !== null && !prep.order.includes(p.group || tr(t, 'missing')));
  const shapeOf = (g: number): MarkerShape => (prep.hasGroups && g < 8 ? GROUP_SHAPES[g] : 'circle');
  const legend: LegendItem[] | undefined =
    prep.hasGroups || prep.plane
      ? [
          ...(prep.hasGroups ? groupNames.map((name, i) => ({ label: name, kind: 'marker' as const, color: seriesColor(i), shape: shapeOf(i) })) : []),
          ...(hasOther ? [{ label: tr(t, 'other'), kind: 'marker' as const, color: 'var(--c-other)', shape: 'circle' as const }] : []),
          ...(prep.plane
            ? [{ label: `${tr(t, 'planeFit')}${prep.plane.r2 !== null ? `, ${tr(t, 'rSquared')} = ${formatValue(prep.plane.r2, locale, 3)}` : ''}`, kind: 'rect' as const, color: 'var(--c-ink-2)' }]
            : []),
        ]
      : undefined;

  const table = useMemo(() => {
    const grouped = spec.points.some((p) => p.group !== null);
    const columns = [xName, yName, zName, ...(grouped ? [spec.groupLabel || tr(t, 'group')] : [])];
    const rows = spec.points.map((p) => [formatValue(p.x, locale), formatValue(p.y, locale), formatValue(p.z, locale), ...(grouped ? [p.group ?? ''] : [])]);
    const notes = [prep.decimated ? tr(t, 'decimated3d', { shown: prep.drawn.length, total: prep.kept.length }) : '', prep.plane ? `${tr(t, 'planeFit')}: ${prep.plane.formula}` : ''].filter(Boolean);
    return { columns, rows, numeric: columns.map((_, i) => i < 3), note: notes.join(' ') || undefined };
  }, [spec, xName, yName, zName, locale, t, prep]);

  const label = `${title}. ${tr(t, 'ariaPoints', { count: spec.points.length })}${prep.hasGroups ? ', ' + tr(t, 'ariaGroups', { count: prep.order.length }) : ''}.`;

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      legendTitle={spec.groupLabel || undefined}
      ariaLabel={label}
      table={table}
      plotHeight={(w) => clampNum(Math.round(w * 0.72), 320, 560)}
      toolbarExtra={<ViewButtons ctl={ctl} t={t} />}
    >
      {(area) => {
        if (!prep.kept.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const view = ctl.view;
        const R = boxRadius(BOX);
        const cam = makeCam(view, area.width, area.height, R);
        const n = prep.drawn.length;
        const px = new Float32Array(n);
        const py = new Float32Array(n);
        const pd = new Float32Array(n);
        const pf = new Float32Array(n);
        const o = { x: 0, y: 0, d: 0, f: 1 };
        for (let i = 0; i < n; i++) {
          project(cam, prep.wx[i], prep.wy[i], prep.wz[i], o);
          px[i] = o.x;
          py[i] = o.y;
          pd[i] = o.d;
          pf[i] = o.f;
        }
        proj.current = { px, py, pd };
        const order = depthOrder(pd);

        // which side of the plane the camera is on, and so which points are in front of it
        const plane = prep.plane;
        let camSide = 1;
        if (plane) {
          const m = cam.m;
          const cp = cam.persp ? [-4 * m[6], -4 * m[7], -4 * m[8]] : [-m[6] * 1e6, -m[7] * 1e6, -m[8] * 1e6];
          camSide = Math.sign(cp[2] - (plane.A + plane.B * cp[0] + plane.C * cp[1])) || 1;
        }
        const zoomK = clampNum(Math.sqrt(view.zoom), 0.7, 1.6);
        const base = (n > 1500 ? 2.6 : 3.2) * zoomK;
        const markup = (ids: number[]): string => {
          let html = '';
          let open = -1;
          for (const i of ids) {
            const near = 1 - (pd[i] / R + 1) / 2; // 1 = nearest
            const b = clampNum(Math.floor(near * BUCKETS), 0, BUCKETS - 1);
            if (b !== open) {
              if (open >= 0) html += '</g>';
              html += `<g style="opacity:${(0.5 + (0.5 * b) / (BUCKETS - 1)).toFixed(2)}">`;
              open = b;
            }
            const r = (base * (0.8 + 0.5 * near) * pf[i]).toFixed(1);
            const g = prep.gi[i];
            const cls = `pspp-chart__p3 pspp-chart__p3--${g < 8 ? g : 'o'}`;
            const shape = shapeOf(g);
            const x = px[i].toFixed(1);
            const y = py[i].toFixed(1);
            html += shape === 'circle' ? `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>` : `<path class="${cls}" d="${shapePath(shape, +x, +y, +r)}"/>`;
          }
          return open >= 0 ? html + '</g>' : html;
        };
        let behind = order;
        let front: number[] = [];
        if (plane) {
          behind = [];
          for (const i of order) {
            const above = prep.wz[i] - (plane.A + plane.B * prep.wx[i] + plane.C * prep.wy[i]);
            (Math.sign(above) === camSide ? front : behind).push(i);
          }
        }
        const frame = buildFrame({
          cam,
          view,
          box: BOX,
          axes: [numAxisDef(prep.xa, axisTitle(style, 'x', xName)), numAxisDef(prep.ya, axisTitle(style, 'y', yName)), numAxisDef(prep.za, style?.showTitle === false ? undefined : zName)],
          grid: style?.grid !== false,
          fs,
          width: area.width,
          height: area.height,
        });

        const nearest = (x: number, y: number): number | null => {
          const p = proj.current;
          if (!p) return null;
          let best = -1;
          let bestD = 14 * 14;
          for (let i = 0; i < p.px.length; i++) {
            const dx = p.px[i] - x;
            const dy = p.py[i] - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) (best = i), (bestD = d);
            // of two overlapping points the nearer one wins
            else if (best >= 0 && d <= bestD + 6 && p.pd[i] < p.pd[best]) best = i;
          }
          return best < 0 ? null : best;
        };
        const tipFor = (i: number) => {
          const pt = prep.drawn[i];
          return {
            title: pt.group ? pt.group : undefined,
            rows: [
              { label: xName, value: formatValue(pt.x, locale), key: 'none' as const },
              { label: yName, value: formatValue(pt.y, locale), key: 'none' as const },
              { label: zName, value: formatValue(pt.z, locale), key: 'none' as const },
            ],
          };
        };
        const onHover = (x: number, y: number, e: { clientX: number; clientY: number }) => {
          const i = nearest(x, y);
          setSel((old) => (old === i ? old : i));
          if (i === null) area.tip.hide();
          else area.tip.show(e, tipFor(i));
        };
        const leave = () => {
          setSel(null);
          area.tip.hide();
        };

        // drop line of the hovered point: onto the floor, thin
        let drop: React.ReactNode = null;
        if (sel !== null && sel < n) {
          const floor = project(cam, prep.wx[sel], prep.wy[sel], -BOX.bz / 2);
          drop = (
            <g data-export="omit" pointerEvents="none">
              <line x1={floor.x} y1={floor.y} x2={px[sel]} y2={py[sel]} className="pspp-chart__drop3d" />
              <circle cx={floor.x} cy={floor.y} r={3} className="pspp-chart__drop3d-dot" />
              <circle cx={px[sel]} cy={py[sel]} r={base * 1.9} className="pspp-chart__hover-ring" />
            </g>
          );
        }
        let planePath = '';
        if (plane && plane.poly.length >= 3) planePath = 'M' + plane.poly.map(([x, y, z]) => { const q = project(cam, x, y, z); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join('L') + 'Z';
        return (
          <g>
            {frame.before}
            <g dangerouslySetInnerHTML={{ __html: markup(behind) }} />
            {/* the plane is translucent and drawn between the points behind it and the points in front of it */}
            {planePath && <path className="pspp-chart__plane3d" d={planePath} />}
            {front.length > 0 && <g dangerouslySetInnerHTML={{ __html: markup(front) }} />}
            {frame.after}
            {drop}
            <ViewSurface ctl={ctl} width={area.width} height={area.height} label={label} t={t} onHover={onHover} onLeave={leave} />
          </g>
        );
      }}
    </ChartShell>
  );
}
