/* Kernel density curves, one per group, optionally filled, on a shared x axis.  Studio only
   (DensitySpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AxisTitles, Baseline, ChartShell, FONT, XAxis, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, niceTicks, padExtent, tickFormatter, truncateText } from './scale';
import { interpolate, ridgeOffsets } from './phase4Math';
import { useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { tr } from './strings';
import type { DensitySpec } from './studioTypes';
import { XYPlot, extent, xCount, xyTable, yCount, type Fill, type XYSeries } from './xy';

export function DensityChart({ spec, ...c }: { spec: DensitySpec } & ChartCommonProps) {
  if (spec.layout === 'ridge' && spec.curves.some((cv) => cv.points.length > 1)) return <RidgeChart spec={spec} {...c} />;
  return <OverlayDensity spec={spec} {...c} />;
}

/** How far a peak rises above its baseline, in row steps (curves of neighbouring rows overlap). */
const OVERLAP = 1.7;

/** Ridge layout: one baseline per group, the curves offset vertically, group names on the left, one shared density scale. */
function RidgeChart({ spec, ...c }: { spec: DensitySpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'densityPlot');
  const xName = spec.xlabel || tr(t, 'value');
  const yName = spec.ylabel || tr(t, 'density');
  const curves = spec.curves.map((cv, i) => ({ name: cv.name || `${tr(t, 'curve')} ${i + 1}`, color: seriesColor(i), points: cv.points }));
  const n = curves.length;
  const [sel, setSel] = useState<{ ci: number; x: number } | null>(null);
  const table = {
    columns: [tr(t, 'curve'), xName, yName],
    rows: curves.flatMap((cv) => cv.points.map((p) => [cv.name, formatValue(p[0], locale), formatValue(p[1], locale, 4)])),
    numeric: [false, true, true],
  };
  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${tr(t, 'ariaCurves', { count: n })}: ${curves.map((s) => s.name).join(', ')}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(n * 34 + 100 + w * 0.08), 240, 620)}
    >
      {(area) => {
        const size = FONT.tick * fs;
        const all = curves.flatMap((cv) => cv.points);
        const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
        const maxD = Math.max(1e-12, ...all.map((p) => p[1]));
        const xc = clamp(Math.floor(area.width / 90), 3, 10);
        const xd = padExtent(x0, x1, 0.02);
        const xt = applyDomain(niceTicks(xd[0], xd[1], xc), style?.xMin, style?.xMax, xc);
        const fx = tickFormatter(xt.step, xt.ticks, locale);
        const labels = curves.map((cv) => truncateText(cv.name, area.width * 0.3, size));
        const m = plotMargins({ yTickLabels: labels, yTitle: undefined, xTitle: xName, style });
        const plotW = Math.max(40, area.width - m.left - m.right);
        const plotH = Math.max(40, area.height - m.top - m.bottom);
        const sx = linearScale(xt.domain, [m.left, m.left + plotW]);
        const rid = ridgeOffsets(n, m.top, plotH, OVERLAP, maxD);
        const tip = area.tip;
        const clipId = area.uid + '-rg';
        const pathOf = (cv: (typeof curves)[number], base: number) => cv.points.map((p) => `${sx(p[0]).toFixed(1)},${(base - p[1] * rid.unit).toFixed(1)}`).join('L');
        const heightAt = (ci: number, x: number) => {
          const d = interpolate(curves[ci].points, x);
          return d === null ? null : d * rid.unit;
        };
        const tipFor = (ci: number, x: number) => ({
          title: curves[ci].name,
          rows: [
            { label: yName, value: formatValue(interpolate(curves[ci].points, x), locale, 4), color: curves[ci].color, key: 'line' as const },
            { label: xName, value: formatValue(x, locale), key: 'none' as const },
          ],
        });
        const onMove = (e: PointerEvent<SVGRectElement>) => {
          const rc = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rc.left + m.left;
          const py = e.clientY - rc.top + m.top;
          const x = sx.invert(px);
          // the front-most curve whose area contains the pointer, else the nearest baseline
          let ci = -1;
          for (let i = n - 1; i >= 0 && ci < 0; i--) {
            const h = heightAt(i, x);
            if (h !== null && py <= rid.baselines[i] + 3 && py >= rid.baselines[i] - h - 3) ci = i;
          }
          if (ci < 0) ci = rid.baselines.reduce((best, b, i) => (Math.abs(b - py) < Math.abs(rid.baselines[best] - py) ? i : best), 0);
          if (interpolate(curves[ci].points, x) === null) {
            setSel(null);
            tip.hide();
            return;
          }
          setSel({ ci, x });
          tip.show(e, tipFor(ci, x));
        };
        const onKey = (e: KeyboardEvent<SVGRectElement>) => {
          const cur = sel ?? { ci: 0, x: (x0 + x1) / 2 };
          let { ci, x } = cur;
          const pts = curves[ci].points;
          const step = (x1 - x0) / 40;
          if (e.key === 'ArrowRight') x = Math.min(pts[pts.length - 1][0], x + step);
          else if (e.key === 'ArrowLeft') x = Math.max(pts[0][0], x - step);
          else if (e.key === 'ArrowUp') ci = Math.max(0, ci - 1);
          else if (e.key === 'ArrowDown') ci = Math.min(n - 1, ci + 1);
          else if (e.key === 'Escape') {
            setSel(null);
            tip.hide();
            return;
          } else return;
          e.preventDefault();
          x = clamp(x, curves[ci].points[0][0], curves[ci].points[curves[ci].points.length - 1][0]);
          setSel({ ci, x });
          const rc = e.currentTarget.getBoundingClientRect();
          tip.show({ clientX: rc.left + sx(x) - m.left, clientY: rc.top + rid.baselines[ci] - (heightAt(ci, x) ?? 0) - m.top }, tipFor(ci, x));
        };
        const leave = () => {
          setSel(null);
          tip.hide();
        };
        const hx = sel ? sx(sel.x) : 0;
        const hy = sel ? rid.baselines[sel.ci] - (heightAt(sel.ci, sel.x) ?? 0) : 0;
        return (
          <g>
            <defs>
              <clipPath id={clipId}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <XAxis axis={{ scale: sx, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} grid />
            <g aria-hidden="true">
              {curves.map((_cv, i) => (
                <g key={i}>
                  <line className="pspp-chart__grid" x1={m.left} x2={m.left + plotW} y1={Math.round(rid.baselines[i]) + 0.5} y2={Math.round(rid.baselines[i]) + 0.5} />
                  <text className="pspp-chart__tick pspp-chart__tick--cat" x={m.left - 8} y={rid.baselines[i] - 2} textAnchor="end">
                    {labels[i]}
                  </text>
                </g>
              ))}
            </g>
            <g clipPath={`url(#${clipId})`} aria-hidden="true">
              {/* back to front: the first group is at the top, later rows overlap it */}
              {curves.map((cv, i) => {
                if (cv.points.length < 2) return null;
                const base = rid.baselines[i];
                const line = pathOf(cv, base);
                const first = cv.points[0][0];
                const last = cv.points[cv.points.length - 1][0];
                return (
                  <g key={i}>
                    <path d={`M${sx(first).toFixed(1)},${base}L${line}L${sx(last).toFixed(1)},${base}Z`} style={{ fill: spec.fill ? `color-mix(in srgb, ${cv.color} 55%, var(--c-surface))` : 'var(--c-surface)', stroke: 'none' }} />
                    <path d={'M' + line} className="pspp-chart__line" style={{ stroke: cv.color }} />
                  </g>
                );
              })}
            </g>
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            {sel && (
              <g data-export="omit" pointerEvents="none">
                <circle cx={hx} cy={hy} r={5} className="pspp-chart__hover-ring" />
                <circle cx={hx} cy={hy} r={3} style={{ fill: curves[sel.ci].color }} />
              </g>
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
            <AxisTitles xTitle={xName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}

function OverlayDensity({ spec, ...c }: { spec: DensitySpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'densityPlot');
  const xName = spec.xlabel || tr(t, 'value');
  const yName = spec.ylabel || tr(t, 'density');
  const named = spec.curves.length > 1;
  const series: XYSeries[] = spec.curves.map((cv, i) => ({ name: cv.name || `${tr(t, 'curve')} ${i + 1}`, color: seriesColor(i), shape: 'circle', points: cv.points, line: true, markers: false }));
  const legend: LegendItem[] | undefined = named ? series.map((s) => ({ label: s.name, kind: 'line', color: s.color })) : undefined;
  const fills: Fill[] = spec.fill ? series.filter((s) => s.points.length > 1).map((s) => ({ color: s.color, pts: s.points, base: 0 })) : [];
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaCurves', { count: series.length })}${named ? ': ' + series.map((s) => s.name).join(', ') : ''}.`}
      table={{ ...xyTable(xName, yName, series, locale, named ? tr(t, 'curve') : undefined) }}
    >
      {(area) => {
        const all = series.flatMap((s) => s.points);
        const [x0, x1] = extent(all.map((p) => p[0]));
        const yMax = Math.max(0, ...all.map((p) => p[1]));
        const xd = padExtent(x0, x1, 0.02);
        const xt = niceTicks(xd[0], xd[1], xCount(area.width));
        const yt = niceTicks(0, yMax * 1.06 || 1, yCount(area.height));
        return (
          <XYPlot
            emptyText={tr(t, 'noData')}
            area={area}
            locale={locale}
            x={xt}
            y={yt}
            xTitle={xName}
            yTitle={yName}
            series={series}
            fills={fills}
            tipFor={(s, p) => ({
              title: named ? s.name : undefined,
              rows: [
                { label: yName, value: formatValue(p[1], locale, 4), color: s.color, key: 'line', shape: s.shape },
                { label: xName, value: formatValue(p[0], locale), key: 'none' },
              ],
            })}
          />
        );
      }}
    </ChartShell>
  );
}
