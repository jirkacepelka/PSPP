/* Radar chart: one translucent polygon per series on spokes (one per axis), concentric grid rings.  Studio only
   (RadarSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, FONT, Marker, markTip, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, measureText, niceTicks, tickFormatter, ticksWithin, wrapText } from './scale';
import { radarAngle, radarFraction, radarPath, radarPoint, radarRange } from './phase4Math';
import { EmptyPlot } from './p4shared';
import { tr } from './strings';
import type { RadarSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';

export function RadarChart({ spec, ...c }: { spec: RadarSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'radarChart');
  const n = spec.axes.length;
  const named = spec.series.length > 1;
  const sName = (s: { name: string }, i: number) => s.name || `${tr(t, 'variable')} ${i + 1}`;
  const legend: LegendItem[] | undefined = named ? spec.series.map((s, i) => ({ label: sName(s, i), kind: 'rect' as const, color: seriesColor(i) })) : undefined;
  const fv = (v: number | null) => formatValue(v, locale);
  const table = {
    columns: [tr(t, 'axis'), ...spec.series.map((s, i) => sName(s, i))],
    rows: spec.axes.map((a, ai) => [a, ...spec.series.map((s) => fv(s.values[ai]))]),
    numeric: [false, ...spec.series.map(() => true)],
  };

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaAxes', { count: n })}: ${spec.axes.slice(0, 20).join(', ')}. ${tr(t, 'ariaLines', { count: spec.series.length })}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(w * 0.78), 300, 520)}
    >
      {(area) => {
        if (n < 3 || !spec.series.length) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const size = FONT.tick * fs;
        const [dMin, dMax] = radarRange(spec.series.map((s) => s.values), spec.min, spec.max);
        const nice = niceTicks(dMin, dMax, 4);
        let lo = style?.yMin ?? spec.min ?? nice.domain[0];
        let hi = style?.yMax ?? spec.max ?? nice.domain[1];
        if (!(hi > lo)) [lo, hi] = [dMin, dMax];
        const ring = ticksWithin(lo, hi, 4);
        const fr = tickFormatter(ring.step, ring.ticks, locale);
        // axis names wrap to two lines inside a side margin of about a fifth of the width
        const labelMax = Math.ceil(Math.min(Math.max(56, area.width * 0.2), Math.max(...spec.axes.map((a) => measureText(a, size)))));
        const lineH = size + 2;
        const wrapped = spec.axes.map((a) => wrapText(a, labelMax, size, 400, 2));
        const R = Math.max(30, Math.min(area.height / 2 - 2 * lineH - 8, area.width / 2 - labelMax - 8));
        const cx = area.width / 2;
        const cy = area.height / 2;
        const grid = style?.grid !== false;
        const ringFracs = ring.ticks.filter((v) => v > lo).map((v) => radarFraction(v, lo, hi));
        const poly = (f: number) =>
          Array.from({ length: n }, (_, i) => {
            const [x, y] = radarPoint(cx, cy, R, i, n, f);
            return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
          }).join('') + 'Z';
        const fmtTip = (si: number, ai: number) => ({
          title: named ? sName(spec.series[si], si) : undefined,
          rows: [
            { label: spec.axes[ai], value: fv(spec.series[si].values[ai]), color: seriesColor(si), key: 'rect' as const },
          ],
        });
        return (
          <g>
            <g aria-hidden="true">
              {grid && ringFracs.map((f, k) => <path key={k} className="pspp-chart__grid" d={poly(f)} style={{ fill: 'none' }} />)}
              {spec.axes.map((_, i) => {
                const [x, y] = radarPoint(cx, cy, R, i, n, 1);
                return <line key={i} className="pspp-chart__grid" x1={cx} y1={cy} x2={x} y2={y} />;
              })}
              {grid &&
                ring.ticks
                  .filter((v) => v > lo)
                  .map((v, k) =>
                    // the rim label would run into the first axis name
                    ringFracs[k] >= 0.999 ? null : (
                      <text key={k} className="pspp-chart__halo" x={cx + 4} y={cy - R * ringFracs[k] - 2} style={{ fontSize: size }}>
                        {fr(v)}
                      </text>
                    ),
                  )}
              {spec.axes.map((_a, i) => {
                const ang = radarAngle(i, n);
                const lines = wrapped[i];
                const [x, y0] = radarPoint(cx, cy, R + 8, i, n, 1);
                const dx = Math.cos(ang);
                const dy = Math.sin(ang);
                const anchor = Math.abs(dx) < 0.25 ? 'middle' : dx > 0 ? 'start' : 'end';
                // names above the rim grow upwards, below it downwards, at the sides they are centred on the spoke
                const first = dy < -0.5 ? y0 - (lines.length - 1) * lineH - 4 : dy > 0.5 ? y0 + 6 : y0 - ((lines.length - 1) * lineH) / 2;
                return (
                  <text key={i} className="pspp-chart__tick pspp-chart__tick--cat" textAnchor={anchor} dominantBaseline="central">
                    {lines.map((l, k) => (
                      <tspan key={k} x={x} y={first + k * lineH}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                );
              })}
            </g>
            {spec.series.map((s, si) => (
              <path key={'p' + si} d={radarPath(cx, cy, R, s.values, lo, hi)} aria-hidden="true" style={{ fill: seriesColor(si), fillOpacity: 0.18, stroke: seriesColor(si), strokeWidth: 2, strokeLinejoin: 'round' }} />
            ))}
            {spec.series.map((s, si) =>
              s.values.map((v, ai) => {
                if (v === null) return null;
                const [x, y] = radarPoint(cx, cy, R, ai, n, radarFraction(v, lo, hi));
                return (
                  <g key={si + ':' + ai} className="pspp-chart__mark" {...markTip(area.tip, fmtTip(si, ai), `${named ? sName(s, si) + ', ' : ''}${spec.axes[ai]}: ${fv(v)}`)}>
                    <circle cx={x} cy={y} r={10} className="pspp-chart__hitband" data-export="omit" />
                    <Marker shape="circle" x={x} y={y} r={3.5} color={seriesColor(si)} />
                  </g>
                );
              }),
            )}
          </g>
        );
      }}
    </ChartShell>
  );
}
