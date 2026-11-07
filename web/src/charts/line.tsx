/* Line charts over a categorical x axis: GLM profile plots (estimated marginal means per level of
   one factor, a line per level of another) and GRAPH /LINE summaries.  Hover or arrow keys pick a
   category and show every series' value there (with its error bar, if any). */

import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  AxisTitles,
  Baseline,
  ChartShell,
  FONT,
  GROUP_SHAPES,
  Marker,
  YAxis,
  plotMargins,
  seriesColor,
  useTip,
  type ChartCommonProps,
  type LegendItem,
  type PlotArea,
  type TipContent,
} from './shell';
import { clamp, formatValue, linearScale, niceTicks, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { LineSpec } from './lineSpec';

const f1 = (v: number) => v.toFixed(1);

/** Path through the series' values; a missing value breaks the line. */
function linePath(vals: (number | null)[], xs: number[], sy: (v: number) => number): string {
  let d = '';
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${f1(xs[i])},${f1(sy(v))}`;
    pen = true;
  });
  return d;
}

function LinePlot({ spec, area, locale, colors, t }: { spec: LineSpec; area: PlotArea; locale?: string; colors: string[]; t: ChartCommonProps['t'] }) {
  const tip = useTip();
  const [hi, setHi] = useState<number | null>(null);
  const n = spec.categories.length;
  const all: number[] = [];
  for (const s of spec.series) for (const arr of [s.values, s.lo ?? [], s.hi ?? []]) for (const v of arr) if (v !== null) all.push(v);
  const lo = all.length ? Math.min(...all) : 0;
  const hiV = all.length ? Math.max(...all) : 1;
  const pad = (hiV - lo) * 0.06 || Math.abs(hiV) * 0.1 || 1;
  const y = niceTicks(lo - pad, hiV + pad, clamp(Math.floor(area.height / 48), 3, 9));
  const fy = tickFormatter(y.step, y.ticks, locale);
  const m = plotMargins({ yTickLabels: y.ticks.map(fy), yTitle: spec.ylabel, xTitle: spec.xlabel, right: 16 });
  const plotW = Math.max(40, area.width - m.left - m.right);
  const plotH = Math.max(40, area.height - m.top - m.bottom);
  const band = plotW / Math.max(1, n);
  const xs = spec.categories.map((_, i) => m.left + band * (i + 0.5));
  const sy = linearScale(y.domain, [m.top + plotH, m.top]);
  const S = spec.series.length;
  // with error bars, nudge the series apart so overlapping bars stay readable
  const dodge = spec.errorLabel ? Math.min(7, band * 0.09) : 0;
  const sx = (si: number) => xs.map((x) => x + (si - (S - 1) / 2) * dodge);
  const named = S > 1;
  const r = n > 24 ? 2.5 : 4;

  const tipFor = (ci: number): TipContent => ({
    title: spec.xlabel ? `${spec.xlabel}: ${spec.categories[ci]}` : spec.categories[ci],
    rows: spec.series.map((s, si) => {
      const v = s.values[ci];
      const l = s.lo?.[ci];
      const h = s.hi?.[ci];
      const ci95 = l != null && h != null ? `  [${formatValue(l, locale, 3)}, ${formatValue(h, locale, 3)}]` : '';
      return {
        label: named ? s.name : spec.ylabel,
        value: v === null ? '—' : formatValue(v, locale, 3) + ci95,
        color: colors[si],
        key: spec.markers ? ('marker' as const) : ('line' as const),
        shape: GROUP_SHAPES[si % GROUP_SHAPES.length],
      };
    }),
  });
  const pick = (ci: number, at: { clientX: number; clientY: number }) => {
    setHi(ci);
    tip.show(at, tipFor(ci));
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rc = e.currentTarget.getBoundingClientRect();
    const ci = clamp(Math.floor((e.clientX - rc.left) / band), 0, n - 1);
    pick(ci, e);
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
    const v = spec.series.map((s) => s.values[i]).find((x) => x !== null);
    pick(i, { clientX: rc.left + xs[i] - m.left, clientY: rc.top + (v != null ? sy(v) : m.top + plotH / 2) - m.top });
  };
  const leave = () => {
    setHi(null);
    tip.hide();
  };

  // thin the category labels when they would collide
  const maxLab = Math.max(0, ...spec.categories.map((c) => c.length));
  const every = band < 28 && maxLab > 2 ? Math.ceil(28 / band) : 1;

  return (
    <g>
      <YAxis axis={{ scale: sy, ticks: y.ticks, format: fy }} left={m.left} width={plotW} />
      <g className="pspp-chart__axis pspp-chart__axis--x" aria-hidden="true">
        {spec.categories.map((c, i) =>
          i % every ? null : (
            <g key={i}>
              <line className="pspp-chart__tickmark" x1={Math.round(xs[i]) + 0.5} x2={Math.round(xs[i]) + 0.5} y1={m.top + plotH} y2={m.top + plotH + 4} />
              <text className="pspp-chart__tick" x={xs[i]} y={m.top + plotH + 15} textAnchor="middle">
                {truncateText(c, Math.max(24, band * every - 6), FONT.tick)}
              </text>
            </g>
          ),
        )}
      </g>
      <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
      {hi !== null && <line data-export="omit" className="pspp-chart__grid" x1={xs[hi]} x2={xs[hi]} y1={m.top} y2={m.top + plotH} style={{ strokeDasharray: '3 3' }} />}
      {spec.series.map((s, si) => {
        const px = sx(si);
        return (
          <g key={si}>
            {s.lo &&
              s.hi &&
              s.values.map((_, i) => {
                const l = s.lo![i];
                const h = s.hi![i];
                if (l === null || h === null) return null;
                const w = Math.min(5, band * 0.12);
                return (
                  <path
                    key={'e' + i}
                    d={`M${f1(px[i])},${f1(sy(l))}V${f1(sy(h))}M${f1(px[i] - w)},${f1(sy(l))}H${f1(px[i] + w)}M${f1(px[i] - w)},${f1(sy(h))}H${f1(px[i] + w)}`}
                    style={{ stroke: colors[si], strokeWidth: 1.25, fill: 'none', opacity: 0.75 }}
                  />
                );
              })}
            <path className="pspp-chart__line" d={linePath(s.values, px, sy)} style={{ stroke: colors[si] }} />
            {spec.markers &&
              s.values.map((v, i) =>
                v === null ? null : <Marker key={i} shape={GROUP_SHAPES[si % GROUP_SHAPES.length]} x={px[i]} y={sy(v)} r={hi === i ? r + 1.5 : r} color={colors[si]} />,
              )}
          </g>
        );
      })}
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
      {!all.length && (
        <text className="pspp-chart__empty" x={m.left + plotW / 2} y={m.top + plotH / 2} textAnchor="middle" dominantBaseline="central">
          {tr(t, 'noData')}
        </text>
      )}
      <AxisTitles xTitle={spec.xlabel} yTitle={spec.ylabel} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
    </g>
  );
}

export function LineChart({ spec, ...c }: { spec: LineSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const colors = spec.series.map((_, i) => seriesColor(i));
  const title = spec.title || tr(t, 'untitled');
  const named = spec.series.length > 1;
  const legend: LegendItem[] = spec.series.map((s, i) => ({ label: s.name, kind: spec.markers ? 'marker' : 'line', shape: GROUP_SHAPES[i % GROUP_SHAPES.length], color: colors[i] }));
  const bars = !!spec.errorLabel && spec.series.some((s) => s.lo);
  const rows: string[][] = [];
  for (const s of spec.series)
    spec.categories.forEach((cat, i) => {
      const v = s.values[i];
      rows.push([
        ...(named ? [s.name] : []),
        cat,
        v === null ? '' : formatValue(v, locale, 3),
        ...(bars ? [s.lo?.[i] != null ? formatValue(s.lo[i], locale, 3) : '', s.hi?.[i] != null ? formatValue(s.hi[i], locale, 3) : ''] : []),
      ]);
    });
  return (
    <ChartShell
      {...c}
      title={title}
      subtitle={bars ? tr(t, 'errorBars', { label: spec.errorLabel }) : undefined}
      legend={named ? legend : undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaLines', { count: spec.series.length })}: ${spec.series.map((s) => s.name).join(', ')}.`}
      table={{
        columns: [...(named ? [spec.legendTitle || tr(t, 'group')] : []), spec.xlabel || tr(t, 'category'), spec.ylabel || tr(t, 'value'), ...(bars ? [tr(t, 'lowerBound'), tr(t, 'upperBound')] : [])],
        rows,
        numeric: [...(named ? [false] : []), false, true, ...(bars ? [true, true] : [])],
      }}
    >
      {(area) => <LinePlot spec={spec} area={area} locale={locale} colors={colors} t={t} />}
    </ChartShell>
  );
}
