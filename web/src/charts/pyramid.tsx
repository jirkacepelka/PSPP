/* Population pyramid: two back to back histograms over shared bins.  Studio only (PyramidSpec in
   studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, ChartShell, FONT, XAxis, markTip, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, measureText, niceTicks, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { PyramidSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';

export function PyramidChart({ spec, ...c }: { spec: PyramidSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'pyramid');
  const left = spec.leftName || tr(t, 'group');
  const right = spec.rightName || tr(t, 'group');
  const bins = spec.bins;
  const binLabel = (b: PyramidSpec['bins'][number]) => `${formatValue(b[0], locale)} – ${formatValue(b[1], locale)}`;
  const legend: LegendItem[] = [
    { label: left, kind: 'rect', color: seriesColor(0) },
    { label: right, kind: 'rect', color: seriesColor(1) },
  ];
  const freq = tr(t, 'frequency');

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaBins', { count: bins.length })}. ${left}, ${right}.`}
      table={{
        columns: [spec.xlabel || tr(t, 'interval'), left, right],
        rows: bins.map((b) => [binLabel(b), formatValue(b[2], locale), formatValue(b[3], locale)]),
        numeric: [false, true, true],
      }}
      plotHeight={() => clamp(Math.round(bins.length * 22 + 80), 240, 560)}
    >
      {(area) => {
        if (!bins.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const maxC = Math.max(1, ...bins.map((b) => Math.max(b[2], b[3])));
        const xCount = clamp(Math.floor(area.width / 100), 2, 5);
        const half = niceTicks(0, maxC, xCount);
        // symmetric domain; ticks mirrored around zero
        const dom: [number, number] = [-half.domain[1], half.domain[1]];
        const sym = applyDomain({ ticks: [...half.ticks.filter((v) => v > 0).map((v) => -v).reverse(), ...half.ticks], step: half.step, domain: dom }, style?.xMin, style?.xMax, xCount * 2);
        const fAbs = tickFormatter(half.step, half.ticks, locale);
        const fx = (v: number) => fAbs(Math.abs(v));
        const labels = bins.map(binLabel);
        const labW = Math.min(area.width * 0.25, Math.max(...labels.map((l) => measureText(l, FONT.tick * fs))) + 2);
        const m = plotMargins({ yTickLabels: labels.map((l) => truncateText(l, labW, FONT.tick * fs)), yTitle: spec.xlabel, xTitle: freq, right: 16, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sx = linearScale(sym.domain, [m.left, m.left + plotW]);
        const band = plotH / bins.length;
        const slot = Math.max(1, band - Math.min(3, band * 0.15));
        const yAt = (i: number) => m.top + plotH - band * (i + 0.5);
        const v0 = bins[0][0];
        const v1 = bins[bins.length - 1][1];
        const sv = linearScale([v0, v1], [m.top + plotH, m.top]);
        area.reg.y = sv;
        area.reg.x = sx;
        area.reg.left = m.left;
        area.reg.width = plotW;
        area.reg.top = m.top;
        area.reg.height = plotH;
        const zero = Math.round(sx(0)) + 0.5;
        const every = Math.max(1, Math.ceil(16 / band));
        const showValues = style?.valueLabels === true && band >= FONT.label * fs - 2;
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-pyc'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <XAxis axis={{ scale: sx, ticks: sym.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} grid />
            <g clipPath={`url(#${area.uid}-pyc)`}>
              {bins.map((b, i) => {
                const y = yAt(i) - slot / 2;
                const tip = {
                  title: labels[i],
                  rows: [
                    { label: left, value: formatValue(b[2], locale), color: seriesColor(0), key: 'rect' as const },
                    { label: right, value: formatValue(b[3], locale), color: seriesColor(1), key: 'rect' as const },
                  ],
                };
                return (
                  <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip, `${labels[i]}: ${left} ${formatValue(b[2], locale)}, ${right} ${formatValue(b[3], locale)}`)}>
                    <rect x={m.left} y={y - 1} width={plotW} height={slot + 2} className="pspp-chart__hitband" data-export="omit" />
                    {b[2] > 0 && <rect x={sx(-b[2])} y={y} width={Math.max(0, zero - sx(-b[2]))} height={slot} rx={Math.min(3, slot / 2)} style={{ fill: seriesColor(0) }} />}
                    {b[3] > 0 && <rect x={zero} y={y} width={Math.max(0, sx(b[3]) - zero)} height={slot} rx={Math.min(3, slot / 2)} style={{ fill: seriesColor(1) }} />}
                    {showValues && b[2] > 0 && (
                      <text className="pspp-chart__value" x={sx(-b[2]) - 4} y={yAt(i)} textAnchor="end" dominantBaseline="central">
                        {formatValue(b[2], locale)}
                      </text>
                    )}
                    {showValues && b[3] > 0 && (
                      <text className="pspp-chart__value" x={sx(b[3]) + 4} y={yAt(i)} textAnchor="start" dominantBaseline="central">
                        {formatValue(b[3], locale)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            <line className="pspp-chart__baseline" x1={zero} x2={zero} y1={m.top} y2={m.top + plotH} aria-hidden="true" />
            <g className="pspp-chart__axis" aria-hidden="true">
              {bins.map((_b, i) =>
                i % every ? null : (
                  <text key={i} className="pspp-chart__tick pspp-chart__tick--cat" x={m.left - 8} y={yAt(i)} textAnchor="end" dominantBaseline="central">
                    {truncateText(labels[i], labW, FONT.tick * fs)}
                  </text>
                ),
              )}
            </g>
            <AxisTitles xTitle={freq} yTitle={spec.xlabel} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
