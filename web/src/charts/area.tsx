/* Area charts over a categorical x axis: overlapping, stacked or 100% stacked.  Studio only
   (AreaSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AxisTitles, Baseline, ChartShell, FONT, YAxis, plotMargins, seriesColor, useTip, type ChartCommonProps, type LegendItem, type PlotArea, type TipContent } from './shell';
import { clamp, formatPercent, formatValue, linearScale, measureText, niceTicks, percentTickFormatter, tickFormatter, truncateText } from './scale';
import { thinEvery } from './bar';
import { tr } from './strings';
import type { AreaSpec } from './studioTypes';
import { useAxisReg, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { stackSegments } from './studioMath';

const f1 = (v: number) => v.toFixed(1);

function AreaPlot({ spec, area, locale, t }: { spec: AreaSpec; area: PlotArea; locale?: string; t: ChartCommonProps['t'] }) {
  const tip = useTip();
  const style = useStyle();
  const reg = useAxisReg();
  const fs = fontScaleOf(style);
  const [hi, setHi] = useState<number | null>(null);
  const n = spec.categories.length;
  const S = spec.series.length;
  const stacked = spec.stack !== 'none';
  const pct = spec.stack === 'stack100';
  const vals = spec.series.map((s) => s.values);
  const segs = stacked ? stackSegments(vals, spec.stack as 'stack' | 'stack100') : [];
  let lo = 0;
  let top = 0;
  if (stacked) {
    for (const g of segs) {
      top = Math.max(top, g.v0, g.v1);
      lo = Math.min(lo, g.v0, g.v1);
    }
  } else {
    for (const s of vals) for (const v of s) if (v !== null) (top = Math.max(top, v)), (lo = Math.min(lo, v));
  }
  if (pct) top = Math.max(top, 100);
  const yCount = clamp(Math.floor(area.height / 48), 3, 9);
  const yt = applyDomain(niceTicks(lo, top || 1, yCount), style?.yMin, style?.yMax, yCount);
  const fy = pct ? percentTickFormatter(yt.step, locale) : tickFormatter(yt.step, yt.ticks, locale);
  const yName = pct ? tr(t, 'percent') : spec.ylabel;
  const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, xTitle: spec.xlabel, right: 16, style });
  const plotW = Math.max(40, area.width - m.left - m.right);
  const plotH = Math.max(40, area.height - m.top - m.bottom);
  const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
  const inset = n > 1 ? Math.min(14, plotW / 8) : 0;
  const xs = spec.categories.map((_, i) => (n > 1 ? m.left + inset + ((plotW - 2 * inset) * i) / (n - 1) : m.left + plotW / 2));
  reg.x = (i: number) => (n > 1 ? m.left + inset + ((plotW - 2 * inset) * i) / (n - 1) : m.left + plotW / 2);
  reg.top = m.top;
  reg.height = plotH;
  const base = sy(clamp(0, yt.domain[0], yt.domain[1]));

  // one polygon per series; null values break the overlapping areas into runs
  const polys: { si: number; d: string; line: string }[] = [];
  if (stacked) {
    for (let si = 0; si < S; si++) {
      const mine = segs.filter((g) => g.series === si);
      if (!mine.length) continue;
      const up = mine.map((g) => `${f1(xs[g.cat])},${f1(sy(g.v1))}`);
      const down = mine.map((g) => `${f1(xs[g.cat])},${f1(sy(g.v0))}`).reverse();
      polys.push({ si, d: `M${up.join('L')}L${down.join('L')}Z`, line: `M${up.join('L')}` });
    }
  } else {
    spec.series.forEach((s, si) => {
      let run: number[] = [];
      const flush = () => {
        if (run.length) {
          const up = run.map((i) => `${f1(xs[i])},${f1(sy(s.values[i]!))}`);
          polys.push({ si, d: `M${f1(xs[run[0]])},${f1(base)}L${up.join('L')}L${f1(xs[run[run.length - 1]])},${f1(base)}Z`, line: `M${up.join('L')}` });
        }
        run = [];
      };
      s.values.forEach((v, i) => (v === null ? flush() : run.push(i)));
      flush();
    });
  }

  const showValues = style?.valueLabels === true && n * S <= 40 && !stacked;
  const named = S > 1;
  const fmt = (v: number) => formatValue(v, locale, 3);
  const tipFor = (ci: number): TipContent => {
    const total = vals.reduce((s, ser) => s + (ser[ci] ?? 0), 0);
    return {
      title: spec.xlabel ? `${spec.xlabel}: ${spec.categories[ci]}` : spec.categories[ci],
      rows: [
        ...spec.series.map((s, si) => {
          const v = s.values[ci];
          return {
            label: named ? s.name : spec.ylabel || tr(t, 'value'),
            value: v === null ? '—' : fmt(v) + (pct && total ? `  (${formatPercent(v / total, locale)})` : ''),
            color: seriesColor(si),
            key: 'rect' as const,
          };
        }),
        ...(stacked && named ? [{ label: tr(t, 'total'), value: fmt(total), key: 'none' as const }] : []),
      ],
    };
  };
  const pick = (ci: number, at: { clientX: number; clientY: number }) => {
    setHi(ci);
    tip.show(at, tipFor(ci));
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!n) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rc.left + m.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    pick(best, e);
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (!n) return;
    let i = hi ?? -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Escape') {
      setHi(null);
      tip.hide();
      return;
    } else return;
    e.preventDefault();
    const rc = e.currentTarget.getBoundingClientRect();
    pick(i, { clientX: rc.left + xs[i] - m.left, clientY: rc.top + plotH / 2 });
  };
  const leave = () => {
    setHi(null);
    tip.hide();
  };

  const band = n > 1 ? (plotW - 2 * inset) / (n - 1) : plotW;
  const longest = spec.categories.reduce((a, b) => (b.length > a.length ? b : a), '');
  const every = thinEvery(measureText(longest, FONT.tick * fs), band);
  const hasData = vals.some((s) => s.some((v) => v !== null));

  return (
    <g>
      <defs>
        <clipPath id={area.uid + '-ac'}>
          <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
        </clipPath>
      </defs>
      <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
      <g className="pspp-chart__axis pspp-chart__axis--x" aria-hidden="true">
        {spec.categories.map((c, i) =>
          i % every ? null : (
            <g key={i}>
              <line className="pspp-chart__tickmark" x1={Math.round(xs[i]) + 0.5} x2={Math.round(xs[i]) + 0.5} y1={m.top + plotH} y2={m.top + plotH + 4} />
              <text className="pspp-chart__tick" x={xs[i]} y={m.top + plotH + 14 * fs + 1} textAnchor="middle">
                {truncateText(c, Math.max(24, band * every - 6), FONT.tick * fs)}
              </text>
            </g>
          ),
        )}
      </g>
      <g clipPath={`url(#${area.uid}-ac)`}>
        {polys.map((p) => (
          <g key={p.si}>
            <path d={p.d} style={{ fill: seriesColor(p.si), fillOpacity: stacked ? 0.85 : 0.3, stroke: stacked ? 'var(--c-surface)' : 'none', strokeWidth: 1 }} />
            <path className="pspp-chart__line" d={p.line} style={{ stroke: seriesColor(p.si), strokeWidth: stacked ? 1.25 : 2 }} />
          </g>
        ))}
        {showValues &&
          spec.series.map((s, si) =>
            s.values.map((v, i) =>
              v === null ? null : (
                <text key={si + ':' + i} className="pspp-chart__value" x={xs[i]} y={sy(v) - 6} textAnchor="middle">
                  {formatValue(v, locale, 2)}
                </text>
              ),
            ),
          )}
      </g>
      <Baseline x1={m.left} x2={m.left + plotW} y={base} />
      {hi !== null && <line data-export="omit" className="pspp-chart__grid" x1={xs[hi]} x2={xs[hi]} y1={m.top} y2={m.top + plotH} style={{ strokeDasharray: '3 3', stroke: 'var(--c-axis)' }} />}
      <rect
        data-export="omit"
        className="pspp-chart__hit"
        x={m.left}
        y={m.top}
        width={plotW}
        height={plotH}
        tabIndex={0}
        role="graphics-symbol"
        aria-label={`${spec.xlabel} / ${spec.ylabel}`}
        onPointerMove={onMove}
        onPointerLeave={leave}
        onKeyDown={onKey}
        onBlur={leave}
      />
      {!hasData && (
        <text className="pspp-chart__empty" x={m.left + plotW / 2} y={m.top + plotH / 2} textAnchor="middle" dominantBaseline="central">
          {tr(t, 'noData')}
        </text>
      )}
      <AxisTitles xTitle={spec.xlabel} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
    </g>
  );
}

export function AreaChart({ spec, ...c }: { spec: AreaSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'areaChart');
  const named = spec.series.length > 1;
  const legend: LegendItem[] = spec.series.map((s, i) => ({ label: s.name || tr(t, 'missing'), kind: 'rect', color: seriesColor(i) }));
  const rows: string[][] = [];
  for (const s of spec.series) spec.categories.forEach((cat, i) => rows.push([...(named ? [s.name] : []), cat, s.values[i] === null ? '' : formatValue(s.values[i], locale, 3)]));
  return (
    <ChartShell
      {...c}
      title={title}
      legendTitle={spec.legendTitle}
      legend={named ? legend : undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaLines', { count: spec.series.length })}: ${spec.series.map((s) => s.name).join(', ')}.`}
      table={{
        columns: [...(named ? [spec.legendTitle || tr(t, 'group')] : []), spec.xlabel || tr(t, 'category'), spec.ylabel || tr(t, 'value')],
        rows,
        numeric: [...(named ? [false] : []), false, true],
      }}
    >
      {(area) => <AreaPlot spec={spec} area={area} locale={locale} t={t} />}
    </ChartShell>
  );
}
