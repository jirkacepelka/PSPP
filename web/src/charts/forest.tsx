/* Forest plot: estimates with intervals on a common (optionally logarithmic) axis, square markers sized by weight, a
   reference line, group headers and right-hand text columns.  Studio only (ForestSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, ChartShell, FONT, type ChartCommonProps } from './shell';
import { clamp, formatValue, linearScale, measureText, niceTicks, padExtent, tickFormatter, truncateText } from './scale';
import { forestItems, logTicks, weightSide } from './phase4Math';
import { EmptyPlot, tipProps } from './p4shared';
import { tr } from './strings';
import type { ForestSpec } from './studioTypes';
import { axisTitle, useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';

const FOCUS_MAX = 150;
const MIN_PLOT = 150;

export function ForestChart({ spec, ...c }: { spec: ForestSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'forestPlot');
  const xName = spec.xlabel || tr(t, 'estimate');
  const rows = spec.rows;
  const items = forestItems(rows);
  const hasWeight = rows.some((r) => r.weight !== null && r.weight !== undefined);
  const maxWeight = Math.max(0, ...rows.map((r) => r.weight ?? 0));
  // a log axis needs positive values everywhere (the reference value included); otherwise it stays linear
  const positive = rows.every((r) => r.lo > 0 && r.est > 0 && r.hi > 0) && spec.refValue > 0;
  const useLog = spec.log && positive;
  // fixed two decimals so the columns line up
  const nf2 = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f2 = (v: number) => nf2.format(v);
  const textOf = (r: ForestSpec['rows'][number]) => `${f2(r.est)} [${f2(r.lo)}, ${f2(r.hi)}]`;
  const xT = axisTitle(style, 'x', xName);
  const rowH = Math.round(24 * fs);
  const headH = Math.round(22 * fs);
  const axisH = Math.round((20 + (xT ? 22 : 0)) * fs);

  const table = {
    columns: [tr(t, 'category'), ...(rows.some((r) => r.group) ? [tr(t, 'group')] : []), tr(t, 'estimate'), tr(t, 'lowerBound'), tr(t, 'upperBound'), ...(hasWeight ? [tr(t, 'weight')] : [])],
    rows: rows.map((r) => [r.label, ...(rows.some((q) => q.group) ? [r.group ?? ''] : []), f2(r.est), f2(r.lo), f2(r.hi), ...(hasWeight ? [formatValue(r.weight, locale)] : [])]),
    numeric: [false, ...(rows.some((r) => r.group) ? [false] : []), true, true, true, ...(hasWeight ? [true] : [])],
    note: spec.log && !positive ? tr(t, 'logFallback') : undefined,
  };

  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${xName}. ${tr(t, 'ariaRows', { count: rows.length })}: ${rows
        .slice(0, 20)
        .map((r) => `${r.label} ${textOf(r)}`)
        .join('; ')}.`}
      table={table}
      plotHeight={() => 10 + headH + items.length * rowH + axisH + 8}
    >
      {(area) => {
        if (!rows.length) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const size = FONT.tick * fs;
        const labelMax = Math.max(...items.map((it) => (it.kind === 'header' ? measureText(it.label, size, 600) : measureText(it.row.label, size) + (rows.some((r) => r.group) ? 10 : 0))));
        const labelW = Math.ceil(Math.min(area.width * 0.34, Math.max(60, labelMax + 12)));
        const textW = Math.ceil(Math.max(measureText(tr(t, 'estimateInterval'), 12 * fs, 600), ...rows.map((r) => measureText(textOf(r), size)))) + 12;
        const showText = area.width - labelW - textW - 16 >= MIN_PLOT;
        const left = labelW;
        const plotW = Math.max(40, area.width - left - (showText ? textW + 8 : 12));
        const top = 10 + headH;
        const plotH = items.length * rowH;

        // axis domain and ticks
        const all = [...rows.flatMap((r) => [r.lo, r.hi]), spec.refValue];
        let lo = Math.min(...all);
        let hi = Math.max(...all);
        let ticks: number[];
        let sx: (v: number) => number;
        const wantLo = style?.xMin;
        const wantHi = style?.xMax;
        if (useLog) {
          const k = Math.pow(hi / lo, 0.06) || 1.05;
          lo = wantLo && wantLo > 0 ? wantLo : lo / k;
          hi = wantHi && wantHi > 0 ? wantHi : hi * k;
          if (!(hi > lo)) [lo, hi] = [lo / 2, lo * 2];
          const [l0, l1] = [Math.log(lo), Math.log(hi)];
          sx = (v) => left + ((Math.log(v) - l0) / (l1 - l0)) * plotW;
          ticks = logTicks(lo, hi, Math.max(3, Math.floor(plotW / 70)));
        } else {
          const pad = padExtent(lo, hi, 0.06);
          const nt = niceTicks(wantLo ?? pad[0], wantHi ?? pad[1], clamp(Math.floor(plotW / 70), 3, 8));
          lo = wantLo ?? nt.domain[0];
          hi = wantHi ?? nt.domain[1];
          if (!(hi > lo)) [lo, hi] = nt.domain;
          const lin = linearScale([lo, hi], [left, left + plotW]);
          sx = lin;
          ticks = nt.ticks.filter((v) => v >= lo && v <= hi);
        }
        const fmtTick = useLog ? (v: number) => formatValue(v, locale, 3) : tickFormatter(ticks.length > 1 ? ticks[1] - ticks[0] : 1, ticks, locale);
        area.reg.x = sx;
        area.reg.left = left;
        area.reg.width = plotW;
        area.reg.top = top;
        area.reg.height = plotH;
        const inside = (v: number) => v >= lo && v <= hi;
        const refX = sx(spec.refValue);
        const group = rows.some((r) => r.group);
        const focusable = rows.length <= FOCUS_MAX;
        const clip = area.uid + '-fp';
        const grid = style?.grid === true;

        return (
          <g>
            <defs>
              <clipPath id={clip}>
                <rect x={left} y={top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            {showText && (
              <text className="pspp-chart__legend-title" x={left + plotW + 12} y={10 + headH / 2} dominantBaseline="central" aria-hidden="true">
                {truncateText(tr(t, 'estimateInterval'), textW, 12 * fs, 600)}
              </text>
            )}
            <g aria-hidden="true">
              {grid && ticks.map((v) => <line key={v} className="pspp-chart__grid" x1={Math.round(sx(v)) + 0.5} x2={Math.round(sx(v)) + 0.5} y1={top} y2={top + plotH} />)}
              <line className="pspp-chart__baseline" x1={left} x2={left + plotW} y1={top + plotH + 0.5} y2={top + plotH + 0.5} />
              {ticks.map((v) => (
                <g key={v}>
                  <line className="pspp-chart__tickmark" x1={Math.round(sx(v)) + 0.5} x2={Math.round(sx(v)) + 0.5} y1={top + plotH} y2={top + plotH + 4} />
                  <text className="pspp-chart__tick" x={sx(v)} y={top + plotH + 14 * fs + 1} textAnchor="middle">
                    {fmtTick(v)}
                  </text>
                </g>
              ))}
              {inside(spec.refValue) && <line className="pspp-chart__ref" x1={refX} x2={refX} y1={top - 2} y2={top + plotH} style={{ strokeDasharray: '5 4' }} />}
            </g>
            {items.map((it, k) => {
              const cy = top + k * rowH + rowH / 2;
              if (it.kind === 'header') {
                return (
                  <text key={'h' + k} className="pspp-chart__legend-title" x={4} y={cy} dominantBaseline="central" aria-hidden="true">
                    {truncateText(it.label, labelW - 8, 12 * fs, 600)}
                  </text>
                );
              }
              const r = it.row;
              const side = weightSide(r.weight, maxWeight, 5, Math.min(16, rowH - 6));
              const tip = {
                title: r.label,
                rows: [
                  { label: tr(t, 'estimate'), value: f2(r.est), key: 'none' as const },
                  { label: `${tr(t, 'lowerBound')} – ${tr(t, 'upperBound')}`, value: `${f2(r.lo)} – ${f2(r.hi)}`, key: 'none' as const },
                  ...(r.weight !== null && r.weight !== undefined ? [{ label: tr(t, 'weight'), value: formatValue(r.weight, locale), key: 'none' as const }] : []),
                  ...(r.group ? [{ label: tr(t, 'group'), value: r.group, key: 'none' as const }] : []),
                ],
              };
              const x1 = clamp(sx(r.lo), left, left + plotW);
              const x2 = clamp(sx(r.hi), left, left + plotW);
              return (
                <g key={'r' + k} className="pspp-chart__mark" {...tipProps(area.tip, tip, focusable, `${r.label}: ${textOf(r)}`)}>
                  <rect x={0} y={cy - rowH / 2} width={area.width} height={rowH} className="pspp-chart__hitband" data-export="omit" />
                  <text className="pspp-chart__tick pspp-chart__tick--cat" x={group ? 14 : 4} y={cy} dominantBaseline="central" aria-hidden="true">
                    {truncateText(r.label, labelW - (group ? 18 : 8), size)}
                  </text>
                  <g clipPath={`url(#${clip})`}>
                    {x2 > x1 && (
                      <path className="pspp-chart__whisker" d={`M${x1},${cy}H${x2}${inside(r.lo) ? `M${x1},${cy - 4}V${cy + 4}` : ''}${inside(r.hi) ? `M${x2},${cy - 4}V${cy + 4}` : ''}`} fill="none" style={{ stroke: 'var(--c-series-1)' }} />
                    )}
                    {inside(r.est) && <rect x={sx(r.est) - side / 2} y={cy - side / 2} width={side} height={side} style={{ fill: 'var(--c-series-1)' }} />}
                  </g>
                  {showText && (
                    <text className="pspp-chart__tick pspp-chart__tick--cat" x={left + plotW + 12} y={cy} dominantBaseline="central" aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {textOf(r)}
                    </text>
                  )}
                </g>
              );
            })}
            <AxisTitles xTitle={xT} left={left} top={top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
