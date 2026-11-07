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

const SQRT2PI = Math.sqrt(2 * Math.PI);

export function HistogramChart({ spec, ...c }: { spec: HistogramSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const name = spec.title || tr(t, 'untitled');
  const title = tr(t, 'histogramOf', { name });
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
  const legend: LegendItem[] | undefined = canNormal
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
        columns: discrete ? [name, freq] : [tr(t, 'lowerBound'), tr(t, 'upperBound'), freq],
        rows: bins.map((b) => (discrete ? [binLabel(b), formatValue(b[2], locale)] : [formatValue(b[0], locale), formatValue(b[1], locale), formatValue(b[2], locale)])),
        numeric: discrete ? [true, true] : [true, true, true],
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
        const x0 = bins[0][0];
        const x1 = bins[bins.length - 1][1];
        const binW = bins[0][1] - bins[0][0];
        const scaleN = binW * total;
        const pdf = (x: number) => (canNormal ? (Math.exp(-0.5 * ((x - spec.mean!) / spec.stddev!) ** 2) / (spec.stddev! * SQRT2PI)) * scaleN : 0);
        const maxCount = bins.reduce((m, b) => Math.max(m, b[2]), 0);
        const peak = canNormal ? pdf(spec.mean!) : 0;
        const yt = niceTicks(0, Math.max(maxCount, Math.min(peak, maxCount * 1.6), 1), clamp(Math.floor(area.height / 48), 3, 8));
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: freq, xTitle: name });
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
        const base = sy(0);
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
              <clipPath id={area.uid + '-hc'}>
                <rect x={m.left} y={m.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <XAxis axis={{ scale: xScale, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
            {bins.map((b, i) => {
              const xa = sx(b[0]);
              const xb = sx(b[1]);
              const range = binLabel(b);
              const tip = { title: range, rows: [{ label: freq, value: formatValue(b[2], locale), color: seriesColor(0), key: 'rect' as const }] };
              const w = Math.max(1, xb - xa - 2);
              return (
                <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip)}>
                  <rect x={xa} y={m.top} width={xb - xa} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                  {b[2] > 0 && <path d={barPath(xa + 1, w, base, sy(b[2]))} style={{ fill: seriesColor(0) }} />}
                </g>
              );
            })}
            {canNormal && <polyline className="pspp-chart__line" points={curve} clipPath={`url(#${area.uid}-hc)`} style={{ stroke: seriesColor(1) }} pointerEvents="none" />}
            <Baseline x1={m.left} x2={m.left + plotW} y={base} />
            <AxisTitles xTitle={name} yTitle={freq} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
