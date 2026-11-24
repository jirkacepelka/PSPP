/* Bubble chart: a scatter whose point area is proportional to a third variable, coloured by group, with a size legend of
   three reference circles.  Studio only (BubbleSpec in studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AxisTitles, Baseline, ChartShell, FONT, XAxis, YAxis, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, measureText, niceTicks, tickFormatter, truncateText } from './scale';
import { bubbleRadius, sizeReferences } from './phase4Math';
import { EmptyPlot } from './p4shared';
import { tr } from './strings';
import type { BubbleSpec } from './studioTypes';
import { avoidText, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { extent, xCount, yCount } from './xy';

/** Labels are printed only up to this many bubbles. */
const LABEL_MAX = 15;
const SIDE_MIN_WIDTH = 520;

/** Largest radius for a chart of this inner width. */
const maxRadius = (w: number, n = 0) => clamp(w * 0.045, 7, 26) * (n > 40 ? Math.max(0.55, Math.sqrt(40 / n)) : 1);

export function BubbleChart({ spec, ...c }: { spec: BubbleSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'bubbleChart');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const sName = spec.sizeLabel || tr(t, 'size');
  const [hi, setHi] = useState<number | null>(null);

  const { groups, slotOf, maxSize, skipped } = useMemo(() => {
    const names: string[] = [];
    const slots = new Map<string, number>();
    let max = 0;
    let skip = 0;
    for (const p of spec.points) {
      if (p.group !== null && !slots.has(p.group)) {
        slots.set(p.group, names.length);
        names.push(p.group);
      }
      if (p.size > 0) max = Math.max(max, p.size);
      else skip++;
    }
    return { groups: names, slotOf: slots, maxSize: max, skipped: skip };
  }, [spec.points]);
  const grouped = groups.length > 0;
  const colorOf = (g: string | null) => {
    if (!grouped) return seriesColor(0);
    const i = g === null ? groups.length : (slotOf.get(g) ?? 0);
    return i < 8 ? seriesColor(i) : 'var(--c-other)';
  };
  const hasMissingGroup = grouped && spec.points.some((p) => p.group === null);
  const legend: LegendItem[] | undefined = grouped
    ? [...groups.map((g) => ({ label: g || tr(t, 'missing'), kind: 'marker' as const, color: colorOf(g), shape: 'circle' as const })), ...(hasMissingGroup ? [{ label: tr(t, 'missing'), kind: 'marker' as const, color: colorOf(null), shape: 'circle' as const }] : [])]
    : undefined;
  const refs = sizeReferences(maxSize);
  const fmt = (v: number) => formatValue(v, locale);

  const table = {
    columns: [...(grouped ? [tr(t, 'group')] : []), xName, yName, sName, tr(t, 'label')],
    rows: spec.points.map((p) => [...(grouped ? [p.group ?? ''] : []), fmt(p.x), fmt(p.y), fmt(p.size), p.label ?? '']),
    numeric: [...(grouped ? [false] : []), true, true, true, false],
    note: skipped ? tr(t, 'bubbleSkipped', { count: skipped }) : undefined,
  };
  const side = (w: number) => w >= SIDE_MIN_WIDTH;
  const stripH = (w: number) => (refs.length && !side(w) ? 2 * maxRadius(w, spec.points.length) + 14 : 0);

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      legendTitle={grouped ? spec.byvar || undefined : undefined}
      ariaLabel={`${title}. ${xName} / ${yName} / ${sName}. ${tr(t, 'ariaPoints', { count: spec.points.length })}${grouped ? ', ' + tr(t, 'ariaGroups', { count: groups.length }) : ''}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(w * 0.6), 260, 460) + stripH(w)}
    >
      {(area) => {
        const drawn = spec.points.filter((p) => p.size > 0);
        if (!drawn.length) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const rMax = maxRadius(area.width, drawn.length);
        const wide = side(area.width);
        const strip = stripH(area.width);
        const H = area.height - strip;
        const refText = refs.map((v) => fmt(v));
        const sideW = wide && refs.length ? Math.max(measureText(truncateText(sName, 150, 12 * fs, 600), 12 * fs, 600), 2 * rMax + 8 + Math.max(...refText.map((s) => measureText(s, FONT.tick * fs)))) + 16 : 0;
        const [ex0, ex1] = extent(drawn.map((p) => p.x));
        const [ey0, ey1] = extent(drawn.map((p) => p.y));
        const xc = xCount(area.width);
        const yc = yCount(H);
        const padPx = rMax + 4;
        // two passes: margins depend on the tick labels, the padding that keeps the largest bubble inside on the margins
        const domainFor = (lo: number, hi: number, px: number) => {
          const span = hi - lo || Math.abs(hi) || 1;
          const k = padPx / Math.max(20, px - 2 * padPx);
          return [lo - span * k, hi + span * k] as [number, number];
        };
        let m = plotMargins({ yTickLabels: ['0.00'], yTitle: yName, xTitle: spec.xlabel ? xName : undefined, right: 16 + sideW, style });
        let yt = niceTicks(...domainFor(ey0, ey1, H - m.top - m.bottom), yc);
        let fy = tickFormatter(yt.step, yt.ticks, locale);
        m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName, xTitle: xName, right: 16 + sideW, style });
        const plotW = Math.max(40, area.width - m.left - m.right);
        const plotH = Math.max(40, H - m.top - m.bottom);
        const xt = applyDomain(niceTicks(...domainFor(ex0, ex1, plotW), xc), style?.xMin, style?.xMax, xc);
        yt = applyDomain(niceTicks(...domainFor(ey0, ey1, plotH), yc), style?.yMin, style?.yMax, yc);
        fy = tickFormatter(yt.step, yt.ticks, locale);
        const fx = tickFormatter(xt.step, xt.ticks, locale);
        const sx = linearScale(xt.domain, [m.left, m.left + plotW]);
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const tip = area.tip;
        const clipId = area.uid + '-bub';

        const items = drawn
          .map((p, i) => ({ p, i, px: sx(p.x), py: sy(p.y), r: Math.max(2, bubbleRadius(p.size, maxSize, rMax)) }))
          // big ones first so small bubbles stay visible on top
          .sort((a, b) => b.r - a.r);
        const nav = [...items].sort((a, b) => a.px - b.px || a.py - b.py);
        const tipFor = (it: (typeof items)[number]) => ({
          title: it.p.label || (grouped ? it.p.group || tr(t, 'missing') : undefined),
          rows: [
            ...(it.p.label && grouped ? [{ label: tr(t, 'group'), value: it.p.group || tr(t, 'missing'), color: colorOf(it.p.group), key: 'marker' as const, shape: 'circle' as const }] : []),
            { label: xName, value: fmt(it.p.x), key: 'none' as const },
            { label: yName, value: fmt(it.p.y), key: 'none' as const },
            { label: sName, value: fmt(it.p.size), key: 'none' as const },
          ],
        });
        const pick = (lx: number, ly: number) => {
          let best = -1;
          let bd = Infinity;
          items.forEach((it, k) => {
            const d = Math.hypot(it.px - lx, it.py - ly);
            // the smallest bubble under the pointer, else the nearest centre within reach
            const score = d <= it.r ? it.r - 1000 : d <= it.r + 14 ? d : Infinity;
            if (score < bd) {
              bd = score;
              best = k;
            }
          });
          return best;
        };
        const onMove = (e: PointerEvent<SVGRectElement>) => {
          const rc = e.currentTarget.getBoundingClientRect();
          const k = pick(e.clientX - rc.left + m.left, e.clientY - rc.top + m.top);
          if (k < 0) {
            setHi(null);
            tip.hide();
          } else {
            setHi(k);
            tip.show(e, tipFor(items[k]));
          }
        };
        const onKey = (e: KeyboardEvent<SVGRectElement>) => {
          if (!nav.length) return;
          let cur = hi === null ? -1 : nav.indexOf(items[hi]);
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') cur = Math.min(nav.length - 1, cur + 1);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') cur = Math.max(0, cur - 1);
          else if (e.key === 'Home') cur = 0;
          else if (e.key === 'End') cur = nav.length - 1;
          else if (e.key === 'Escape') {
            setHi(null);
            tip.hide();
            return;
          } else return;
          e.preventDefault();
          const it = nav[cur];
          setHi(items.indexOf(it));
          const rc = e.currentTarget.getBoundingClientRect();
          tip.show({ clientX: rc.left + it.px - m.left, clientY: rc.top + it.py - m.top }, tipFor(it));
        };
        const leave = () => {
          setHi(null);
          tip.hide();
        };

        // point labels, only when there are few bubbles; largest first, a label that would overlap another is dropped
        const labels: { x: number; y: number; text: string; anchor: 'start' | 'end' }[] = [];
        if (drawn.length <= LABEL_MAX) {
          const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
          const size = FONT.label * fs;
          for (const it of items) {
            if (!it.p.label) continue;
            const text = truncateText(it.p.label, plotW * 0.3, size);
            const w = measureText(text, size);
            const right = it.px + it.r + 4 + w <= m.left + plotW;
            const x0 = right ? it.px + it.r + 4 : it.px - it.r - 4 - w;
            const box = { x0, y0: it.py - size / 2 - 1, x1: x0 + w, y1: it.py + size / 2 + 1 };
            if (taken.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) continue;
            taken.push(box);
            avoidText(area.reg, x0, it.py + size * 0.35, w, size, 'start');
            labels.push({ x: right ? x0 : x0 + w, y: it.py, text, anchor: right ? 'start' : 'end' });
          }
        }

        const h = hi !== null ? items[hi] : null;
        // size legend: three reference circles, stacked in the right margin or in a strip below the plot
        const legendEls: JSX.Element[] = [];
        if (refs.length) {
          const rs = refs.map((v) => bubbleRadius(v, maxSize, rMax));
          const ink = { fill: 'none', stroke: 'var(--c-ink-2)', strokeWidth: 1.25 } as const;
          if (wide) {
            const x0 = m.left + plotW + 16;
            let y = m.top + 14 + 4;
            legendEls.push(
              <text key="t" className="pspp-chart__legend-title" x={x0} y={m.top + 2} dominantBaseline="central">
                {truncateText(sName, sideW - 4, 12 * fs, 600)}
              </text>,
            );
            refs.forEach((_v, k) => {
              const r = Math.max(1.5, rs[k]);
              legendEls.push(
                <g key={k}>
                  <circle cx={x0 + rMax} cy={y + r} r={r} style={ink} />
                  <text className="pspp-chart__legend-text" x={x0 + 2 * rMax + 8} y={y + r} dominantBaseline="central" style={{ fontSize: FONT.tick * fs }}>
                    {refText[k]}
                  </text>
                </g>,
              );
              y += 2 * r + 8;
            });
          } else {
            const cy = area.height - strip + 4 + rMax;
            let x = m.left;
            const lab = truncateText(sName, area.width * 0.3, 12 * fs, 600);
            legendEls.push(
              <text key="t" className="pspp-chart__legend-title" x={x} y={cy} dominantBaseline="central">
                {lab}
              </text>,
            );
            x += measureText(lab, 12 * fs, 600) + 12;
            refs.forEach((_v, k) => {
              const r = Math.max(1.5, rs[k]);
              legendEls.push(
                <g key={k}>
                  <circle cx={x + r} cy={cy + rMax - r} r={r} style={ink} />
                  <text className="pspp-chart__legend-text" x={x + 2 * r + 5} y={cy + rMax - r} dominantBaseline="central" style={{ fontSize: FONT.tick * fs }}>
                    {refText[k]}
                  </text>
                </g>,
              );
              x += 2 * r + 5 + measureText(refText[k], FONT.tick * fs) + 14;
            });
          }
        }

        return (
          <g>
            <defs>
              <clipPath id={clipId}>
                <rect x={m.left} y={m.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            <XAxis axis={{ scale: sx, ticks: xt.ticks, format: fx }} top={m.top} height={plotH} left={m.left} width={plotW} />
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
            <g clipPath={`url(#${clipId})`} aria-hidden="true">
              {items.map((it, k) => (
                <circle key={k} cx={it.px} cy={it.py} r={it.r} style={{ fill: colorOf(it.p.group), fillOpacity: 0.6, stroke: colorOf(it.p.group), strokeWidth: 1.5 }} />
              ))}
            </g>
            <g aria-hidden="true" pointerEvents="none">
              {labels.map((l, k) => (
                <text key={k} className="pspp-chart__value" x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central">
                  {l.text}
                </text>
              ))}
            </g>
            {h && <circle data-export="omit" pointerEvents="none" cx={h.px} cy={h.py} r={h.r + 3} className="pspp-chart__hover-ring" />}
            <rect
              data-export="omit"
              className="pspp-chart__hit"
              x={m.left}
              y={m.top}
              width={plotW}
              height={plotH}
              tabIndex={0}
              role="graphics-symbol"
              aria-label={`${xName} / ${yName} / ${sName}`}
              onPointerMove={onMove}
              onPointerLeave={leave}
              onKeyDown={onKey}
              onBlur={leave}
            />
            <g aria-hidden="true">{legendEls}</g>
            <AxisTitles xTitle={xName} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={H} />
          </g>
        );
      }}
    </ChartShell>
  );
}
