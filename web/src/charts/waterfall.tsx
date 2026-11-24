/* Waterfall chart: a running total built from increases and decreases, with total bars and connector lines.  Studio
   only (WaterfallSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import type { ReactNode } from 'react';
import { AxisTitles, Baseline, ChartShell, FONT, YAxis, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, measureText, niceTicks, tickFormatter } from './scale';
import { waterfallBars, type WaterfallBar } from './phase4Math';
import { EmptyPlot, signed, tipProps } from './p4shared';
import { catLabels } from './bar';
import { tr } from './strings';
import type { WaterfallSpec } from './studioTypes';
import { avoidText, axisTitle, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';

const MAX_BAR = 56;

/** Palette slots: totals blue, increases green, decreases orange (editable through the palette like any series). */
const KIND_COLOR: Record<WaterfallBar['kind'], string> = { total: seriesColor(0), increase: seriesColor(2), decrease: seriesColor(1) };

export function WaterfallChart({ spec, ...c }: { spec: WaterfallSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'waterfallChart');
  const yName = spec.ylabel || tr(t, 'value');
  const bars = waterfallBars(spec.steps);
  const cats = bars.map((b) => b.label);
  const fv = (v: number) => formatValue(v, locale);
  const kindName: Record<WaterfallBar['kind'], string> = { total: tr(t, 'total'), increase: tr(t, 'increase'), decrease: tr(t, 'decrease') };
  const present = (['increase', 'decrease', 'total'] as const).filter((k) => bars.some((b) => b.kind === k));
  const legend: LegendItem[] | undefined = bars.length ? present.map((k) => ({ label: kindName[k], kind: 'rect' as const, color: KIND_COLOR[k] })) : undefined;
  const xT = axisTitle(style, 'x', spec.xlabel);
  const table = {
    columns: [tr(t, 'category'), tr(t, 'change'), tr(t, 'runningTotal')],
    rows: bars.map((b) => [b.label, b.kind === 'total' ? kindName.total : signed(b.delta, fv), fv(b.to)]),
    numeric: [false, true, true],
  };
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${yName}. ${tr(t, 'ariaBars', { count: bars.length })}: ${bars
        .slice(0, 30)
        .map((b) => `${b.label} ${b.kind === 'total' ? fv(b.to) : signed(b.delta, fv)}`)
        .join(', ')}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(w * 0.56), 240, 420) + catLabels(cats, Math.max(1, (w - 64) / Math.max(1, cats.length))).labelBand - 18 + (xT ? 20 : 0)}
    >
      {(area) => {
        if (!bars.length) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const levels = bars.flatMap((b) => [b.from, b.to]);
        const count = clamp(Math.floor(area.height / 48), 3, 8);
        const vt = applyDomain(niceTicks(Math.min(0, ...levels), Math.max(0, ...levels) || 1, count), style?.yMin, style?.yMax, count);
        const fy = tickFormatter(vt.step, vt.ticks, locale);
        const m = plotMargins({ yTickLabels: vt.ticks.map(fy), yTitle: yName, style });
        const plotW = area.width - m.left - m.right;
        const n = bars.length;
        const band = plotW / n;
        const { mode, every, labels, labelBand } = catLabels(cats, band);
        const size = FONT.label * fs;
        const txt = bars.map((b) => (b.kind === 'total' ? fv(b.to) : signed(b.delta, fv)));
        const wantLabels = n <= 40 && style?.valueLabels !== false;
        const top = m.top + (wantLabels ? Math.round(14 * fs) : 0);
        const plotH = area.height - top - labelBand - 4 - (xT ? 20 : 0);
        const sy = linearScale(vt.domain, [top + plotH, top]);
        const zero = sy(Math.max(vt.domain[0], Math.min(0, vt.domain[1])));
        const bw = Math.min(band * 0.7, MAX_BAR);
        const cxOf = (i: number) => m.left + band * (i + 0.5);
        area.reg.x = cxOf;
        area.reg.top = top;
        area.reg.height = plotH;
        const labelEls: ReactNode[] = [];
        const focusable = n <= 120;

        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-wf'}>
                <rect x={m.left} y={top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: vt.ticks, format: fy }} left={m.left} width={plotW} />
            {cats.map((_c, i) => {
              if (i % every) return null;
              const cx = cxOf(i);
              return mode === 'flat' ? (
                <text key={'t' + i} className="pspp-chart__tick pspp-chart__tick--cat" x={cx} y={top + plotH + 15} textAnchor="middle">
                  {labels[i]}
                </text>
              ) : (
                <text key={'t' + i} className="pspp-chart__tick pspp-chart__tick--cat" transform={`translate(${cx} ${top + plotH + 8}) rotate(${mode === 'tilt' ? -45 : -90})`} textAnchor="end" dominantBaseline="central">
                  {labels[i]}
                </text>
              );
            })}
            <g clipPath={`url(#${area.uid}-wf)`} aria-hidden="true">
              {bars.slice(0, -1).map((b, i) => {
                const y = Math.round(sy(b.to)) + 0.5;
                return <line key={'c' + i} className="pspp-chart__connector" x1={cxOf(i) + bw / 2} x2={cxOf(i + 1) - bw / 2} y1={y} y2={y} />;
              })}
            </g>
            <g clipPath={`url(#${area.uid}-wf)`}>
              {bars.map((b, i) => {
                const ya = sy(b.from);
                const yb = sy(b.to);
                const y0 = Math.min(ya, yb);
                const h = Math.max(1, Math.abs(yb - ya));
                const cx = cxOf(i);
                const tw = measureText(txt[i], size);
                if (wantLabels && tw <= band * 1.15) {
                  // increases and totals read above the bar, decreases below it when there is room
                  const below = b.kind === 'decrease' && y0 + h + size + 2 <= top + plotH;
                  const ly = below ? y0 + h + size : y0 - 5;
                  avoidText(area.reg, cx, ly, tw, size);
                  labelEls.push(
                    <text key={'v' + i} className="pspp-chart__value" x={cx} y={ly} textAnchor="middle">
                      {txt[i]}
                    </text>,
                  );
                }
                const tip = {
                  title: b.label,
                  rows: [
                    { label: b.kind === 'total' ? kindName.total : tr(t, 'change'), value: b.kind === 'total' ? fv(b.to) : signed(b.delta, fv), color: KIND_COLOR[b.kind], key: 'rect' as const },
                    ...(b.kind === 'total' ? [] : [{ label: tr(t, 'runningTotal'), value: fv(b.to), key: 'none' as const }]),
                  ],
                };
                return (
                  <g key={i} className="pspp-chart__mark" {...tipProps(area.tip, tip, focusable, `${b.label}: ${txt[i]}`)}>
                    <rect x={cx - band / 2} y={top} width={band} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    <rect x={cx - bw / 2} y={y0} width={bw} height={h} rx={2} style={{ fill: KIND_COLOR[b.kind] }} />
                  </g>
                );
              })}
            </g>
            <g aria-hidden="true" pointerEvents="none">
              {labelEls}
            </g>
            <Baseline x1={m.left} x2={m.left + plotW} y={zero} />
            <AxisTitles xTitle={xT} yTitle={yName} left={m.left} top={top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
