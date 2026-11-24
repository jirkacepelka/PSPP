/* Sequence chart (line chart over a numeric x such as case number or time) and the Shewhart style
   control chart.  Studio only (SequenceSpec, ControlSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, GROUP_SHAPES, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { formatValue, niceTicks, padExtent } from './scale';
import { tr } from './strings';
import type { ControlSpec, SequenceSpec } from './studioTypes';
import { intTicks, stepPoints } from './studioMath';
import { XYPlot, extent, xCount, xyTable, yCount, type XYSeries } from './xy';
import type { Pt } from './types';

const pts = (xs: number[], vals: (number | null)[]): Pt[] => xs.flatMap((x, i) => (vals[i] === null || vals[i] === undefined ? [] : [[x, vals[i] as number] as Pt]));

export function SequenceChart({ spec, ...c }: { spec: SequenceSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'sequenceChart');
  const xName = spec.xlabel || tr(t, 'caseNumber');
  const yName = spec.ylabel || tr(t, 'value');
  const named = spec.series.length > 1;
  const showMarkers = spec.x.length <= 60;
  const series: XYSeries[] = spec.series.map((s, i) => ({ name: s.name || `${tr(t, 'variable')} ${i + 1}`, color: seriesColor(i), shape: GROUP_SHAPES[i % 8], points: pts(spec.x, s.values), line: true, markers: showMarkers, r: 3 }));
  const legend: LegendItem[] | undefined = named ? series.map((s) => ({ label: s.name, kind: 'line', color: s.color })) : undefined;
  const xIndex = new Map<number, number>();
  spec.x.forEach((x, i) => !xIndex.has(x) && xIndex.set(x, i));
  const table = xyTable(xName, yName, series, locale);
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaLines', { count: series.length })}: ${series.map((s) => s.name).join(', ')}. ${tr(t, 'ariaValues', { count: spec.x.length })}.`}
      table={
        named
          ? {
              columns: [xName, ...series.map((s) => s.name)],
              rows: spec.x.map((x, i) => [formatValue(x, locale), ...spec.series.map((s) => formatValue(s.values[i], locale))]),
              numeric: [true, ...series.map(() => true)],
            }
          : table
      }
    >
      {(area) => {
        const all = series.flatMap((s) => s.points);
        const [x0, x1] = extent(spec.x);
        const [y0, y1] = extent(all.map((p) => p[1]));
        const xd = padExtent(x0, x1, 0.02);
        const yd = padExtent(y0, y1, 0.06);
        const xt = niceTicks(xd[0], xd[1], xCount(area.width));
        const yt = niceTicks(yd[0], yd[1], yCount(area.height));
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
            // every series' value at the hovered position
            tipFor={(_s, p) => {
              const i = xIndex.get(p[0]);
              return {
                title: `${xName}: ${formatValue(p[0], locale)}`,
                rows: series.map((o, k) => ({
                  label: named ? o.name : yName,
                  value: formatValue(i === undefined ? null : spec.series[k].values[i], locale),
                  color: o.color,
                  key: showMarkers ? ('marker' as const) : ('line' as const),
                  shape: o.shape,
                })),
              };
            }}
          />
        );
      }}
    </ChartShell>
  );
}

export function ControlChart({ spec, ...c }: { spec: ControlSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'controlChart');
  const xName = spec.xlabel || tr(t, 'caseNumber');
  const yName = spec.ylabel || tr(t, 'value');
  const n = spec.values.length;
  const xs = spec.values.map((_, i) => i + 1);
  const flagged = spec.flags.reduce((k, f) => k + (f ? 1 : 0), 0);
  const cValue = seriesColor(0);
  const cLimit = seriesColor(1);
  const cFlag = seriesColor(7);
  const cCenter = 'var(--c-ink-2)';
  const series: XYSeries[] = [
    { name: yName, color: cValue, shape: 'circle', points: pts(xs, spec.values), line: true, markers: true, r: n > 60 ? 2.5 : 3.5 },
    { name: tr(t, 'centerLine'), color: cCenter, shape: 'circle', points: n ? [[0.5, spec.center], [n + 0.5, spec.center]] : [], line: true, markers: false, hover: false },
    { name: tr(t, 'upperLimit'), color: cLimit, shape: 'circle', points: stepPoints(xs, spec.ucl), line: true, markers: false, dash: '6 4', hover: false },
    { name: tr(t, 'lowerLimit'), color: cLimit, shape: 'circle', points: stepPoints(xs, spec.lcl), line: true, markers: false, dash: '6 4', hover: false },
    { name: tr(t, 'outOfLimits'), color: cFlag, shape: 'diamond', points: pts(xs, spec.values.map((v, i) => (spec.flags[i] ? v : null))), line: false, markers: true, r: 5.5 },
  ];
  const legend: LegendItem[] = [
    { label: yName, kind: 'line', color: cValue },
    { label: tr(t, 'centerLine'), kind: 'line', color: cCenter },
    { label: `${tr(t, 'upperLimit')} / ${tr(t, 'lowerLimit')}`, kind: 'line', color: cLimit },
    ...(flagged ? [{ label: tr(t, 'outOfLimits'), kind: 'marker' as const, shape: 'diamond' as const, color: cFlag }] : []),
  ];
  const fv = (v: number | null) => formatValue(v, locale);
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaPoints', { count: n })}, ${tr(t, 'ariaFlagged', { count: flagged })}. ${tr(t, 'centerLine')} ${fv(spec.center)}.`}
      table={{
        columns: [xName, yName, tr(t, 'lowerLimit'), tr(t, 'centerLine'), tr(t, 'upperLimit'), tr(t, 'outOfLimits')],
        rows: spec.values.map((v, i) => [spec.labels[i], fv(v), fv(spec.lcl[i]), fv(spec.center), fv(spec.ucl[i]), spec.flags[i] ? tr(t, 'yes') : tr(t, 'no')]),
        numeric: [false, true, true, true, true, false],
      }}
    >
      {(area) => {
        const vals = [...spec.values.filter((v): v is number => v !== null), spec.center, ...spec.ucl, ...spec.lcl].filter((v) => isFinite(v));
        const [y0, y1] = extent(vals);
        const yd = padExtent(y0, y1, 0.06);
        const yt = niceTicks(yd[0], yd[1], yCount(area.height));
        const xt = n ? intTicks(n, xCount(area.width)) : { ticks: [], step: 1, domain: [0, 1] as [number, number] };
        return (
          <XYPlot
            emptyText={tr(t, 'noData')}
            area={area}
            locale={locale}
            x={xt}
            y={yt}
            xFormat={(v) => (Number.isInteger(v) && spec.labels[v - 1] !== undefined ? spec.labels[v - 1] : '')}
            xTitle={xName}
            yTitle={yName}
            series={series}
            tipFor={(_s, p) => {
              const i = p[0] - 1;
              const out = spec.flags[i];
              return {
                title: out ? `${spec.labels[i]} – ${tr(t, 'outOfLimits')}` : spec.labels[i],
                rows: [
                  { label: yName, value: fv(p[1]), color: out ? cFlag : cValue, key: 'marker' as const, shape: out ? ('diamond' as const) : ('circle' as const) },
                  { label: tr(t, 'upperLimit'), value: fv(spec.ucl[i]), color: cLimit, key: 'line' as const },
                  { label: tr(t, 'centerLine'), value: fv(spec.center), color: cCenter, key: 'line' as const },
                  { label: tr(t, 'lowerLimit'), value: fv(spec.lcl[i]), color: cLimit, key: 'line' as const },
                ],
              };
            }}
          />
        );
      }}
    </ChartShell>
  );
}
