import {
  AxisTitles,
  Baseline,
  ChartShell,
  XAxis,
  YAxis,
  barPath,
  plotMargins,
  seriesColor,
  markTip,
  type ChartCommonProps,
  type LegendItem,
} from './shell';
import { clamp, formatValue, linearScale, niceTicks, tickFormatter, ticksWithin } from './scale';
import { tr } from './strings';
import type { HistogramSpec } from './types';
import { useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';

const SQRT2PI = Math.sqrt(2 * Math.PI);

export function HistogramChart({ spec, ...c }: { spec: HistogramSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const name = spec.title || tr(t, 'untitled');
  const title = tr(t, 'histogramOf', { name });
  // the x axis names the variable; a studio chart says so in xlabel, an engine chart's title is the variable label
  const xName = spec.xlabel || name;
  const freq = tr(t, 'frequency');
  const stats: string[] = [];
  if (spec.mean !== null) stats.push(`${tr(t, 'mean')} ${formatValue(spec.mean, locale, 2)}`);
  if (spec.stddev !== null) stats.push(`${tr(t, 'stdDev')} ${formatValue(spec.stddev, locale, 2)}`);
  if (spec.n !== null) stats.push(`${tr(t, 'n')} = ${formatValue(spec.n, locale)}`);
  const bins = spec.bins;
  // whole-number data: a bin [20, 21) holds only the value 20, so say "20", not "20 – 21"
  const ints = (b: [number, number, number]): [number, number] => [Math.ceil(b[0] - 1e-9), Math.ceil(b[1] - 1e-9) - 1];
  const discrete = spec.integer && bins.length > 0 && bins.every((b) => ints(b)[1] >= ints(b)[0] || b[2] === 0);
  const single = discrete && bins.every((b) => ints(b)[1] <= ints(b)[0]);
  const binLabel = (b: [number, number, number]) => {
    if (!discrete) return `${formatValue(b[0], locale)} – ${formatValue(b[1], locale)}`;
    const [a, z] = ints(b);
    return z <= a ? formatValue(a, locale) : `${formatValue(a, locale)} – ${formatValue(z, locale)}`;
  };
  const total = bins.reduce((s, b) => s + b[2], 0);
  const canNormal = spec.showNormal && spec.mean !== null && spec.stddev !== null && spec.stddev > 0 && bins.length > 0;
  const series = spec.series && spec.series.length ? spec.series : null;
  const polygon = spec.mode === 'polygon';
  const sColor = (si: number) => seriesColor(series ? si : 0);
  const legend: LegendItem[] | undefined = series
    ? series.map((s, si) => ({ label: s.name || tr(t, 'missing'), kind: polygon ? 'line' : 'rect', color: sColor(si) }))
    : canNormal
      ? [
          { label: freq, kind: 'rect', color: seriesColor(0) },
          { label: tr(t, 'normal'), kind: 'line', color: seriesColor(1) },
        ]
      : undefined;

  return (
    <ChartShell
      {...c}
      title={title}
      subtitle={stats.join(' · ')}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaBins', { count: bins.length })}. ${stats.join(', ')}.`}
      table={{
        columns: [...(discrete ? [name] : [tr(t, 'lowerBound'), tr(t, 'upperBound')]), ...(series ? series.map((s) => s.name || tr(t, 'missing')) : []), freq],
        rows: bins.map((b, bi) => [
          ...(discrete ? [binLabel(b)] : [formatValue(b[0], locale), formatValue(b[1], locale)]),
          ...(series ? series.map((s) => formatValue(s.counts[bi], locale)) : []),
          formatValue(b[2], locale),
        ]),
        numeric: [...(discrete ? [true] : [true, true]), ...(series ? series.map(() => true) : []), true],
      }}
    >
      {(area) => {
        if (!bins.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const padX = polygon ? (bins[0][1] - bins[0][0]) / 2 : 0;
        const dataX0 = bins[0][0] - padX;
        const dataX1 = bins[bins.length - 1][1] + padX;
        const x0 = style?.xMin != null && style.xMin < (style.xMax ?? dataX1) ? style.xMin : dataX0;
        const x1 = style?.xMax != null && style.xMax > x0 ? style.xMax : dataX1;
        const binW = bins[0][1] - bins[0][0];
        const scaleN = binW * total;
        const pdf = (x: number) => (canNormal ? (Math.exp(-0.5 * ((x - spec.mean!) / spec.stddev!) ** 2) / (spec.stddev! * SQRT2PI)) * scaleN : 0);
        const maxCount = polygon && series ? Math.max(0, ...series.flatMap((s) => s.counts)) : bins.reduce((m, b) => Math.max(m, b[2]), 0);
        const peak = canNormal ? pdf(spec.mean!) : 0;
        const yCount = clamp(Math.floor(area.height / 48), 3, 8);
        const yt = applyDomain(niceTicks(0, Math.max(maxCount, Math.min(peak, maxCount * 1.6), 1), yCount), style?.yMin, style?.yMax, yCount);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: freq, xTitle: xName, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sx = linearScale([x0, x1], [m.left, m.left + plotW]);
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        let xt = ticksWithin(x0, x1, clamp(Math.floor(plotW / 80), 3, 10));
        let fx = tickFormatter(xt.step, xt.ticks, locale);
        let xScale = sx;
        if (single) {
          // one value per bin: a tick under the middle of each bar, labelled with its value
          const vals = bins.map((b) => ints(b)[0]);
          const every = Math.max(1, Math.ceil(vals.length / clamp(Math.floor(plotW / 36), 2, 40)));
          const centre = new Map(bins.map((b, i) => [vals[i], (b[0] + b[1]) / 2]));
          xt = { ...xt, ticks: vals.filter((_, i) => i % every === 0) };
          fx = (v: number) => formatValue(v, locale);
          xScale = Object.assign((v: number) => sx(centre.get(v) ?? v), sx);
        }
        const base = sy(clamp(0, yt.domain[0], yt.domain[1]));
        const centre = (b: [number, number, number]) => (b[0] + b[1]) / 2;
        // polygon: counts at the bin centres, closed to zero half a bin outside the data
        const polyPts = (counts: number[]): [number, number][] => [
          [bins[0][0] - binW / 2, 0] as [number, number],
          ...bins.map((b, i) => [centre(b), counts[i]] as [number, number]),
          [bins[bins.length - 1][1] + binW / 2, 0] as [number, number],
        ];
        let curve = '';
        if (canNormal) {
          const pts: string[] = [];
          for (let i = 0; i <= 120; i++) {
            const x = x0 + ((x1 - x0) * i) / 120;
            pts.push(`${sx(x).toFixed(1)},${sy(pdf(x)).toFixed(1)}`);
          }
          curve = pts.join(' ');
        }
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-hb'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
              <clipPath id={area.uid + '-hc'}>
                <rect x={m.left} y={m.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <XAxis axis={{ scale: xScale, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
            <g clipPath={`url(#${area.uid}-hb)`}>
              {bins.map((b, i) => {
                const xa = sx(b[0]);
                const xb = sx(b[1]);
                const range = binLabel(b);
                const tip = {
                  title: range,
                  rows: series
                    ? [
                        ...series.map((s, si) => ({ label: s.name || tr(t, 'missing'), value: formatValue(s.counts[i], locale), color: sColor(si), key: 'rect' as const })),
                        { label: tr(t, 'total'), value: formatValue(b[2], locale), key: 'none' as const },
                      ]
                    : [{ label: freq, value: formatValue(b[2], locale), color: seriesColor(0), key: 'rect' as const }],
                };
                const w = Math.max(1, xb - xa - 2);
                let acc = 0;
                return (
                  <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip)}>
                    <rect x={xa} y={m.top} width={xb - xa} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    {!polygon &&
                      (series ? (
                        series.map((s, si) => {
                          const c0 = acc;
                          acc += s.counts[i];
                          if (s.counts[i] <= 0) return null;
                          const ya = sy(c0);
                          const yb = sy(acc);
                          return <rect key={si} x={xa + 1} y={yb} width={w} height={Math.max(0, ya - yb)} style={{ fill: sColor(si), stroke: 'var(--c-surface)', strokeWidth: 1 }} />;
                        })
                      ) : (
                        b[2] > 0 && <path d={barPath(xa + 1, w, base, sy(b[2]))} style={{ fill: seriesColor(0) }} />
                      ))}
                  </g>
                );
              })}
            </g>
            {polygon && (
              <g clipPath={`url(#${area.uid}-hb)`} pointerEvents="none">
                {(series ?? [{ name: freq, counts: bins.map((b) => b[2]) }]).map((s, si) => {
                  const pts = polyPts(s.counts);
                  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
                  return (
                    <g key={si}>
                      {!series && <path d={`${d}L${sx(pts[pts.length - 1][0]).toFixed(1)},${base}L${sx(pts[0][0]).toFixed(1)},${base}Z`} style={{ fill: sColor(si), fillOpacity: 0.14, stroke: 'none' }} />}
                      <path className="pspp-chart__line" d={d} style={{ stroke: sColor(si) }} />
                      {pts.slice(1, -1).map((p, k) => (
                        <circle key={k} cx={sx(p[0])} cy={sy(p[1])} r={3} style={{ fill: sColor(si), stroke: 'var(--c-surface)', strokeWidth: 1.5 }} />
                      ))}
                    </g>
                  );
                })}
              </g>
            )}
            {canNormal && <polyline className="pspp-chart__line" points={curve} clipPath={`url(#${area.uid}-hc)`} style={{ stroke: seriesColor(1) }} pointerEvents="none" />}
            <Baseline x1={m.left} x2={m.left + plotW} y={base} />
            <AxisTitles xTitle={xName} yTitle={freq} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
