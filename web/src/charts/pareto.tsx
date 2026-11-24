/* Pareto chart: bars sorted by count plus the cumulative percentage line on a 0-100% axis.
   Studio only (ParetoSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, Baseline, ChartShell, FONT, Marker, YAxis, barPath, markTip, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatPercent, formatValue, linearScale, measureText, ticksWithin, tickFormatter, type Ticks } from './scale';
import { tr } from './strings';
import type { ParetoSpec } from './studioTypes';
import { avoidText, axisTitle, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { cumulativePercent } from './studioMath';
import { catLabels } from './bar';

const MAX_BAR = 40;

export function ParetoChart({ spec, ...c }: { spec: ParetoSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'paretoChart');
  const yName = spec.ylabel || tr(t, 'count');
  const xT = axisTitle(style, 'x', spec.xlabel);
  const n = spec.bars.length;
  const cum = cumulativePercent(spec.bars.map((b) => b.count), spec.total);
  const cumName = tr(t, 'cumulativePercent');
  const legend: LegendItem[] = [
    { label: yName, kind: 'rect', color: seriesColor(0) },
    { label: cumName, kind: 'line', color: seriesColor(1) },
  ];
  const pctText = (p: number) => formatPercent(p / 100, locale);

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaBars', { count: n })}: ${spec.bars
        .slice(0, 30)
        .map((b, i) => `${b.label} ${formatValue(b.count, locale)}, ${cumName} ${pctText(cum[i])}`)
        .join('; ')}.`}
      table={{
        columns: [tr(t, 'category'), yName, tr(t, 'percent'), cumName],
        rows: spec.bars.map((b, i) => [b.label, formatValue(b.count, locale), pctText(spec.total ? (b.count * 100) / spec.total : 0), pctText(cum[i])]),
        numeric: [false, true, true, true],
      }}
      plotHeight={(w) => clamp(Math.round(w * 0.56), 240, 420) + catLabels(spec.bars.map((b) => b.label), Math.max(1, (w - 120) / Math.max(1, n))).labelBand - 18 + (xT ? 20 : 0)}
    >
      {(area) => {
        if (!n || spec.total <= 0) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const yCount = clamp(Math.floor(area.height / 48), 3, 8);
        // Left max = total, so 100 percent sits on the top gridline.  The left ticks are the percent ticks
        // (0, 20 ... 100 percent of the total) so both axes share their gridlines; an explicit axis range
        // from the style falls back to nice count ticks.
        const overridden = style?.yMin != null || style?.yMax != null;
        const pStep = area.height < 200 ? 50 : area.height < 300 ? 25 : 20;
        const yBase: Ticks = overridden
          ? ticksWithin(0, spec.total, yCount)
          : { ticks: Array.from({ length: 100 / pStep + 1 }, (_, i) => (i * pStep * spec.total) / 100), step: (pStep * spec.total) / 100, domain: [0, spec.total] };
        const yt = applyDomain(yBase, style?.yMin, style?.yMax, yCount);
        const fy = overridden ? tickFormatter(yt.step, yt.ticks, locale) : (v: number) => formatValue(v, locale, spec.total >= 100 ? 0 : spec.total >= 10 ? 1 : 2);
        const rightW = Math.ceil(measureText('100%', FONT.tick * fs)) + 12;
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, right: rightW, style });
        const plotW = area.width - m.left - m.right;
        const band = plotW / n;
        const labels = spec.bars.map((b) => b.label);
        const { mode, every, labels: rot, labelBand } = catLabels(labels, band);
        const showValues = style?.valueLabels === true && n <= 24;
        const top = m.top + (showValues ? 14 * fs : 0);
        const plotH = area.height - top - labelBand - 4 - (xT ? 20 : 0);
        const sy = linearScale(yt.domain, [top + plotH, top]);
        const base = sy(clamp(0, yt.domain[0], yt.domain[1]));
        const barW = Math.min(MAX_BAR, band * 0.7);
        const xAt = (i: number) => m.left + band * (i + 0.5);
        // the cumulative line uses the count scale: p percent sits at p/100 of the total
        const py = (p: number) => sy((p * spec.total) / 100);
        area.reg.x = xAt;
        area.reg.top = top;
        area.reg.height = plotH;
        const pctTicks = (overridden ? [0, 20, 40, 60, 80, 100] : Array.from({ length: 100 / pStep + 1 }, (_, i) => i * pStep)).filter((p) => py(p) >= top - 0.5 && py(p) <= top + plotH + 0.5);
        const line = cum.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${py(p).toFixed(1)}`).join('');
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-pc'}>
                <rect x={m.left - 6} y={top - 8} width={plotW + 12} height={plotH + 14} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <g className="pspp-chart__axis" aria-hidden="true">
              {pctTicks.map((p) => (
                <text key={p} className="pspp-chart__tick" x={m.left + plotW + 8} y={py(p)} dominantBaseline="central">
                  {pctText(p)}
                </text>
              ))}
            </g>
            <g clipPath={`url(#${area.uid}-pc)`}>
              {spec.bars.map((b, i) => {
                const tip = {
                  title: b.label,
                  rows: [
                    { label: yName, value: formatValue(b.count, locale), color: seriesColor(0), key: 'rect' as const },
                    { label: tr(t, 'percent'), value: pctText((b.count * 100) / spec.total), key: 'none' as const },
                    { label: cumName, value: pctText(cum[i]), color: seriesColor(1), key: 'line' as const },
                  ],
                };
                return (
                  <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip, `${b.label}: ${formatValue(b.count, locale)}, ${cumName} ${pctText(cum[i])}`)}>
                    <rect x={xAt(i) - band / 2} y={top} width={band} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    <path d={barPath(xAt(i) - barW / 2, barW, base, sy(b.count))} style={{ fill: seriesColor(0) }} />
                  </g>
                );
              })}
              <path className="pspp-chart__line" d={line} style={{ stroke: seriesColor(1) }} pointerEvents="none" />
              {cum.map((p, i) => (
                <Marker key={i} shape="circle" x={xAt(i)} y={py(p)} r={n > 24 ? 2 : 3.5} color={seriesColor(1)} />
              ))}
            </g>
            {showValues && (
              <g aria-hidden="true" pointerEvents="none">
                {spec.bars.map((b, i) => {
                  const ly = Math.min(sy(b.count), base) - 5;
                  avoidText(area.reg, xAt(i), ly, measureText(formatValue(b.count, locale), FONT.label * fs), FONT.label * fs);
                  return (
                    <text key={'v' + i} className="pspp-chart__value" x={xAt(i)} y={ly} textAnchor="middle">
                      {formatValue(b.count, locale)}
                    </text>
                  );
                })}
              </g>
            )}
            {spec.bars.map((_b, i) =>
              i % every ? null : mode === 'flat' ? (
                <text key={'l' + i} className="pspp-chart__tick pspp-chart__tick--cat" x={xAt(i)} y={top + plotH + 15} textAnchor="middle">
                  {rot[i]}
                </text>
              ) : (
                <text
                  key={'l' + i}
                  className="pspp-chart__tick pspp-chart__tick--cat"
                  transform={`translate(${xAt(i)} ${top + plotH + 8}) rotate(${mode === 'tilt' ? -45 : -90})`}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {rot[i]}
                </text>
              ),
            )}
            <Baseline x1={m.left} x2={m.left + plotW} y={base} />
            <AxisTitles xTitle={spec.xlabel} yTitle={yName} left={m.left} top={top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
