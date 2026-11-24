/* Violin plot: a mirrored density per category with median and quartile marks.  Studio only
   (ViolinSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, Baseline, ChartShell, FONT, YAxis, markTip, plotMargins, seriesColor, type ChartCommonProps } from './shell';
import { clamp, formatValue, linearScale, niceTicks, padExtent, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { ViolinSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';
import { mirrorPath } from './studioMath';

export function ViolinChart({ spec, ...c }: { spec: ViolinSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const title = spec.title || tr(t, 'violinPlot');
  const vs = spec.violins;
  const n = vs.length;
  const yName = spec.ylabel || tr(t, 'value');
  const fv = (v: number) => formatValue(v, locale, 3);
  const color = seriesColor(0);
  const anyLabel = vs.some((v) => v.label);
  const range = (v: ViolinSpec['violins'][number]) => [v.points[0][0], v.points[v.points.length - 1][0]] as const;
  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${tr(t, 'ariaViolins', { count: n })}. ${vs.map((v) => `${v.label ? v.label + ': ' : ''}${tr(t, 'median')} ${fv(v.median)}, ${tr(t, 'q1')} ${fv(v.q1)}, ${tr(t, 'q3')} ${fv(v.q3)}`).join('; ')}.`}
      table={{
        columns: [tr(t, 'group'), tr(t, 'minimum'), tr(t, 'q1'), tr(t, 'median'), tr(t, 'q3'), tr(t, 'maximum')],
        rows: vs.map((v) => [v.label || title, fv(range(v)[0]), fv(v.q1), fv(v.median), fv(v.q3), fv(range(v)[1])]),
        numeric: [false, true, true, true, true, true],
      }}
    >
      {(area) => {
        if (!n) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const lo = Math.min(...vs.map((v) => Math.min(range(v)[0], v.q1)));
        const hi = Math.max(...vs.map((v) => Math.max(range(v)[1], v.q3)));
        const [d0, d1] = padExtent(lo, hi, 0.04);
        const yCount = clamp(Math.floor(area.height / 48), 3, 8);
        const yt = applyDomain(niceTicks(d0, d1, yCount), style?.yMin, style?.yMax, yCount);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, xTickLabels: anyLabel, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const band = plotW / n;
        area.reg.x = (i: number) => m.left + band * (i + 0.5);
        area.reg.top = m.top;
        area.reg.height = plotH;
        // one density scale for all violins so their widths stay comparable
        const maxD = Math.max(1e-12, ...vs.flatMap((v) => v.points.map((p) => p[1])));
        const halfMax = clamp(band * 0.42, 8, 90);
        const hw = (d: number) => (d / maxD) * halfMax;
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-vp'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <g clipPath={`url(#${area.uid}-vp)`}>
              {vs.map((v, i) => {
                const cx = m.left + band * (i + 0.5);
                const tip = {
                  title: v.label || undefined,
                  rows: [
                    { label: tr(t, 'maximum'), value: fv(range(v)[1]), key: 'none' as const },
                    { label: tr(t, 'q3'), value: fv(v.q3), key: 'none' as const },
                    { label: tr(t, 'median'), value: fv(v.median), color: 'var(--c-ink)', key: 'marker' as const, shape: 'circle' as const },
                    { label: tr(t, 'q1'), value: fv(v.q1), key: 'none' as const },
                    { label: tr(t, 'minimum'), value: fv(range(v)[0]), key: 'none' as const },
                  ],
                };
                const boxW = clamp(halfMax * 0.16, 3, 8);
                return (
                  <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip, `${v.label ? v.label + ': ' : ''}${tr(t, 'median')} ${fv(v.median)}, ${tr(t, 'q1')} ${fv(v.q1)}, ${tr(t, 'q3')} ${fv(v.q3)}`)}>
                    <rect x={cx - halfMax - 4} y={m.top} width={2 * halfMax + 8} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    <path d={mirrorPath(v.points, cx, hw, sy)} style={{ fill: color, fillOpacity: 0.28, stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round' }} />
                    <rect x={cx - boxW / 2} y={sy(v.q3)} width={boxW} height={Math.max(1, sy(v.q1) - sy(v.q3))} rx={boxW / 2} style={{ fill: 'var(--c-ink-2)' }} />
                    <circle cx={cx} cy={sy(v.median)} r={Math.max(3, boxW * 0.7)} style={{ fill: 'var(--c-surface)', stroke: 'var(--c-ink)', strokeWidth: 1.5 }} />
                  </g>
                );
              })}
            </g>
            {vs.map((v, i) =>
              v.label ? (
                <text key={'l' + i} className="pspp-chart__tick pspp-chart__tick--cat" x={m.left + band * (i + 0.5)} y={m.top + plotH + 15} textAnchor="middle">
                  {truncateText(v.label, band - 4, FONT.tick)}
                </text>
              ) : null,
            )}
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            <AxisTitles xTitle={undefined} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
