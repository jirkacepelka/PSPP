/* Stacked dot plot: one dot per case, stacked in value bins.  Studio only (DotSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, Baseline, ChartShell, XAxis, YAxis, markTip, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, niceTicks, tickFormatter, ticksWithin } from './scale';
import { tr } from './strings';
import type { DotSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';
import { dotRadius } from './studioMath';

const MAX_DOTS = 4000;

export function DotChart({ spec, ...c }: { spec: DotSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const title = spec.title || tr(t, 'dotPlot');
  const groups: string[] = [];
  for (const b of spec.bins) if (b.group != null && !groups.includes(b.group)) groups.push(b.group);
  const grouped = groups.length > 0;
  const gIndex = (g: string | null | undefined) => (g == null ? 0 : Math.max(0, groups.indexOf(g)));
  const legend: LegendItem[] | undefined = groups.length > 1 ? groups.map((g, i) => ({ label: g || tr(t, 'missing'), kind: 'marker', shape: 'circle', color: seriesColor(i) })) : undefined;
  const xs = [...new Set(spec.bins.map((b) => b.x))].sort((a, b) => a - b);
  let binW = Infinity;
  for (let i = 1; i < xs.length; i++) binW = Math.min(binW, xs[i] - xs[i - 1]);
  if (!isFinite(binW) || binW <= 0) binW = 1;
  const totalCases = spec.bins.reduce((s, b) => s + b.count, 0);
  const sorted = [...spec.bins].sort((a, b) => a.x - b.x || gIndex(a.group) - gIndex(b.group));
  // per x: stack of groups bottom to top
  const stackOf = new Map<number, typeof sorted>();
  for (const b of sorted) stackOf.set(b.x, [...(stackOf.get(b.x) ?? []), b]);
  const maxStack = Math.max(0, ...[...stackOf.values()].map((bs) => bs.reduce((s, b) => s + b.count, 0)));

  return (
    <ChartShell
      {...c}
      title={title}
      subtitle={tr(t, 'dotNote')}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaPoints', { count: totalCases })}.`}
      table={{
        columns: [...(grouped ? [tr(t, 'group')] : []), spec.xlabel || tr(t, 'value'), tr(t, 'count')],
        rows: sorted.map((b) => [...(grouped ? [b.group ?? ''] : []), formatValue(b.x, locale), formatValue(b.count, locale)]),
        numeric: [...(grouped ? [false] : []), true, true],
      }}
    >
      {(area) => {
        if (!spec.bins.length || maxStack === 0) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const xCount = clamp(Math.floor(area.width / 90), 3, 10);
        const xBase = niceTicks(xs[0] - binW, xs[xs.length - 1] + binW, xCount);
        const xt = applyDomain(xBase, style?.xMin, style?.xMax, xCount);
        const fx = tickFormatter(xt.step, xt.ticks, locale);
        // provisional margins to learn the plot size, then fit the dots into it
        const m0 = plotMargins({ yTickLabels: ['0000'], yTitle: tr(t, 'count'), xTitle: spec.xlabel, right: 16, style });
        const plotW0 = area.width - m0.left - m0.right;
        const plotH0 = area.height - m0.top - m0.bottom;
        const binPx = (plotW0 * binW) / (xt.domain[1] - xt.domain[0]);
        const r = dotRadius(maxStack, binPx, plotH0);
        const unit = Math.min(2 * r, plotH0 / maxStack);
        const yMaxUnits = plotH0 / unit;
        const yBase = ticksWithin(0, yMaxUnits, clamp(Math.floor(area.height / 48), 3, 9));
        const yt = applyDomain({ ...yBase, domain: [0, yMaxUnits] }, style?.yMin, style?.yMax, 6);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: tr(t, 'count'), xTitle: spec.xlabel, right: 16, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sx = linearScale(xt.domain, [m.left, m.left + plotW]);
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const asBars = unit < 3 || totalCases > MAX_DOTS;
        const rr = asBars ? 0 : Math.min(r, (sx(xt.domain[0] + binW) - sx(xt.domain[0])) / 2 - 0.5);
        const stackH = (n: number) => Math.abs(sy(0) - sy(n));
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-dc'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <XAxis axis={{ scale: sx, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
            <g clipPath={`url(#${area.uid}-dc)`}>
              {[...stackOf.entries()].map(([x, bs]) => {
                let acc = 0;
                const cx = sx(x);
                const tip = {
                  title: `${spec.xlabel ? spec.xlabel + ': ' : ''}${formatValue(x, locale)}`,
                  rows: bs.map((b) => ({ label: grouped ? b.group || tr(t, 'missing') : tr(t, 'cases'), value: formatValue(b.count, locale), color: seriesColor(gIndex(b.group)), key: 'marker' as const, shape: 'circle' as const })),
                };
                const total = bs.reduce((s, b) => s + b.count, 0);
                return (
                  <g key={x} className="pspp-chart__mark" {...markTip(area.tip, tip, `${formatValue(x, locale)}: ${total}`)}>
                    <rect x={cx - Math.max(rr, 4)} y={sy(total * 1) - 2} width={2 * Math.max(rr, 4)} height={stackH(total) + 2} className="pspp-chart__hitband" data-export="omit" />
                    {bs.map((b, bi) => {
                      const from = acc;
                      acc += b.count;
                      const color = seriesColor(gIndex(b.group));
                      if (asBars) {
                        const w = Math.max(2, Math.min(binW * (sx(1) - sx(0)) * 0.7, 14));
                        return <rect key={bi} x={cx - w / 2} y={sy(acc)} width={w} height={stackH(b.count)} rx={Math.min(2, w / 2)} style={{ fill: color }} />;
                      }
                      return Array.from({ length: b.count }, (_, k) => (
                        <circle key={bi + ':' + k} cx={cx} cy={sy(from + k + 0.5)} r={rr} style={{ fill: color, stroke: 'var(--c-surface)', strokeWidth: 1 }} />
                      ));
                    })}
                  </g>
                );
              })}
            </g>
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            <AxisTitles xTitle={spec.xlabel} yTitle={tr(t, 'count')} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
