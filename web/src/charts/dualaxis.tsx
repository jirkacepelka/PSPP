/* Two value axes over one categorical axis; each side is drawn as bars or as a line, and each axis
   title takes the colour of its series.  Studio only (DualAxisSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Baseline, ChartShell, FONT, Marker, YAxis, barPath, markTip, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, measureText, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { DualAxisSpec } from './studioTypes';
import { axisTitle, useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';
import { alignedTicks } from './studioMath';
import { catLabels } from './bar';
import { CatLabels } from './catAxis';

type Side = DualAxisSpec['left'];

/** [min, max] of one side; bars always include zero. */
function extentOf(side: Side): [number, number] | null {
  const v = side.values.filter((x): x is number => x !== null);
  if (!v.length) return null;
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (side.kind === 'bar') {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else {
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  return [lo, hi];
}

export function DualAxisChart({ spec, ...c }: { spec: DualAxisSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'dualAxisChart');
  const n = spec.categories.length;
  const sides = [spec.left, spec.right];
  const colors = [seriesColor(0), seriesColor(1)];
  const name = (s: Side) => s.name || s.ylabel || tr(t, 'value');
  const xT = axisTitle(style, 'x', spec.xlabel);
  const fv = (v: number | null) => formatValue(v, locale);
  const legend: LegendItem[] = sides.map((s, i) => ({ label: name(s), kind: s.kind === 'bar' ? 'rect' : 'line', color: colors[i] }));
  const bothBars = spec.left.kind === 'bar' && spec.right.kind === 'bar';

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${name(spec.left)}, ${name(spec.right)}. ${tr(t, 'ariaCategories', { count: n })}: ${spec.categories
        .slice(0, 20)
        .map((cat, i) => `${cat} ${fv(spec.left.values[i])} / ${fv(spec.right.values[i])}`)
        .join('; ')}.`}
      table={{
        columns: [tr(t, 'category'), name(spec.left), name(spec.right)],
        rows: spec.categories.map((cat, i) => [cat, fv(spec.left.values[i]), fv(spec.right.values[i])]),
        numeric: [false, true, true],
      }}
      plotHeight={(w) => clamp(Math.round(w * 0.56), 240, 420) + catLabels(spec.categories, Math.max(1, (w - 130) / Math.max(1, n))).labelBand - 18 + (xT ? 20 : 0)}
    >
      {(area) => {
        const ext = sides.map(extentOf);
        if (!n || !ext[0] || !ext[1]) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        // both axes get the same number of intervals so their gridlines coincide
        const intervals = clamp(Math.floor(area.height / 56), 3, 7);
        const ticks = ext.map((e) => alignedTicks(e![0], e![1], intervals));
        const fmt = ticks.map((tk) => tickFormatter(tk.step, tk.ticks, locale));
        const yL = axisTitle(style, 'y', spec.left.ylabel || spec.left.name);
        const yR = style?.showTitle === false ? undefined : spec.right.ylabel || spec.right.name || undefined;
        const m = plotMargins({ yTickLabels: ticks[0].ticks.map(fmt[0]), yTitle: yL, style });
        const rightTickW = ticks[1].ticks.reduce((mx, v) => Math.max(mx, measureText(fmt[1](v), FONT.tick * fs)), 0);
        const right = Math.ceil(rightTickW + 12 + (yR ? 22 * fs : 0));
        const plotW = area.width - m.left - right;
        const band = plotW / n;
        const info = catLabels(spec.categories, band);
        const plotH = area.height - m.top - info.labelBand - 4 - (xT ? 20 : 0);
        const sL = linearScale(ticks[0].domain, [m.top + plotH, m.top]);
        const sR = linearScale(ticks[1].domain, [m.top + plotH, m.top]);
        const scales = [sL, sR];
        const xAt = (i: number) => m.left + band * (i + 0.5);
        area.reg.x = xAt;
        area.reg.top = m.top;
        area.reg.height = plotH;
        const slot = bothBars ? Math.min(22, band * 0.38) : Math.min(34, band * 0.6);
        const barX = (i: number, side: number) => (bothBars ? xAt(i) + (side === 0 ? -slot - 1 : 1) : xAt(i) - slot / 2);
        const f1 = (v: number) => v.toFixed(1);
        const base = (side: number) => scales[side](clamp(0, ticks[side].domain[0], ticks[side].domain[1]));
        const r = n > 24 ? 2.5 : 4;
        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-da'}>
                <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sL, ticks: ticks[0].ticks, format: fmt[0] }} left={m.left} width={plotW} />
            <g className="pspp-chart__axis" aria-hidden="true">
              {ticks[1].ticks.map((v) => (
                <text key={v} className="pspp-chart__tick" x={m.left + plotW + 8} y={Math.round(sR(v)) + 0.5} dominantBaseline="central" style={{ fill: colors[1] }}>
                  {fmt[1](v)}
                </text>
              ))}
            </g>
            <g clipPath={`url(#${area.uid}-da)`}>
              {sides.map((s, si) =>
                s.kind === 'bar'
                  ? s.values.map((v, i) =>
                      v === null ? null : <path key={si + ':' + i} d={barPath(barX(i, si), slot, base(si), scales[si](v))} style={{ fill: colors[si] }} pointerEvents="none" />,
                    )
                  : null,
              )}
              {sides.map((s, si) => {
                if (s.kind !== 'line') return null;
                let d = '';
                let pen = false;
                s.values.forEach((v, i) => {
                  if (v === null) pen = false;
                  else {
                    d += `${pen ? 'L' : 'M'}${f1(xAt(i))},${f1(scales[si](v))}`;
                    pen = true;
                  }
                });
                return (
                  <g key={'l' + si} pointerEvents="none">
                    <path className="pspp-chart__line" d={d} style={{ stroke: colors[si] }} />
                    {s.values.map((v, i) => (v === null ? null : <Marker key={i} shape={si === 0 ? 'circle' : 'square'} x={xAt(i)} y={scales[si](v)} r={r} color={colors[si]} />))}
                  </g>
                );
              })}
              {spec.categories.map((cat, i) => {
                const tip = {
                  title: cat,
                  rows: sides.map((s, si) => ({ label: name(s), value: fv(s.values[i]), color: colors[si], key: s.kind === 'bar' ? ('rect' as const) : ('line' as const) })),
                };
                return (
                  <g key={'h' + i} className="pspp-chart__mark" {...markTip(area.tip, tip, `${cat}: ${name(spec.left)} ${fv(spec.left.values[i])}, ${name(spec.right)} ${fv(spec.right.values[i])}`)}>
                    <rect x={xAt(i) - band / 2} y={m.top} width={band} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                  </g>
                );
              })}
            </g>
            <CatLabels info={info} n={n} xAt={xAt} bottom={m.top + plotH} />
            <Baseline x1={m.left} x2={m.left + plotW} y={base(0)} />
            <g aria-hidden="true">
              {xT && (
                <text className="pspp-chart__axis-title" x={m.left + plotW / 2} y={area.height - 4} textAnchor="middle">
                  {truncateText(xT, plotW + m.left * 0.8, FONT.axisTitle * fs)}
                </text>
              )}
              {yL && (
                <text className="pspp-chart__axis-title" transform={`translate(${11 * fs} ${m.top + plotH / 2}) rotate(-90)`} textAnchor="middle" dominantBaseline="central" style={{ fill: colors[0] }}>
                  {yL}
                </text>
              )}
              {yR && (
                <text className="pspp-chart__axis-title" transform={`translate(${m.left + plotW + right - 11 * fs} ${m.top + plotH / 2}) rotate(90)`} textAnchor="middle" dominantBaseline="central" style={{ fill: colors[1] }}>
                  {yR}
                </text>
              )}
            </g>
          </g>
        );
      }}
    </ChartShell>
  );
}
