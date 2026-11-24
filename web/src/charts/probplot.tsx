/* Q-Q and P-P plots: observed against theoretical values with a reference line.  Studio only
   (ProbPlotSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { niceTicks, padExtent, ticksWithin } from './scale';
import { tr } from './strings';
import type { ProbPlotSpec } from './studioTypes';
import { XYPlot, extent, pointTip, xCount, xyTable, yCount, type RefLine, type XYSeries } from './xy';

export function ProbPlotChart({ spec, ...c }: { spec: ProbPlotSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const pp = spec.mode === 'pp';
  const title = spec.title || tr(t, pp ? 'ppPlot' : 'qqPlot');
  const xName = spec.xlabel || tr(t, pp ? 'expectedCumProp' : 'theoreticalQuantiles');
  const yName = spec.ylabel || tr(t, pp ? 'observedCumProp' : 'observedQuantiles');
  const series: XYSeries[] = [{ name: tr(t, 'observations'), color: seriesColor(0), shape: 'circle', points: spec.points }];
  const legend: LegendItem[] = [{ label: series[0].name, kind: 'marker', color: seriesColor(0), shape: 'circle' }];
  if (spec.reference) legend.push({ label: tr(t, 'referenceLine'), kind: 'line', color: 'var(--c-reference)' });
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaPoints', { count: spec.points.length })}.`}
      table={xyTable(xName, yName, series, locale)}
    >
      {(area) => {
        const [x0, x1] = extent(spec.points.map((p) => p[0]));
        const [y0, y1] = extent(spec.points.map((p) => p[1]));
        let xt;
        let yt;
        if (pp) {
          // cumulative proportions live in [0, 1] on both axes
          const n = area.width < 300 ? 5 : 10;
          xt = { ...ticksWithin(0, 1, n), domain: [0, 1] as [number, number] };
          yt = { ...ticksWithin(0, 1, n), domain: [0, 1] as [number, number] };
        } else {
          const ref = spec.reference ?? [];
          const xs = [x0, x1, ...ref.map((p) => p[0])];
          const ys = [y0, y1, ...ref.map((p) => p[1])];
          const xd = padExtent(Math.min(...xs), Math.max(...xs), 0.05);
          const yd = padExtent(Math.min(...ys), Math.max(...ys), 0.05);
          xt = niceTicks(xd[0], xd[1], xCount(area.width));
          yt = niceTicks(yd[0], yd[1], yCount(area.height));
        }
        const refLines: RefLine[] = spec.reference ? [{ x1: spec.reference[0][0], y1: spec.reference[0][1], x2: spec.reference[1][0], y2: spec.reference[1][1] }] : [];
        return <XYPlot emptyText={tr(t, 'noData')} area={area} locale={locale} x={xt} y={yt} xTitle={xName} yTitle={yName} series={series} refLines={refLines} tipFor={pointTip(xName, yName, locale, false)} />;
      }}
    </ChartShell>
  );
}
