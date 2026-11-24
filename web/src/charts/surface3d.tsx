/* 3D surface: quad mesh over a regular grid, painter's order, sequential colour by height with a colour bar.
   Studio only (Surface3dSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useMemo, useRef, useState } from 'react';
import { ChartShell, FONT, type ChartCommonProps } from './shell';
import { formatValue, measureText, niceTicks, ticksWithin, tickFormatter } from './scale';
import { axisTitle, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { boxRadius, clampNum, evenIndices, gridOrder, makeCam, project, rampCss, rampStep, type Box3 } from './proj3d';
import { tr } from './strings';
import type { Surface3dSpec, View3d } from './studioTypes';
import { ViewButtons, ViewSurface, buildFrame, numAxisDef, useView3d } from './view3d';

/** Cap of the drawn grid, in cells per axis. */
export const MAX_CELLS = 120;
/** While the user drags, big grids are drawn with fewer cells so the rotation stays smooth. */
export const DRAG_CELLS = 60;
export const RAMP_STEPS = 16;
const BOX: Box3 = { bx: 1, by: 1, bz: 0.7 };
const BAR_W = 12;

export function Surface3dChart({ spec, ...c }: { spec: Surface3dSpec & { view3d?: View3d } } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const ctl = useView3d(spec.view3d, c.onView3dChange);
  const title = spec.title || tr(t, 'surface3d');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const zName = spec.zlabel || 'Z';
  const nx = spec.xs.length;
  const ny = spec.ys.length;
  const [sel, setSel] = useState<[number, number] | null>(null);
  const hov = useRef<{ px: Float32Array; py: Float32Array; xi: number[]; yi: number[] } | null>(null);

  const prep = useMemo(() => {
    let zmin = Infinity;
    let zmax = -Infinity;
    let count = 0;
    for (const row of spec.z)
      for (const v of row)
        if (v !== null) {
          count++;
          if (v < zmin) zmin = v;
          if (v > zmax) zmax = v;
        }
    if (!count) (zmin = 0), (zmax = 1);
    // x and y axes end exactly at the data (or at the style's range); z gets a nice domain
    const exact = (a: number[], lo?: number | null, hi?: number | null) => {
      const min = a.length ? a[0] : 0;
      const max = a.length ? a[a.length - 1] : 1;
      const tk = applyDomain({ ...ticksWithin(min, max, 5), domain: [min, max] }, lo, hi, 5);
      return { domain: tk.domain, ticks: tk.ticks, fmt: tickFormatter(tk.step, tk.ticks, locale) };
    };
    const xa = exact(spec.xs, style?.xMin, style?.xMax);
    const ya = exact(spec.ys, style?.yMin, style?.yMax);
    const zt = niceTicks(zmin, zmax, 5);
    const za = { domain: zt.domain, ticks: zt.ticks, fmt: tickFormatter(zt.step, zt.ticks, locale) };
    const keepX = spec.xs.map((v, i) => (v >= xa.domain[0] && v <= xa.domain[1] ? i : -1)).filter((i) => i >= 0);
    const keepY = spec.ys.map((v, i) => (v >= ya.domain[0] && v <= ya.domain[1] ? i : -1)).filter((i) => i >= 0);
    const barTicks = ticksWithin(zmin, zmax, 4);
    return { zmin, zmax, count, xa, ya, za, keepX, keepY, barFmt: tickFormatter(barTicks.step, barTicks.ticks, locale), barTicks: barTicks.ticks };
  }, [spec, style?.xMin, style?.xMax, style?.yMin, style?.yMax, locale]);

  const table = useMemo(() => {
    const columns = [yName, ...spec.xs.map((x) => formatValue(x, locale))];
    const rows = spec.ys.map((y, yi) => [formatValue(y, locale), ...spec.xs.map((_, xi) => (spec.z[yi][xi] === null ? '' : formatValue(spec.z[yi][xi], locale)))]);
    const reduced = nx > MAX_CELLS + 1 || ny > MAX_CELLS + 1;
    const step = Math.ceil((Math.max(nx, ny) - 1) / MAX_CELLS);
    return { columns, rows, numeric: columns.map(() => true), note: `${xName} / ${yName} / ${zName}.${reduced ? ' ' + tr(t, 'gridReduced', { step }) : ''}` };
  }, [spec, xName, yName, zName, nx, ny, locale, t]);

  const label = `${title}. ${tr(t, 'ariaGrid3d', { nx, ny })}.`;
  const barLabW = Math.ceil(prep.barTicks.reduce((m, v) => Math.max(m, measureText(prep.barFmt(v), FONT.tick * fs)), 0));
  const reserve = BAR_W + barLabW + 36;

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
        if (nx < 2 || ny < 2 || !prep.count || !prep.keepX.length || !prep.keepY.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const { xa, ya, za } = prep;
        const view = ctl.view;
        const drawW = Math.max(160, area.width - reserve);
        const cam = makeCam(view, drawW, area.height, boxRadius(BOX));
        const cap = ctl.dragging ? DRAG_CELLS : MAX_CELLS;
        const sx = evenIndices(prep.keepX.length, cap + 1).map((i) => prep.keepX[i]);
        const sy = evenIndices(prep.keepY.length, cap + 1).map((i) => prep.keepY[i]);
        const mx = sx.length;
        const my = sy.length;
        const xSpan = xa.domain[1] - xa.domain[0] || 1;
        const ySpan = ya.domain[1] - ya.domain[0] || 1;
        const zSpan = za.domain[1] - za.domain[0] || 1;
        const px = new Float32Array(mx * my);
        const py = new Float32Array(mx * my);
        const o = { x: 0, y: 0, d: 0, f: 1 };
        const wxs = sx.map((i) => ((spec.xs[i] - xa.domain[0]) / xSpan - 0.5) * BOX.bx);
        const wys = sy.map((i) => ((spec.ys[i] - ya.domain[0]) / ySpan - 0.5) * BOX.by);
        const zAt = (a: number, b: number) => spec.z[sy[b]][sx[a]];
        for (let b = 0; b < my; b++)
          for (let a = 0; a < mx; a++) {
            const z = zAt(a, b);
            if (z === null) {
              px[b * mx + a] = NaN;
              continue;
            }
            project(cam, wxs[a], wys[b], ((z - za.domain[0]) / zSpan - 0.5) * BOX.bz, o);
            px[b * mx + a] = o.x;
            py[b * mx + a] = o.y;
          }
        hov.current = { px, py, xi: sx, yi: sy };

        // painter's order of a height field: the far side first, exact without sorting
        const { xDesc, yDesc } = gridOrder(cam);
        let html = '';
        for (let bb = 0; bb < my - 1; bb++) {
          const b = yDesc ? my - 2 - bb : bb;
          for (let aa = 0; aa < mx - 1; aa++) {
            const a = xDesc ? mx - 2 - aa : aa;
            const i00 = b * mx + a;
            const i10 = i00 + 1;
            const i01 = i00 + mx;
            const i11 = i01 + 1;
            if (isNaN(px[i00]) || isNaN(px[i10]) || isNaN(px[i01]) || isNaN(px[i11])) continue; // hole
            const zm = ((zAt(a, b) as number) + (zAt(a + 1, b) as number) + (zAt(a, b + 1) as number) + (zAt(a + 1, b + 1) as number)) / 4;
            const k = rampStep(zm, prep.zmin, prep.zmax, RAMP_STEPS);
            html += `<path class="pspp-chart__s3 pspp-chart__s3--${k}" d="M${px[i00].toFixed(1)},${py[i00].toFixed(1)}L${px[i10].toFixed(1)},${py[i10].toFixed(1)}L${px[i11].toFixed(1)},${py[i11].toFixed(1)}L${px[i01].toFixed(1)},${py[i01].toFixed(1)}Z"/>`;
          }
        }

        const xAxis = { domain: xa.domain, ticks: xa.ticks, fmt: xa.fmt };
        const yAxis = { domain: ya.domain, ticks: ya.ticks, fmt: ya.fmt };
        const frame = buildFrame({
          cam,
          view,
          box: BOX,
          axes: [numAxisDef(xAxis, axisTitle(style, 'x', xName)), numAxisDef(yAxis, axisTitle(style, 'y', yName)), numAxisDef(za, style?.showTitle === false ? undefined : zName)],
          grid: style?.grid !== false,
          fs,
          width: drawW,
          height: area.height,
        });

        const onHover = (x: number, y: number, e: { clientX: number; clientY: number }) => {
          const h = hov.current;
          if (!h) return;
          let best = -1;
          let bestD = 16 * 16;
          for (let i = 0; i < h.px.length; i++) {
            const dx = h.px[i] - x;
            const dy = h.py[i] - y;
            const d = dx * dx + dy * dy; // NaN (a hole) never wins
            if (d < bestD) (best = i), (bestD = d);
          }
          if (best < 0) {
            setSel(null);
            area.tip.hide();
            return;
          }
          const a = best % mx;
          const b = Math.floor(best / mx);
          const next: [number, number] = [h.xi[a], h.yi[b]];
          setSel((old) => (old && old[0] === next[0] && old[1] === next[1] ? old : next));
          area.tip.show(e, {
            rows: [
              { label: zName, value: formatValue(spec.z[next[1]][next[0]], locale), key: 'none' as const },
              { label: xName, value: formatValue(spec.xs[next[0]], locale), key: 'none' as const },
              { label: yName, value: formatValue(spec.ys[next[1]], locale), key: 'none' as const },
            ],
          });
        };
        const leave = () => {
          setSel(null);
          area.tip.hide();
        };
        let ring: React.ReactNode = null;
        if (sel && spec.z[sel[1]]?.[sel[0]] != null) {
          const q = project(cam, ((spec.xs[sel[0]] - xa.domain[0]) / xSpan - 0.5) * BOX.bx, ((spec.ys[sel[1]] - ya.domain[0]) / ySpan - 0.5) * BOX.by, (((spec.z[sel[1]][sel[0]] as number) - za.domain[0]) / zSpan - 0.5) * BOX.bz);
          ring = <circle data-export="omit" pointerEvents="none" cx={q.x} cy={q.y} r={5} className="pspp-chart__hover-ring" />;
        }

        // colour bar
        const barX = area.width - reserve + 18;
        const barTop = 16;
        const barH = Math.min(area.height - 40, 190);
        const gradId = area.uid + '-sg';
        const stops = Array.from({ length: RAMP_STEPS }, (_, i) => i);
        const span = prep.zmax - prep.zmin || 1;
        return (
          <g>
            <defs>
              <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
                {stops.map((i) => (
                  <stop key={i} offset={i / (RAMP_STEPS - 1)} style={{ stopColor: rampCss(i, RAMP_STEPS) }} />
                ))}
              </linearGradient>
            </defs>
            {frame.before}
            <g dangerouslySetInnerHTML={{ __html: html }} />
            {frame.after}
            {ring}
            <g aria-hidden="true">
              <text className="pspp-chart__legend-text" x={barX} y={barTop - 6} style={{ fontSize: 12 * fs }}>
                {zName}
              </text>
              <rect x={barX} y={barTop} width={BAR_W} height={barH} rx={2} style={{ fill: `url(#${gradId})`, stroke: 'var(--c-axis)', strokeWidth: 1 }} />
              {prep.barTicks.map((v) => {
                const yy = barTop + barH * (1 - (v - prep.zmin) / span);
                return (
                  <text key={v} className="pspp-chart__tick" x={barX + BAR_W + 6} y={yy} dominantBaseline="central">
                    {prep.barFmt(v)}
                  </text>
                );
              })}
            </g>
            <ViewSurface ctl={ctl} width={area.width} height={area.height} label={label} t={t} onHover={onHover} onLeave={leave} />
          </g>
        );
      }}
    </ChartShell>
  );
}
