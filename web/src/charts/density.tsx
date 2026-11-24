/* Kernel density curves, one per group, optionally filled, on a shared x axis.  Studio only
   (DensitySpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { formatValue, niceTicks, padExtent } from './scale';
import { tr } from './strings';
import type { DensitySpec } from './studioTypes';
import { XYPlot, extent, xCount, xyTable, yCount, type Fill, type XYSeries } from './xy';

export function DensityChart({ spec, ...c }: { spec: DensitySpec } & ChartCommonProps) {
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
