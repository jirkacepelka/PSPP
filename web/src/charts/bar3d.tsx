/* 3D bar chart: cuboids over a grid of two categorical axes, shaded faces, drawn back to front.
   Studio only (Bar3dSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useMemo, useRef, useState } from 'react';
import { ChartShell, type ChartCommonProps } from './shell';
import { formatValue } from './scale';
import { axisTitle, useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';
import { boxRadius, clampNum, faceVisible, gridOrder, makeCam, project, type Box3 } from './proj3d';
import { tr } from './strings';
import type { Bar3dSpec, View3d } from './studioTypes';
import { ViewButtons, ViewSurface, buildFrame, numAxis, numAxisDef, useView3d, type Axis3 } from './view3d';

/** Share of a grid cell left empty between neighbouring bars, per side. */
const GAP = 0.16;

const inPoly = (pts: number[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function Bar3dChart({ spec, ...c }: { spec: Bar3dSpec & { view3d?: View3d } } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const ctl = useView3d(spec.view3d, c.onView3dChange);
  const title = spec.title || tr(t, 'bar3d');
  const xName = spec.xlabel || '';
  const yName = spec.ylabel || '';
  const zName = spec.zlabel || tr(t, 'value');
  const nx = spec.xs.length;
  const ny = spec.ys.length;
  const [sel, setSel] = useState<number | null>(null);
  const faces = useRef<{ pts: number[][]; bar: number[] }>({ pts: [], bar: [] });

  const prep = useMemo(() => {
    let lo = 0;
    let hi = 0;
    let count = 0;
    for (const row of spec.values)
      for (const v of row)
        if (v !== null) {
          count++;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
    const za = numAxis(lo, hi, style?.zMin, style?.zMax, locale);
    const m = Math.max(1, nx, ny);
    const box: Box3 = { bx: Math.max(0.35, nx / m), by: Math.max(0.35, ny / m), bz: 0.7 };
    return { za, box, count };
  }, [spec, nx, ny, locale, style?.zMin, style?.zMax]);

  const table = useMemo(() => {
    const columns = [yName || tr(t, 'category'), ...spec.xs];
    const rows = spec.ys.map((y, yi) => [y, ...spec.xs.map((_, xi) => (spec.values[yi][xi] === null ? '' : formatValue(spec.values[yi][xi], locale)))]);
    return { columns, rows, numeric: columns.map((_, i) => i > 0), note: xName ? `${xName} / ${yName}` : undefined };
  }, [spec, xName, yName, locale, t]);

  const label = `${title}. ${tr(t, 'ariaBars3d', { count: prep.count })}, ${tr(t, 'ariaGrid3d', { nx, ny })}.`;

  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={label}
      table={table}
      plotHeight={(w) => clampNum(Math.round(w * 0.72), 320, 560)}
      toolbarExtra={<ViewButtons ctl={ctl} t={t} />}
    >
      {(area) => {
        if (!nx || !ny || !prep.count) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const { box, za } = prep;
        const view = ctl.view;
        const cam = makeCam(view, area.width, area.height, boxRadius(box));
        const zSpan = za.domain[1] - za.domain[0] || 1;
        const zw = (v: number) => ((clampNum(v, za.domain[0], za.domain[1]) - za.domain[0]) / zSpan - 0.5) * box.bz;
        const zero = zw(0);
        const wxOf = (u: number) => (u / nx - 0.5) * box.bx;
        const wyOf = (u: number) => (u / ny - 0.5) * box.by;

        // painter's order of a regular grid: the far side first, exact for equal footprints
        const { xDesc, yDesc } = gridOrder(cam);
        const xi0 = xDesc ? nx - 1 : 0;
        const yi0 = yDesc ? ny - 1 : 0;
        const fp: number[][] = [];
        const fb: number[] = [];
        let html = '';
        const quad = (cls: string, bar: number, corners: [number, number, number][]) => {
          const pts: number[] = [];
          let d = '';
          corners.forEach(([x, y, z], i) => {
            const q = project(cam, x, y, z);
            pts.push(q.x, q.y);
            d += `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
          });
          fp.push(pts);
          fb.push(bar);
          html += `<path class="pspp-chart__b3 pspp-chart__b3--${cls}" d="${d}Z"/>`;
        };
        for (let a = 0; a < ny; a++) {
          const yi = yDesc ? yi0 - a : a;
          for (let b = 0; b < nx; b++) {
            const xi = xDesc ? xi0 - b : b;
            const v = spec.values[yi][xi];
            if (v === null || v === 0) continue;
            const id = yi * nx + xi;
            const x0 = wxOf(xi + GAP);
            const x1 = wxOf(xi + 1 - GAP);
            const y0 = wyOf(yi + GAP);
            const y1 = wyOf(yi + 1 - GAP);
            const zt = zw(v);
            const zLo = Math.min(zero, zt);
            const zHi = Math.max(zero, zt);
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const cz = (zLo + zHi) / 2;
            // visible faces only: the two sides turned to the camera, then the cap
            if (faceVisible(cam, [x0, cy, cz], [-1, 0, 0])) quad('sx', id, [[x0, y0, zLo], [x0, y1, zLo], [x0, y1, zHi], [x0, y0, zHi]]);
            if (faceVisible(cam, [x1, cy, cz], [1, 0, 0])) quad('sx', id, [[x1, y0, zLo], [x1, y1, zLo], [x1, y1, zHi], [x1, y0, zHi]]);
            if (faceVisible(cam, [cx, y0, cz], [0, -1, 0])) quad('sy', id, [[x0, y0, zLo], [x1, y0, zLo], [x1, y0, zHi], [x0, y0, zHi]]);
            if (faceVisible(cam, [cx, y1, cz], [0, 1, 0])) quad('sy', id, [[x0, y1, zLo], [x1, y1, zLo], [x1, y1, zHi], [x0, y1, zHi]]);
            if (faceVisible(cam, [cx, cy, zHi], [0, 0, 1])) quad('top', id, [[x0, y0, zHi], [x1, y0, zHi], [x1, y1, zHi], [x0, y1, zHi]]);
            if (faceVisible(cam, [cx, cy, zLo], [0, 0, -1])) quad('bottom', id, [[x0, y0, zLo], [x1, y0, zLo], [x1, y1, zLo], [x0, y1, zLo]]);
          }
        }
        faces.current = { pts: fp, bar: fb };

        const cat = (names: string[]): Axis3['ticks'] => names.map((s, i) => ({ t: (i + 0.5) / names.length, label: s }));
        const bounds = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
        const zAxis = numAxisDef(za, axisTitle(style, 'z', zName));
        const frame = buildFrame({
          cam,
          view,
          box,
          axes: [
            { ticks: cat(spec.xs), grid: bounds(nx), title: axisTitle(style, 'x', xName) },
            { ticks: cat(spec.ys), grid: bounds(ny), title: axisTitle(style, 'y', yName) },
            // gridlines of the value axis only on the walls; the category grids run between the bars
            zAxis,
          ],
          grid: style?.grid !== false,
          fs,
          width: area.width,
          height: area.height,
          zeroT: -za.domain[0] / zSpan,
        });

        const onHover = (x: number, y: number, e: { clientX: number; clientY: number }) => {
          let hit: number | null = null;
          for (let i = faces.current.pts.length - 1; i >= 0; i--)
            if (inPoly(faces.current.pts[i], x, y)) {
              hit = faces.current.bar[i];
              break;
            }
          setSel((old) => (old === hit ? old : hit));
          if (hit === null) area.tip.hide();
          else {
            const yi = Math.floor(hit / nx);
            const xi = hit % nx;
            area.tip.show(e, {
              rows: [
                { label: zName, value: formatValue(spec.values[yi][xi], locale), key: 'none' as const },
                { label: xName || tr(t, 'category'), value: spec.xs[xi], key: 'none' as const },
                { label: yName || tr(t, 'category'), value: spec.ys[yi], key: 'none' as const },
              ],
            });
          }
        };
        const leave = () => {
          setSel(null);
          area.tip.hide();
        };
        const outline = sel === null ? '' : fp.map((pts, i) => (fb[i] === sel ? 'M' + pts.map((v, k) => (k % 2 ? `,${v.toFixed(1)}` : (k ? 'L' : '') + v.toFixed(1))).join('') + 'Z' : '')).join('');
        return (
          <g>
            {frame.before}
            <g dangerouslySetInnerHTML={{ __html: html }} />
            {outline && <path data-export="omit" pointerEvents="none" className="pspp-chart__b3-sel" d={outline} />}
            {frame.after}
            <ViewSurface ctl={ctl} width={area.width} height={area.height} label={label} t={t} onHover={onHover} onLeave={leave} />
          </g>
        );
      }}
    </ChartShell>
  );
}
