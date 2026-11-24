/* High-low charts over categories: high-low-close bars, plain range bars, or the area between the
   two series.  Studio only (HighLowSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, Baseline, ChartShell, Marker, XAxis, YAxis, markTip, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, niceTicks, padExtent, tickFormatter } from './scale';
import { tr } from './strings';
import type { HighLowSpec } from './studioTypes';
import { axisTitle, useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';
import { catLabels } from './bar';
import { CatLabels } from './catAxis';
import { DENSE, DenseHover } from './denseHover';
import { numericAxis } from './xvalues';


export function HighLowChart({ spec, ...c }: { spec: HighLowSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const title = spec.title || tr(t, 'highLowChart');
  const n = spec.categories.length;
  const fv = (v: number | null) => formatValue(v, locale);
  const showClose = spec.mode === 'hlc' && spec.close !== null && spec.close.some((v) => v !== null);
  const xT = axisTitle(style, 'x', spec.xlabel);
  const yName = spec.ylabel || tr(t, 'value');
  const colHigh = seriesColor(0);
  const colLow = seriesColor(1);
  const legend: LegendItem[] | undefined =
    spec.mode === 'diff'
      ? [
          { label: tr(t, 'high'), kind: 'line', color: colHigh },
          { label: tr(t, 'low'), kind: 'line', color: colLow },
        ]
      : showClose
        ? [
            { label: tr(t, 'high') + ' – ' + tr(t, 'low'), kind: 'rect', color: colHigh },
            { label: tr(t, 'close'), kind: 'line', color: 'var(--c-ink)' },
          ]
        : undefined;
  const has = (i: number) => spec.high[i] !== null && spec.low[i] !== null;

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaCategories', { count: n })}: ${spec.categories
        .slice(0, 30)
        .map((cat, i) => `${cat} ${tr(t, 'low')} ${fv(spec.low[i])}, ${tr(t, 'high')} ${fv(spec.high[i])}${showClose ? `, ${tr(t, 'close')} ${fv(spec.close![i])}` : ''}`)
        .join('; ')}.`}
      table={{
        columns: [tr(t, 'category'), tr(t, 'high'), tr(t, 'low'), ...(showClose ? [tr(t, 'close')] : []), tr(t, spec.mode === 'diff' ? 'difference' : 'range')],
        rows: spec.categories.map((cat, i) => [
          cat,
          fv(spec.high[i]),
          fv(spec.low[i]),
          ...(showClose ? [fv(spec.close![i])] : []),
          has(i) ? fv((spec.high[i] as number) - (spec.low[i] as number)) : '–',
        ]),
        numeric: [false, true, true, ...(showClose ? [true] : []), true],
      }}
      plotHeight={(w) => clamp(Math.round(w * 0.56), 240, 420) + catLabels(spec.categories, Math.max(1, (w - 64) / Math.max(1, n))).labelBand - 18 + (xT ? 20 : 0)}
    >
      {(area) => {
        const vals: number[] = [];
        for (let i = 0; i < n; i++) {
          if (!has(i)) continue;
          vals.push(spec.high[i] as number, spec.low[i] as number);
          const cl = spec.close?.[i];
          if (cl != null) vals.push(cl);
        }
        if (!vals.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const [d0, d1] = padExtent(Math.min(...vals), Math.max(...vals), 0.06);
        const yCount = clamp(Math.floor(area.height / 48), 3, 8);
        const yt = applyDomain(niceTicks(d0, d1, yCount), style?.yMin, style?.yMax, yCount);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, style });
        const plotW = area.width - m.left - m.right;
        const band = plotW / Math.max(1, n);
        const nax = spec.xValues ? numericAxis(spec.xValues, m.left, plotW, clamp(Math.floor(area.width / 90), 3, 10), locale) : null;
        const info = catLabels(spec.categories, band);
        const plotH = area.height - m.top - (nax ? 18 : info.labelBand) - 4 - (xT ? 20 : 0);
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const xAt = (i: number) => (nax ? nax.xs[i] : m.left + band * (i + 0.5));
        area.reg.x = nax ? nax.scale : xAt;
        // with numeric positions a category's slot is its distance to the nearest neighbour
        const slotW = nax ? Math.max(1, Math.min(...nax.xs.slice(1).map((x, i) => x - nax.xs[i]).filter((d) => d > 0), band)) : band;
        area.reg.top = m.top;
        area.reg.height = plotH;
        const dense = n > DENSE;
        const barW = dense ? Math.max(0.5, slotW * (slotW >= 3 ? 0.8 : 1)) : Math.min(spec.mode === 'hlc' ? 7 : 26, slotW * 0.6);
        const f1 = (v: number) => v.toFixed(1);
        // the area between low and high: consecutive categories with both values form one run
        const runs: number[][] = [];
        for (let i = 0; i < n; i++) {
          if (!has(i)) continue;
          if (runs.length && runs[runs.length - 1][runs[runs.length - 1].length - 1] === i - 1) runs[runs.length - 1].push(i);
          else runs.push([i]);
        }
        const line = (run: number[], arr: (number | null)[]) => run.map((i, k) => `${k ? 'L' : 'M'}${f1(xAt(i))},${f1(sy(arr[i] as number))}`).join('');
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-hl'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <g clipPath={`url(#${area.uid}-hl)`}>
              {spec.mode === 'diff' &&
                runs.map((run, ri) => (
                  <g key={ri} pointerEvents="none">
                    <path
                      d={`${line(run, spec.high)}${[...run].reverse().map((i) => `L${f1(xAt(i))},${f1(sy(spec.low[i] as number))}`).join('')}Z`}
                      style={{ fill: colHigh, fillOpacity: 0.16, stroke: 'none' }}
                    />
                    <path className="pspp-chart__line" d={line(run, spec.high)} style={{ stroke: colHigh }} />
                    <path className="pspp-chart__line" d={line(run, spec.low)} style={{ stroke: colLow }} />
                  </g>
                ))}
              {dense && spec.mode !== 'diff' && (
                <g pointerEvents="none">
                  <path
                    d={spec.categories
                      .map((_c, i) => (has(i) ? `M${f1(xAt(i) - barW / 2)},${f1(sy(Math.max(spec.high[i] as number, spec.low[i] as number)))}h${f1(barW)}V${f1(sy(Math.min(spec.high[i] as number, spec.low[i] as number)))}h${f1(-barW)}Z` : ''))
                      .join('')}
                    style={{ fill: colHigh }}
                  />
                  {showClose && (
                    <path
                      d={spec.categories.map((_c, i) => (has(i) && spec.close![i] !== null ? `M${f1(xAt(i))},${f1(sy(spec.close![i] as number))}h${f1(Math.max(1, barW / 2 + 1))}` : '')).join('')}
                      style={{ stroke: 'var(--c-ink)', strokeWidth: 1, fill: 'none' }}
                    />
                  )}
                </g>
              )}
              {(dense ? [] : spec.categories).map((cat, i) => {
                if (!has(i)) return null;
                const hi = spec.high[i] as number;
                const lo = spec.low[i] as number;
                const cl = spec.close?.[i] ?? null;
                const tip = {
                  title: cat,
                  rows: [
                    { label: tr(t, 'high'), value: fv(hi), color: spec.mode === 'diff' ? colHigh : undefined, key: spec.mode === 'diff' ? ('line' as const) : ('none' as const) },
                    { label: tr(t, 'low'), value: fv(lo), color: spec.mode === 'diff' ? colLow : undefined, key: spec.mode === 'diff' ? ('line' as const) : ('none' as const) },
                    ...(showClose && cl !== null ? [{ label: tr(t, 'close'), value: fv(cl), key: 'none' as const }] : []),
                    { label: tr(t, spec.mode === 'diff' ? 'difference' : 'range'), value: fv(hi - lo), key: 'none' as const },
                  ],
                };
                const yTop = sy(Math.max(hi, lo));
                const yBot = sy(Math.min(hi, lo));
                return (
                  <g key={i} className="pspp-chart__mark" {...markTip(area.tip, tip, `${cat}: ${tr(t, 'low')} ${fv(lo)}, ${tr(t, 'high')} ${fv(hi)}${showClose && cl !== null ? `, ${tr(t, 'close')} ${fv(cl)}` : ''}`)}>
                    <rect x={xAt(i) - slotW / 2} y={m.top} width={slotW} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    {spec.mode === 'diff' ? (
                      <>
                        <Marker shape="circle" x={xAt(i)} y={sy(hi)} r={n > 24 ? 2 : 3.5} color={colHigh} />
                        <Marker shape="circle" x={xAt(i)} y={sy(lo)} r={n > 24 ? 2 : 3.5} color={colLow} />
                      </>
                    ) : (
                      <>
                        <rect x={xAt(i) - barW / 2} y={yTop} width={barW} height={Math.max(2, yBot - yTop)} rx={Math.min(3, barW / 2)} style={{ fill: colHigh }} />
                        {showClose && cl !== null && (
                          <path d={`M${f1(xAt(i))},${f1(sy(cl))}h${f1(barW / 2 + 6)}`} style={{ stroke: 'var(--c-ink)', strokeWidth: 2.5, strokeLinecap: 'round', fill: 'none' }} />
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </g>
            {dense && (
              <DenseHover
                tip={area.tip}
                left={m.left}
                top={m.top}
                width={plotW}
                height={plotH}
                n={n}
                xAt={xAt}
                xs={nax ? nax.xs : undefined}
                ariaLabel={`${xT ?? ''} / ${yName}`}
                tipFor={(i) => ({
                  title: spec.categories[i],
                  rows: has(i)
                    ? [
                        { label: tr(t, 'high'), value: fv(spec.high[i]), key: 'none' as const },
                        { label: tr(t, 'low'), value: fv(spec.low[i]), key: 'none' as const },
                        ...(showClose && spec.close![i] !== null ? [{ label: tr(t, 'close'), value: fv(spec.close![i]), key: 'none' as const }] : []),
                      ]
                    : [],
                })}
              />
            )}
            {nax ? <XAxis axis={{ scale: nax.scale, ticks: nax.ticks, format: nax.format }} top={m.top} height={plotH} left={m.left} width={plotW} /> : <CatLabels info={info} n={n} xAt={xAt} bottom={m.top + plotH} />}
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            <AxisTitles xTitle={xT} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
