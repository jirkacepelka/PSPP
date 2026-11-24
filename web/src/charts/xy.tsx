/* Point/line charts on two linear axes: normal Q-Q (and detrended), ROC,
   scatterplot, scree and spread-vs-level all share XYPlot. */

import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  AxisTitles,
  Baseline,
  ChartShell,
  GROUP_SHAPES,
  Marker,
  XAxis,
  YAxis,
  plotMargins,
  seriesColor,
  useTip,
  type ChartCommonProps,
  type LegendItem,
  type MarkerShape,
  type PlotArea,
  type TipContent,
} from './shell';
import { clamp, formatValue, linearScale, niceStep, niceTicks, padExtent, tickFormatter, ticksWithin, type Ticks } from './scale';
import { tr } from './strings';
import type { NpSpec, Pt, RocSpec, ScatterSpec, ScreeSpec, SpreadLevelSpec } from './types';
import { useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';
import { fitBand, fitCurve, type BandPoint, type FitKind } from './studioMath';
import { drawMarginals, type MarginalGroup } from './marginals';

export interface XYSeries {
  name: string;
  color: string;
  shape: MarkerShape;
  points: Pt[];
  line?: boolean;
  markers?: boolean;
  /** stroke-dasharray of the line, e.g. '6 4' */
  dash?: string;
  /** false: not a hover/keyboard target (reference lines drawn as series) */
  hover?: boolean;
  /** marker radius, default 4 */
  r?: number;
}

/** Translucent band between lo and hi (confidence band of a fit). */
export interface Band {
  color: string;
  pts: { x: number; lo: number; hi: number }[];
}

/** Area under a curve down to `base` (density fill). */
export interface Fill {
  color: string;
  pts: Pt[];
  base: number;
}

export interface RefLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A fitted curve drawn over the points (not hoverable). */
export interface FitLine {
  color: string;
  curve: Pt[];
}

interface XYPlotProps {
  area: PlotArea;
  locale?: string;
  x: Ticks;
  y: Ticks;
  xTitle?: string;
  yTitle?: string;
  series: XYSeries[];
  refLines?: RefLine[];
  fits?: FitLine[];
  bands?: Band[];
  fills?: Fill[];
  ariaLabel?: string;
  xGrid?: boolean;
  xFormat?: (v: number) => string;
  emptyText?: string;
  tipFor: (s: XYSeries, p: Pt) => TipContent;
  /** room kept free above / right of the plot for marginal plots, and what to draw there (see marginals.tsx) */
  marginal?: { top: number; right: number; draw: (g: PlotGeometry) => ReactNode };
}

/** Pixel geometry of a finished XYPlot, handed to `marginal.draw` so side plots line up with the axes. */
export interface PlotGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  sx: (v: number) => number;
  sy: (v: number) => number;
}

interface FlatPt {
  px: number;
  py: number;
  s: number;
  p: Pt;
}

export function XYPlot(props: XYPlotProps) {
  const { area, series, locale } = props;
  const tip = useTip();
  const style = useStyle();
  const x = applyDomain(props.x, style?.xMin, style?.xMax, clamp(Math.floor(area.width / 90), 3, 10));
  const y = applyDomain(props.y, style?.yMin, style?.yMax, clamp(Math.floor(area.height / 48), 3, 9));
  const fx = props.xFormat && x === props.x ? props.xFormat : tickFormatter(x.step, x.ticks, locale);
  const fy = tickFormatter(y.step, y.ticks, locale);
  const m = plotMargins({ yTickLabels: y.ticks.map(fy), yTitle: props.yTitle, xTitle: props.xTitle, right: 16 + (props.marginal?.right ?? 0), style });
  m.top += props.marginal?.top ?? 0;
  const plotW = Math.max(40, area.width - m.left - m.right);
  const plotH = Math.max(40, area.height - m.top - m.bottom);
  const sx = linearScale(x.domain, [m.left, m.left + plotW]);
  const sy = linearScale(y.domain, [m.top + plotH, m.top]);
  const clipId = `${area.uid}-clip`;

  const flat = useMemo(() => {
    const out: FlatPt[] = [];
    series.forEach((s, si) => s.hover !== false && s.points.forEach((p) => out.push({ px: sx(p[0]), py: sy(p[1]), s: si, p })));
    out.sort((a, b) => a.px - b.px || a.py - b.py);
    return out;
    // sx/sy are fully determined by the domains and plot geometry below.
  }, [series, x.domain[0], x.domain[1], y.domain[0], y.domain[1], plotW, plotH, m.left, m.top]);
  const [hi, setHi] = useState<number | null>(null);

  const showAt = (i: number, at: { clientX: number; clientY: number } | Element) => {
    setHi(i);
    const f = flat[i];
    tip.show(at, props.tipFor(series[f.s], f.p));
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - r.left + m.left;
    const ly = e.clientY - r.top + m.top;
    let best = -1;
    let bd = 32 * 32;
    for (let i = 0; i < flat.length; i++) {
      const dx = flat[i].px - lx;
      if (dx * dx > bd) continue;
      const dy = flat[i].py - ly;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) showAt(best, e);
    else {
      setHi(null);
      tip.hide();
    }
  };

  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (!flat.length) return;
    let i = hi ?? -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(flat.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = flat.length - 1;
    else if (e.key === 'Escape') {
      setHi(null);
      tip.hide();
      return;
    } else return;
    e.preventDefault();
    const f = flat[i];
    const r = e.currentTarget.getBoundingClientRect();
    setHi(i);
    tip.show({ clientX: r.left + f.px - m.left, clientY: r.top + f.py - m.top }, props.tipFor(series[f.s], f.p));
  };

  const xAxis = { scale: sx, ticks: x.ticks, format: fx };
  const yAxis = { scale: sy, ticks: y.ticks, format: fy };
  const h = hi !== null ? flat[hi] : null;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left - 6} y={m.top - 6} width={plotW + 12} height={plotH + 12} />
        </clipPath>
        <clipPath id={clipId + 'l'}>
          <rect x={m.left} y={m.top} width={plotW} height={plotH} />
        </clipPath>
      </defs>
      <YAxis axis={yAxis} left={m.left} width={plotW} />
      <XAxis axis={xAxis} top={m.top} height={plotH} left={m.left} width={plotW} grid={props.xGrid} />
      <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
      <g clipPath={`url(#${clipId}l)`}>
        {(props.refLines ?? []).map((l, i) => (
          <line key={i} className="pspp-chart__ref" x1={sx(l.x1)} y1={sy(l.y1)} x2={sx(l.x2)} y2={sy(l.y2)} />
        ))}
      </g>
      <g clipPath={`url(#${clipId}l)`} aria-hidden="true">
        {(props.fills ?? []).map((f, i) => (
          <path
            key={'a' + i}
            d={`M${sx(f.pts[0][0]).toFixed(1)},${sy(f.base).toFixed(1)}${f.pts.map((p) => `L${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('')}L${sx(f.pts[f.pts.length - 1][0]).toFixed(1)},${sy(f.base).toFixed(1)}Z`}
            style={{ fill: f.color, fillOpacity: 0.18, stroke: 'none' }}
            pointerEvents="none"
          />
        ))}
        {(props.bands ?? []).map((b, i) =>
          b.pts.length < 2 ? null : (
            <path
              key={'b' + i}
              d={`M${b.pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.hi).toFixed(1)}`).join('L')}L${[...b.pts].reverse().map((p) => `${sx(p.x).toFixed(1)},${sy(p.lo).toFixed(1)}`).join('L')}Z`}
              style={{ fill: b.color, fillOpacity: 0.16, stroke: 'none' }}
              pointerEvents="none"
            />
          ),
        )}
      </g>
      <g clipPath={`url(#${clipId}l)`}>
        {(props.fits ?? []).map((f, i) => (
          <polyline
            key={'f' + i}
            className="pspp-chart__line pspp-chart__fit"
            points={f.curve.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}
            style={{ stroke: f.color }}
            pointerEvents="none"
          />
        ))}
      </g>
      <g clipPath={`url(#${clipId})`}>
        {series.map((s, si) =>
          s.line && s.points.length > 1 ? (
            <polyline
              key={'l' + si}
              className="pspp-chart__line"
              points={s.points.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}
              style={{ stroke: s.color, ...(s.dash ? { strokeDasharray: s.dash } : {}) }}
              pointerEvents="none"
            />
          ) : null,
        )}
      </g>
      <g clipPath={`url(#${clipId})`}>
        {series.map((s, si) =>
          s.markers !== false ? (
            <g key={'m' + si}>
              {s.points.map((p, i) => (
                <Marker key={i} shape={s.shape} x={sx(p[0])} y={sy(p[1])} r={s.r} color={s.color} />
              ))}
            </g>
          ) : null,
        )}
      </g>
      {h && (
        <g data-export="omit" pointerEvents="none">
          <circle cx={h.px} cy={h.py} r={8} className="pspp-chart__hover-ring" />
          {series[h.s].markers === false && <Marker shape="circle" x={h.px} y={h.py} color={series[h.s].color} />}
        </g>
      )}
      <rect
        data-export="omit"
        className="pspp-chart__hit"
        x={m.left}
        y={m.top}
        width={plotW}
        height={plotH}
        tabIndex={0}
        role="graphics-symbol"
        aria-label={props.ariaLabel ?? `${props.xTitle ?? ''} / ${props.yTitle ?? ''}`}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setHi(null);
          tip.hide();
        }}
        onKeyDown={onKey}
        onBlur={() => {
          setHi(null);
          tip.hide();
        }}
      />
      {!flat.length && props.emptyText && (
        <text className="pspp-chart__empty" x={m.left + plotW / 2} y={m.top + plotH / 2} textAnchor="middle" dominantBaseline="central">
          {props.emptyText}
        </text>
      )}
      {props.marginal?.draw({ left: m.left, top: m.top, width: plotW, height: plotH, xDomain: x.domain, yDomain: y.domain, sx, sy })}
      <AxisTitles xTitle={props.xTitle} yTitle={props.yTitle} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
    </g>
  );
}

/* ------------------------------------------------------------- helpers */

export function extent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

export const xCount = (w: number) => clamp(Math.floor(w / 90), 3, 10);
export const yCount = (h: number) => clamp(Math.floor(h / 48), 3, 9);

export function xyTable(xName: string, yName: string, series: XYSeries[], locale?: string, groupCol?: string) {
  const rows: string[][] = [];
  for (const s of series) for (const p of s.points) rows.push([...(groupCol ? [s.name] : []), formatValue(p[0], locale), formatValue(p[1], locale)]);
  return {
    columns: [...(groupCol ? [groupCol] : []), xName, yName],
    rows,
    numeric: [...(groupCol ? [false] : []), true, true],
  };
}

export const pointTip =
  (xName: string, yName: string, locale: string | undefined, named: boolean) =>
  (s: XYSeries, p: Pt): TipContent => ({
    title: named ? s.name : undefined,
    rows: [
      { label: yName, value: formatValue(p[1], locale), color: s.color, key: s.line && s.markers === false ? 'line' : 'marker', shape: s.shape },
      { label: xName, value: formatValue(p[0], locale), key: 'none' },
    ],
  });

/* ------------------------------------------------------------- normal Q-Q */

export function NpChart({ spec, ...c }: { spec: NpSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const name = spec.title || tr(t, 'untitled');
  const title = tr(t, spec.detrended ? 'detrendedNpTitle' : 'npTitle', { name });
  const xName = tr(t, 'observedValue');
  const yName = tr(t, spec.detrended ? 'devFromNormal' : 'expectedNormal');
  const series: XYSeries[] = [{ name: tr(t, 'observations'), color: seriesColor(0), shape: 'circle', points: spec.points }];
  const legend: LegendItem[] = [
    { label: series[0].name, kind: 'marker', color: seriesColor(0), shape: 'circle' },
    { label: tr(t, 'referenceLine'), kind: 'line', color: 'var(--c-reference)' },
  ];
  const [px0, px1] = extent(spec.points.map((p) => p[0]));
  const [py0, py1] = extent(spec.points.map((p) => p[1]));
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaPoints', { count: spec.points.length })}.`}
      table={xyTable(xName, yName, series, locale)}
    >
      {(area) => {
        let xDom: [number, number];
        let yDom: [number, number];
        if (spec.detrended) {
          xDom = padExtent(px0, px1, 0.05);
          yDom = padExtent(Math.min(py0, 0), Math.max(py1, 0), 0.05);
        } else {
          const lo = spec.xLower ?? px0;
          const hi = spec.xUpper ?? px1;
          const slack = (hi - lo) * 0.05;
          xDom = [Math.min(lo - slack, px0), Math.max(hi + slack, px1)];
          yDom = [Math.min(spec.yFirst ?? py0, py0), Math.max(spec.yLast ?? py1, py1)];
        }
        const xt = niceTicks(xDom[0], xDom[1], xCount(area.width));
        const yt = niceTicks(yDom[0], yDom[1], yCount(area.height));
        const ref: RefLine[] = [];
        if (spec.detrended) ref.push({ x1: xt.domain[0], y1: 0, x2: xt.domain[1], y2: 0 });
        else if (spec.slope !== null && spec.intercept !== null) {
          const [a, b] = xt.domain;
          ref.push({ x1: a, y1: spec.intercept + spec.slope * a, x2: b, y2: spec.intercept + spec.slope * b });
        }
        return <XYPlot emptyText={tr(t, 'noData')} area={area} locale={locale} x={xt} y={yt} xTitle={xName} yTitle={yName} series={series} refLines={ref} tipFor={pointTip(xName, yName, locale, false)} />;
      }}
    </ChartShell>
  );
}

/* -------------------------------------------------------------------- ROC */

export function RocChart({ spec, ...c }: { spec: RocSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'rocCurve');
  const xName = tr(t, 'oneMinusSpecificity');
  const yName = tr(t, 'sensitivity');
  const series: XYSeries[] = spec.curves.map((cv, i) => {
    // The serializer brackets PSPP's descending cutpoints with (0,0) and
    // (1,1); sorting yields the monotone staircase PSPP draws.
    const pts = cv.points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { name: cv.name || `${tr(t, 'curve')} ${i + 1}`, color: seriesColor(i), shape: GROUP_SHAPES[i % 8], points: pts, line: true, markers: false };
  });
  const legend: LegendItem[] = series.map((s) => ({ label: s.name, kind: 'line' as const, color: s.color }));
  if (spec.reference) legend.push({ label: tr(t, 'referenceLine'), kind: 'line', color: 'var(--c-reference)' });
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend.length > 1 ? legend : undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaCurves', { count: series.length })}: ${series.map((s) => s.name).join(', ')}.`}
      table={xyTable(xName, yName, series, locale, series.length > 1 ? tr(t, 'curve') : undefined)}
      plotHeight={(w) => clamp(Math.round(w * 0.82), 260, 520)}
    >
      {(area) => {
        const n = area.width < 300 ? 5 : 10;
        const ticks = ticksWithin(0, 1, n);
        const xt = { ...ticks, domain: [0, 1] as [number, number] };
        const yt = { ...ticksWithin(0, 1, n), domain: [0, 1] as [number, number] };
        return (
          <XYPlot
            emptyText={tr(t, 'noData')}
            area={area}
            locale={locale}
            x={xt}
            y={yt}
            xGrid
            xTitle={xName}
            yTitle={yName}
            series={series}
            refLines={spec.reference ? [{ x1: 0, y1: 0, x2: 1, y2: 1 }] : []}
            tipFor={pointTip(xName, yName, locale, series.length > 1)}
          />
        );
      }}
    </ChartShell>
  );
}

/* -------------------------------------------------------------- scatter */

export function ScatterChart({ spec, ...c }: { spec: ScatterSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'scatterplot');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const series: XYSeries[] = useMemo(() => {
    if (!spec.byvar) return [{ name: tr(t, 'observations'), color: seriesColor(0), shape: 'circle' as MarkerShape, points: spec.points.map((p) => [p.x, p.y] as Pt) }];
    const order: string[] = [];
    const map = new Map<string, Pt[]>();
    for (const p of spec.points) {
      const g = p.group || tr(t, 'missing');
      let key = g;
      if (!map.has(g) && order.length >= 8) key = '\u0000other';
      if (!map.has(key)) {
        map.set(key, []);
        if (key !== '\u0000other') order.push(key);
      }
      map.get(key)!.push([p.x, p.y]);
    }
    const out: XYSeries[] = order.map((g, i) => ({ name: g, color: seriesColor(i), shape: GROUP_SHAPES[i], points: map.get(g)! }));
    const other = map.get('\u0000other');
    if (other) out.push({ name: tr(t, 'other'), color: 'var(--c-other)', shape: 'circle', points: other });
    return out;
  }, [spec, t]);
  const fitKind = spec.fit && spec.fit !== 'none' ? (spec.fit as FitKind) : null;
  const fitName = fitKind ? tr(t, ({ linear: 'fitLinear', quadratic: 'fitQuadratic', cubic: 'fitCubic', loess: 'fitLoess' } as const)[fitKind]) : '';
  const fitResults = useMemo(() => {
    if (!fitKind) return [];
    const targets = spec.fitByGroup && series.length > 1 ? series.map((s) => ({ name: s.name, color: s.color, pts: s.points })) : [{ name: '', color: 'var(--c-ink)', pts: series.flatMap((s) => s.points) }];
    return targets.flatMap((g) => {
      if (!g.pts.length) return [];
      const x0 = Math.min(...g.pts.map((p) => p[0]));
      const x1 = Math.max(...g.pts.map((p) => p[0]));
      const r = fitCurve(g.pts, fitKind, x0, x1);
      // fitCi: 95 % band around the fit, see fitBand in studioMath.ts
      const band: BandPoint[] | null = r && spec.fitCi ? fitBand(g.pts, fitKind, x0, x1) : null;
      return r ? [{ ...g, ...r, band }] : [];
    });
  }, [fitKind, series, spec.fitByGroup, spec.fitCi]);
  const bands = fitResults.flatMap((f) => (f.band ? [{ color: f.color, pts: f.band }] : []));
  // marginal plots (phase 4): thickness 56 px, 40 on narrow charts
  const marginal = spec.marginals && spec.marginals !== 'none' ? spec.marginals : null;
  const marginalSize = (w: number) => (w < 480 ? 40 : 56);
  const fitLabel = (f: { name: string; r2: number | null }) =>
    [fitName, f.name].filter(Boolean).join(' · ') + (spec.showR2 && f.r2 !== null ? `, ${tr(t, 'rSquared')} = ${formatValue(f.r2, locale, 3)}` : '');
  const legend: LegendItem[] | undefined =
    series.length > 1 || spec.byvar || fitResults.length
      ? [
          ...(series.length > 1 || spec.byvar ? series.map((s) => ({ label: s.name, kind: 'marker' as const, color: s.color, shape: s.shape })) : []),
          ...fitResults.map((f) => ({ label: fitLabel(f), kind: 'line' as const, color: f.color })),
          ...(bands.length ? [{ label: tr(t, 'confidenceBand'), kind: 'rect' as const, color: bands[0].color }] : []),
        ]
      : undefined;
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      legendTitle={spec.byvar ?? undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaPoints', { count: spec.points.length })}${spec.byvar ? ', ' + tr(t, 'ariaGroups', { count: series.length }) : ''}.`}
      table={{ ...xyTable(xName, yName, series, locale, spec.byvar ?? undefined), note: fitResults.map(fitLabel).join('; ') || undefined }}
      plotHeight={marginal ? (w) => clamp(Math.round(w * 0.56), 240, 420) + marginalSize(w) : undefined}
    >
      {(area) => {
        const xs = spec.points.map((p) => p.x);
        const ys = spec.points.map((p) => p.y);
        const [ex0, ex1] = extent(xs);
        const [ey0, ey1] = extent(ys);
        const xd = padExtent(spec.xMin ?? ex0, spec.xMax ?? ex1, 0.02);
        const yd = padExtent(spec.yMin ?? ey0, spec.yMax ?? ey1, 0.02);
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
            fits={fitResults}
            bands={bands}
            tipFor={pointTip(xName, yName, locale, series.length > 1)}
            marginal={
              marginal
                ? {
                    top: marginalSize(area.width),
                    right: marginalSize(area.width),
                    draw: (g) =>
                      drawMarginals(
                        {
                          kind: marginal,
                          groups: series.map<MarginalGroup>((s) => ({ name: s.name, color: s.color, xs: s.points.map((p) => p[0]), ys: s.points.map((p) => p[1]) })),
                          size: marginalSize(area.width),
                          gap: 4,
                          tip: area.tip,
                          uid: area.uid,
                          locale,
                          names: { x: xName, y: yName, count: tr(t, 'count'), median: tr(t, 'median'), q1: tr(t, 'q1'), q3: tr(t, 'q3'), group: tr(t, 'group') },
                          label: (axis) => tr(t, marginal === 'histogram' ? 'marginalHistogram' : marginal === 'density' ? 'marginalDensity' : 'marginalBox', { name: axis === 'x' ? xName : yName }),
                        },
                        g,
                      ),
                  }
                : undefined
            }
          />
        );
      }}
    </ChartShell>
  );
}

/* ---------------------------------------------------------------- scree */

export function ScreeChart({ spec, ...c }: { spec: ScreeSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'screePlot');
  const xName = !spec.xlabel || spec.xlabel === 'Component Number' ? tr(t, 'componentNumber') : spec.xlabel;
  const yName = tr(t, 'eigenvalue');
  const series: XYSeries[] = [
    { name: yName, color: seriesColor(0), shape: 'circle', points: spec.values.map((v, i) => [i + 1, v] as Pt), line: true },
  ];
  const n = spec.values.length;
  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${tr(t, 'ariaValues', { count: n })}: ${spec.values.map((v) => formatValue(v, locale)).join(', ')}.`}
      table={{
        columns: [xName, yName],
        rows: spec.values.map((v, i) => [String(i + 1), formatValue(v, locale, 4)]),
        numeric: [true, true],
      }}
    >
      {(area) => {
        const maxAbs = spec.values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        const yt = niceTicks(0, maxAbs || 1, yCount(area.height));
        const step = Math.max(1, niceStep(n, Math.max(2, Math.floor(area.width / 48))));
        const ticks: number[] = step === 1 ? [] : [1];
        for (let i = step; i <= n; i += step) ticks.push(i);
        const xt: Ticks = { ticks, step, domain: [0.5, n + 0.5] };
        return (
          <XYPlot
            emptyText={tr(t, 'noData')}
            area={area}
            locale={locale}
            x={xt}
            y={yt}
            xFormat={(v) => String(v)}
            xTitle={xName}
            yTitle={yName}
            series={series}
            tipFor={(s, p) => ({
              title: `${tr(t, 'component')} ${p[0]}`,
              rows: [{ label: yName, value: formatValue(p[1], locale, 4), color: s.color, key: 'marker', shape: 'circle' }],
            })}
          />
        );
      }}
    </ChartShell>
  );
}

/* -------------------------------------------------------- spread vs level */

export function SpreadLevelChart({ spec, ...c }: { spec: SpreadLevelSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const name = spec.title || tr(t, 'untitled');
  const title = tr(t, 'spreadLevelTitle', { name });
  const subtitle = spec.power === null ? undefined : spec.power === 0 ? tr(t, 'logTransform') : tr(t, 'powerTransform', { power: formatValue(spec.power, locale) });
  const xName = tr(t, 'level');
  const yName = tr(t, 'spread');
  const series: XYSeries[] = [{ name: tr(t, 'observations'), color: seriesColor(0), shape: 'circle', points: spec.points }];
  return (
    <ChartShell
      {...c}
      title={title}
      subtitle={subtitle}
      ariaLabel={`${title}. ${subtitle ? subtitle + '. ' : ''}${tr(t, 'ariaPoints', { count: spec.points.length })}.`}
      table={xyTable(xName, yName, series, locale)}
    >
      {(area) => {
        const xd = padExtent(...extent(spec.points.map((p) => p[0])), 0.1);
        const yd = padExtent(...extent(spec.points.map((p) => p[1])), 0.1);
        const xt = niceTicks(xd[0], xd[1], xCount(area.width));
        const yt = niceTicks(yd[0], yd[1], yCount(area.height));
        return <XYPlot emptyText={tr(t, 'noData')} area={area} locale={locale} x={xt} y={yt} xTitle={xName} yTitle={yName} series={series} tipFor={pointTip(xName, yName, locale, false)} />;
      }}
    </ChartShell>
  );
}
