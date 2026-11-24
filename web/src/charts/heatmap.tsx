/* Binned scatter ("heatmap"): counts per rectangular cell on a sequential colour scale with a colour bar.
   Studio only (HeatmapSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AxisTitles, Baseline, ChartShell, FONT, XAxis, YAxis, plotMargins, type ChartCommonProps } from './shell';
import { clamp, formatValue, linearScale, measureText, tickFormatter, ticksWithin } from './scale';
import { tr } from './strings';
import type { HeatmapSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { rampColor } from './studioMath';

const BAR_W = 14;

export function HeatmapChart({ spec, ...c }: { spec: HeatmapSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'heatmap');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const nx = Math.max(0, spec.xEdges.length - 1);
  const ny = Math.max(0, spec.yEdges.length - 1);
  const max = Math.max(0, ...spec.counts.flat());
  const total = spec.counts.flat().reduce((s, v) => s + v, 0);
  const range = (a: number, b: number) => `${formatValue(a, locale)} – ${formatValue(b, locale)}`;
  const rows: string[][] = [];
  for (let yi = ny - 1; yi >= 0; yi--)
    for (let xi = 0; xi < nx; xi++) {
      const v = spec.counts[yi][xi];
      if (v > 0) rows.push([range(spec.xEdges[xi], spec.xEdges[xi + 1]), range(spec.yEdges[yi], spec.yEdges[yi + 1]), formatValue(v, locale)]);
    }
  const [sel, setSel] = useState<[number, number] | null>(null);

  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${xName} / ${yName}. ${tr(t, 'ariaCells', { count: nx * ny })}. ${tr(t, 'n')} = ${formatValue(total, locale)}.`}
      table={{ columns: [xName, yName, tr(t, 'count')], rows, numeric: [true, true, true] }}
      plotHeight={(w) => clamp(Math.round(w * 0.6), 260, 480)}
    >
      {(area) => {
        if (!nx || !ny || max <= 0) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const xCount = clamp(Math.floor(area.width / 90), 3, 10);
        const yCount = clamp(Math.floor(area.height / 48), 3, 9);
        const xt = applyDomain({ ...ticksWithin(spec.xEdges[0], spec.xEdges[nx], xCount), domain: [spec.xEdges[0], spec.xEdges[nx]] }, style?.xMin, style?.xMax, xCount);
        const yt = applyDomain({ ...ticksWithin(spec.yEdges[0], spec.yEdges[ny], yCount), domain: [spec.yEdges[0], spec.yEdges[ny]] }, style?.yMin, style?.yMax, yCount);
        const fx = tickFormatter(xt.step, xt.ticks, locale);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const barLabW = Math.ceil(measureText(formatValue(max, locale), FONT.tick * fs));
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, xTitle: xName, right: BAR_W + barLabW + 28, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sx = linearScale(xt.domain, [m.left, m.left + plotW]);
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const tip = area.tip;
        const barX = m.left + plotW + 16;
        const barH = Math.min(plotH, 180);
        const barTop = m.top + 16;
        const gradId = area.uid + '-hg';
        const stops = Array.from({ length: 9 }, (_, i) => i / 8);
        const barTicks = [1, 0.5, 0].map((p) => ({ p, v: Math.max(1, Math.round(p * p * max)) }));

        const cellAt = (e: { clientX: number; clientY: number }, rc: DOMRect): [number, number] | null => {
          const px = e.clientX - rc.left + m.left;
          const py = e.clientY - rc.top + m.top;
          const vx = sx.invert(px);
          const vy = sy.invert(py);
          let xi = -1;
          let yi = -1;
          for (let i = 0; i < nx; i++) if (vx >= spec.xEdges[i] && vx <= spec.xEdges[i + 1]) (xi = i), (i = nx);
          for (let j = 0; j < ny; j++) if (vy >= spec.yEdges[j] && vy <= spec.yEdges[j + 1]) (yi = j), (j = ny);
          return xi < 0 || yi < 0 ? null : [xi, yi];
        };
        const tipFor = (xi: number, yi: number) => ({
          title: undefined,
          rows: [
            { label: tr(t, 'count'), value: formatValue(spec.counts[yi][xi], locale), key: 'none' as const },
            { label: xName, value: range(spec.xEdges[xi], spec.xEdges[xi + 1]), key: 'none' as const },
            { label: yName, value: range(spec.yEdges[yi], spec.yEdges[yi + 1]), key: 'none' as const },
          ],
        });
        const cellCentre = (xi: number, yi: number) => ({ x: sx((spec.xEdges[xi] + spec.xEdges[xi + 1]) / 2), y: sy((spec.yEdges[yi] + spec.yEdges[yi + 1]) / 2) });
        const onMove = (e: PointerEvent<SVGRectElement>) => {
          const cell = cellAt(e, e.currentTarget.getBoundingClientRect());
          setSel(cell);
          if (cell) tip.show(e, tipFor(cell[0], cell[1]));
          else tip.hide();
        };
        const onKey = (e: KeyboardEvent<SVGRectElement>) => {
          let [xi, yi] = sel ?? [0, 0];
          if (e.key === 'ArrowRight') xi = Math.min(nx - 1, xi + 1);
          else if (e.key === 'ArrowLeft') xi = Math.max(0, xi - 1);
          else if (e.key === 'ArrowUp') yi = Math.min(ny - 1, yi + 1);
          else if (e.key === 'ArrowDown') yi = Math.max(0, yi - 1);
          else if (e.key === 'Escape') {
            setSel(null);
            tip.hide();
            return;
          } else return;
          e.preventDefault();
          setSel([xi, yi]);
          const rc = e.currentTarget.getBoundingClientRect();
          const cc = cellCentre(xi, yi);
          tip.show({ clientX: rc.left + cc.x - m.left, clientY: rc.top + cc.y - m.top }, tipFor(xi, yi));
        };
        const leave = () => {
          setSel(null);
          tip.hide();
        };
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-hm'}>
                <rect x={m.left} y={m.top} width={plotW} height={plotH} />
              </clipPath>
              <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
                {stops.map((p) => (
                  <stop key={p} offset={p} style={{ stopColor: rampColor(Math.max(0.0001, p * p) * max, max) }} />
                ))}
              </linearGradient>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <XAxis axis={{ scale: sx, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
            <g clipPath={`url(#${area.uid}-hm)`}>
              {spec.counts.map((row, yi) =>
                row.map((v, xi) => {
                  if (v <= 0) return null;
                  const xa = sx(spec.xEdges[xi]);
                  const xb = sx(spec.xEdges[xi + 1]);
                  const ya = sy(spec.yEdges[yi + 1]);
                  const yb = sy(spec.yEdges[yi]);
                  return <rect key={yi + ':' + xi} x={xa} y={ya} width={Math.max(0, xb - xa)} height={Math.max(0, yb - ya)} style={{ fill: rampColor(v, max), stroke: 'var(--c-surface)', strokeWidth: 0.5 }} />;
                }),
              )}
            </g>
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            {sel && (
              <rect
                data-export="omit"
                pointerEvents="none"
                x={sx(spec.xEdges[sel[0]])}
                y={sy(spec.yEdges[sel[1] + 1])}
                width={Math.max(0, sx(spec.xEdges[sel[0] + 1]) - sx(spec.xEdges[sel[0]]))}
                height={Math.max(0, sy(spec.yEdges[sel[1]]) - sy(spec.yEdges[sel[1] + 1]))}
                style={{ fill: 'none', stroke: 'var(--c-ink)', strokeWidth: 1.5 }}
              />
            )}
            <rect
              data-export="omit"
              className="pspp-chart__hit"
              x={m.left}
              y={m.top}
              width={plotW}
              height={plotH}
              tabIndex={0}
              role="graphics-symbol"
              aria-label={`${xName} / ${yName}`}
              onPointerMove={onMove}
              onPointerLeave={leave}
              onKeyDown={onKey}
              onBlur={leave}
            />
            <g aria-hidden="true">
              <text className="pspp-chart__legend-text" x={barX} y={barTop - 8} style={{ fontSize: 12 * fs }}>
                {tr(t, 'count')}
              </text>
              <rect x={barX} y={barTop} width={BAR_W} height={barH} rx={2} style={{ fill: `url(#${gradId})`, stroke: 'var(--c-axis)', strokeWidth: 1 }} />
              {barTicks.map(({ p, v }) => (
                <text key={p} className="pspp-chart__tick" x={barX + BAR_W + 6} y={barTop + barH * (1 - p)} dominantBaseline="central">
                  {formatValue(v, locale)}
                </text>
              ))}
            </g>
            <AxisTitles xTitle={xName} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
