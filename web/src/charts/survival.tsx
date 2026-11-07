/* Kaplan–Meier plots (KM, computed in src/ext/commands/km.ts): step curves of
   the survival function per group with censor marks, or its transforms
   (cumulative hazard −ln S, log survival ln S, one minus survival).  All
   text labels arrive in the spec, already translated by the analysis. */

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  AxisTitles,
  Baseline,
  ChartShell,
  XAxis,
  YAxis,
  plotMargins,
  seriesColor,
  useTip,
  type ChartCommonProps,
  type LegendItem,
  type PlotArea,
  type TipContent,
} from './shell';
import { clamp, formatValue, linearScale, niceTicks, tickFormatter, ticksWithin, type Ticks } from './scale';
import { tr } from './strings';
import type { Pt } from './types';
import type { SurvivalCurve, SurvivalSpec } from './survivalSpec';

/* --------------------------------------------------------------- render */

interface HitPt {
  px: number;
  py: number;
  curve: number;
  p: Pt;
  censored: boolean;
}

/** Step path: horizontal to each event time, then down (or up) to the new value. */
function stepPath(c: SurvivalCurve, sx: (v: number) => number, sy: (v: number) => number): string {
  if (!c.points.length) return '';
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(sx(c.points[0][0]))},${f(sy(c.points[0][1]))}`;
  for (let i = 1; i < c.points.length; i++) d += `H${f(sx(c.points[i][0]))}V${f(sy(c.points[i][1]))}`;
  const last = c.points[c.points.length - 1];
  if (c.end !== null && c.end > last[0]) d += `H${f(sx(c.end))}`;
  return d;
}

function SurvivalPlot({ spec, area, locale, colors, t }: { spec: SurvivalSpec; area: PlotArea; locale?: string; colors: string[]; t: ChartCommonProps['t'] }) {
  const tip = useTip();
  const all = spec.curves.flatMap((c) => [...c.points, ...c.censored]);
  const xMax = Math.max(0, ...all.map((p) => p[0]), ...spec.curves.map((c) => c.end ?? 0));
  const ys = all.map((p) => p[1]);
  let y: Ticks;
  const yc = clamp(Math.floor(area.height / 48), 3, 9);
  if (spec.kind === 'survival' || spec.kind === 'oms') y = { ...ticksWithin(0, 1, area.height < 220 ? 5 : 10), domain: [0, 1] };
  else if (spec.kind === 'lml' && ys.length) y = niceTicks(Math.min(...ys), Math.max(...ys, Math.min(...ys) + 0.1), yc);
  else y = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys, spec.kind === 'hazard' ? 0.1 : 0), yc);
  const x = niceTicks(0, xMax || 1, clamp(Math.floor(area.width / 90), 3, 10));
  x.domain = [0, x.domain[1]];
  const fx = tickFormatter(x.step, x.ticks, locale);
  const fy = tickFormatter(y.step, y.ticks, locale);
  const m = plotMargins({ yTickLabels: y.ticks.map(fy), yTitle: spec.ylabel, xTitle: spec.xlabel, right: 16 });
  const plotW = Math.max(40, area.width - m.left - m.right);
  const plotH = Math.max(40, area.height - m.top - m.bottom);
  const sx = linearScale(x.domain, [m.left, m.left + plotW]);
  const sy = linearScale(y.domain, [m.top + plotH, m.top]);
  const clipId = `${area.uid}-clip`;

  const hits = useMemo(() => {
    const out: HitPt[] = [];
    spec.curves.forEach((c, ci) => {
      c.points.forEach((p, i) => i > 0 && out.push({ px: sx(p[0]), py: sy(p[1]), curve: ci, p, censored: false }));
      c.censored.forEach((p) => out.push({ px: sx(p[0]), py: sy(p[1]), curve: ci, p, censored: true }));
    });
    out.sort((a, b) => a.px - b.px || a.py - b.py);
    return out;
    // sx/sy are fully determined by the domains and the plot geometry
  }, [spec, x.domain[1], y.domain[0], y.domain[1], plotW, plotH, m.left, m.top]);
  const [hi, setHi] = useState<number | null>(null);

  const named = spec.curves.length > 1;
  const tipFor = (h: HitPt): TipContent => ({
    title: named ? spec.curves[h.curve].name : undefined,
    rows: [
      { label: spec.ylabel, value: formatValue(h.p[1], locale, 3), color: colors[h.curve], key: 'line' },
      { label: spec.xlabel || tr(t, 'value'), value: formatValue(h.p[0], locale), key: 'none' },
      ...(h.censored ? [{ label: '', value: spec.censoredLabel, key: 'none' as const }] : []),
    ],
  });

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - r.left + m.left;
    const ly = e.clientY - r.top + m.top;
    let best = -1;
    let bd = 28 * 28;
    hits.forEach((h, i) => {
      const d = (h.px - lx) ** 2 + (h.py - ly) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      setHi(best);
      tip.show(e, tipFor(hits[best]));
    } else {
      setHi(null);
      tip.hide();
    }
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (!hits.length) return;
    let i = hi ?? -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(hits.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = hits.length - 1;
    else if (e.key === 'Escape') {
      setHi(null);
      tip.hide();
      return;
    } else return;
    e.preventDefault();
    const h = hits[i];
    const r = e.currentTarget.getBoundingClientRect();
    setHi(i);
    tip.show({ clientX: r.left + h.px - m.left, clientY: r.top + h.py - m.top }, tipFor(h));
  };
  const h = hi !== null ? hits[hi] : null;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left - 6} y={m.top - 6} width={plotW + 12} height={plotH + 12} />
        </clipPath>
      </defs>
      <YAxis axis={{ scale: sy, ticks: y.ticks, format: fy }} left={m.left} width={plotW} />
      <XAxis axis={{ scale: sx, ticks: x.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
      <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
      <g clipPath={`url(#${clipId})`}>
        {spec.curves.map((c, ci) => (
          <g key={ci}>
            <path className="pspp-chart__line" d={stepPath(c, sx, sy)} style={{ stroke: colors[ci], strokeLinecap: 'butt', strokeLinejoin: 'miter' }} />
            {c.censored.map((p, i) => {
              const px = sx(p[0]);
              const py = sy(p[1]);
              return <path key={i} d={`M${(px - 4).toFixed(1)},${py.toFixed(1)}H${(px + 4).toFixed(1)}M${px.toFixed(1)},${(py - 5).toFixed(1)}V${(py + 5).toFixed(1)}`} style={{ stroke: colors[ci], strokeWidth: 1.5, fill: 'none' }} />;
            })}
          </g>
        ))}
      </g>
      {h && (
        <g data-export="omit" pointerEvents="none">
          <circle cx={h.px} cy={h.py} r={8} className="pspp-chart__hover-ring" />
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
        aria-label={`${spec.xlabel} / ${spec.ylabel}`}
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
      {!all.length && (
        <text className="pspp-chart__empty" x={m.left + plotW / 2} y={m.top + plotH / 2} textAnchor="middle" dominantBaseline="central">
          {tr(t, 'noData')}
        </text>
      )}
      <AxisTitles xTitle={spec.xlabel} yTitle={spec.ylabel} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
    </g>
  );
}

export function SurvivalChart({ spec, ...c }: { spec: SurvivalSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const colors = spec.curves.map((_, i) => seriesColor(i));
  const title = spec.title || tr(t, 'untitled');
  const anyCensored = spec.curves.some((cv) => cv.censored.length > 0);
  const legend: LegendItem[] = spec.curves.map((cv, i) => ({ label: cv.name, kind: 'line', color: colors[i] }));
  if (anyCensored) legend.push({ label: spec.censoredLabel, kind: 'marker', shape: 'plus', color: 'var(--c-ink-2)' });
  const named = spec.curves.length > 1 || !!spec.legendTitle;
  const rows: string[][] = [];
  for (const cv of spec.curves) {
    const events = cv.points.slice(1).map((p) => ({ p, cens: false }));
    const cens = cv.censored.map((p) => ({ p, cens: true }));
    for (const r of [...events, ...cens].sort((a, b) => a.p[0] - b.p[0] || Number(a.cens) - Number(b.cens)))
      rows.push([...(named ? [cv.name] : []), formatValue(r.p[0], locale), formatValue(r.p[1], locale, 3), ...(anyCensored ? [r.cens ? spec.censoredLabel : ''] : [])]);
  }
  return (
    <ChartShell
      {...c}
      title={title}
      legend={named || anyCensored ? legend : undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaCurves', { count: spec.curves.length })}: ${spec.curves.map((s) => s.name).join(', ')}.`}
      table={{
        columns: [...(named ? [spec.legendTitle || tr(t, 'group')] : []), spec.xlabel, spec.ylabel, ...(anyCensored ? [spec.censoredLabel] : [])],
        rows,
        numeric: [...(named ? [false] : []), true, true, ...(anyCensored ? [false] : [])],
      }}
    >
      {(area) => <SurvivalPlot spec={spec} area={area} locale={locale} colors={colors} t={t} />}
    </ChartShell>
  );
}
