import { AxisTitles, Baseline, ChartShell, FONT, XAxis, YAxis, barPath, plotMargins, seriesColor, markTip, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatPercent, formatValue, linearScale, measureText, niceTicks, percentTickFormatter, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { BarSpec } from './types';
import { axisTitle, useStyle } from './styleLayer';
import { applyDomain, fontScaleOf } from './styleSpec';
import { stackSegments } from './studioMath';

const GAP = 2;
const MAX_BAR = 24;
const MAX_ROTATED = 110;

/** How category labels fit a band: flat, tilted 45°, or vertical (thinned if still too dense). */
export function catLabels(cats: string[], band: number) {
  const maxLabel = Math.max(0, ...cats.map((s) => measureText(s, FONT.tick)));
  let mode: 'flat' | 'tilt' | 'vertical' = 'flat';
  let every = 1;
  if (maxLabel > band - 6) mode = band >= 18 ? 'tilt' : 'vertical';
  if (mode === 'vertical' && band < 13) every = Math.ceil(13 / band);
  const labels = cats.map((s) => truncateText(s, mode === 'flat' ? band - 4 : MAX_ROTATED, FONT.tick));
  const longest = Math.max(0, ...labels.map((s) => measureText(s, FONT.tick)));
  const labelBand = mode === 'flat' ? 18 : mode === 'tilt' ? longest * Math.SQRT1_2 + 18 : longest + 12;
  return { mode, every, labels, labelBand };
}

/** Rounded end on the value side of a horizontal bar. */
function hBarPath(y: number, h: number, xBase: number, xVal: number, radius = 4): string {
  const w = Math.abs(xVal - xBase);
  if (w <= 0 || h <= 0) return '';
  const r = Math.min(radius, h / 2, w);
  if (xVal >= xBase) {
    return `M${xBase},${y}H${xVal - r}Q${xVal},${y} ${xVal},${y + r}V${y + h - r}Q${xVal},${y + h} ${xVal - r},${y + h}H${xBase}Z`;
  }
  return `M${xBase},${y}H${xVal + r}Q${xVal},${y} ${xVal},${y + r}V${y + h - r}Q${xVal},${y + h} ${xVal + r},${y + h}H${xBase}Z`;
}

interface Seg {
  cat: number;
  group: number;
  v0: number;
  v1: number;
  count: number;
  err?: { lo: number; hi: number } | null;
}

export function BarChart({ spec, ...c }: { spec: BarSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'barChart');
  const horizontal = spec.horizontal === true;
  const yName = spec.ylabel || (spec.percent ? tr(t, 'percent') : tr(t, 'count'));
  const catName = spec.xlabel || '';

  const cats: string[] = [];
  const groups: string[] = [];
  const cell = new Map<string, number>();
  const errOf = new Map<string, { lo: number; hi: number } | null>();
  const grouped = spec.bars.some((b) => b.group !== null);
  spec.bars.forEach((b, bi) => {
    if (!cats.includes(b.x)) cats.push(b.x);
    const g = b.group ?? '';
    if (grouped && !groups.includes(g)) groups.push(g);
    const key = b.x + '\u0000' + g;
    cell.set(key, (cell.get(key) ?? 0) + b.count);
    if (spec.err) errOf.set(key, spec.err[bi] ?? null);
  });
  const nG = grouped ? groups.length : 1;
  const gList = grouped ? groups : [''];
  const stackMode = grouped && nG > 1 ? (spec.stack ?? 'none') : 'none';
  const stacked = stackMode !== 'none';
  const pct100 = stackMode === 'stack100';
  const value = (count: number) => (spec.percent && spec.total ? (count * 100) / spec.total : count);
  const fmtVal = (count: number) => (spec.percent && spec.total ? formatPercent(count / spec.total, locale) : formatValue(count, locale));
  // Groups beyond the eighth slot fold into the neutral "other" color.
  const gColor = (gi: number) => (grouped ? seriesColor(gi) : seriesColor(0));
  const legend: LegendItem[] | undefined = grouped ? groups.map((g, gi) => ({ label: g || tr(t, 'missing'), kind: 'rect', color: gColor(gi) })) : undefined;
  const hasErr = !!spec.err && spec.err.some((e) => e);

  const tableCols = [tr(t, 'category'), ...(grouped ? [tr(t, 'group')] : []), yName, ...(hasErr ? [tr(t, 'lowerBound'), tr(t, 'upperBound')] : [])];
  const rows = spec.bars.map((b, bi) => [
    b.x,
    ...(grouped ? [b.group ?? ''] : []),
    fmtVal(b.count),
    ...(hasErr ? [spec.err?.[bi] ? formatValue(spec.err[bi]!.lo, locale) : '', spec.err?.[bi] ? formatValue(spec.err[bi]!.hi, locale) : ''] : []),
  ]);

  // Segments in value space (shared by both orientations).
  const segs: Seg[] = [];
  if (stacked) {
    const vals = gList.map((g) => cats.map((cName) => {
      const v = cell.get(cName + '\u0000' + g);
      return v === undefined ? null : value(v);
    }));
    for (const s of stackSegments(vals, stackMode as 'stack' | 'stack100')) {
      const raw = cell.get(cats[s.cat] + '\u0000' + gList[s.series]) ?? 0;
      segs.push({ cat: s.cat, group: s.series, v0: s.v0, v1: s.v1, count: raw });
    }
  } else {
    cats.forEach((cName, ci) =>
      gList.forEach((g, gi) => {
        const count = cell.get(cName + '\u0000' + g);
        if (count === undefined) return;
        segs.push({ cat: ci, group: gi, v0: 0, v1: value(count), count, err: errOf.get(cName + '\u0000' + g) ?? null });
      }),
    );
  }

  const catW = (w: number) => Math.min(w * 0.35, Math.max(0, ...cats.map((s) => measureText(s, FONT.tick * fs))) + 4);
  const xT = axisTitle(style, 'x', catName);
  const plotHeight = (w: number) => {
    if (horizontal) return clamp(Math.round(cats.length * (nG * 14 + 12) + 70), 220, 640);
    return clamp(Math.round(w * 0.56), 240, 420) + catLabels(cats, Math.max(1, (w - 64) / Math.max(1, cats.length))).labelBand - 18 + (xT ? 20 : 0);
  };

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${yName}. ${tr(t, 'ariaBars', { count: spec.bars.length })}: ${spec.bars
        .slice(0, 30)
        .map((b) => `${b.x}${grouped ? ' / ' + (b.group ?? '') : ''} ${fmtVal(b.count)}`)
        .join(', ')}.`}
      table={{ columns: tableCols, rows, numeric: [false, ...(grouped ? [false] : []), true, ...(hasErr ? [true, true] : [])] }}
      plotHeight={plotHeight}
    >
      {(area) => {
        if (!cats.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        let maxV = 0;
        let minV = 0;
        for (const s of segs) {
          maxV = Math.max(maxV, s.v0, s.v1, s.err ? value(s.err.hi) : -Infinity);
          minV = Math.min(minV, s.v0, s.v1, s.err ? value(s.err.lo) : Infinity);
        }
        if (pct100) {
          maxV = Math.max(maxV, 100);
          minV = Math.min(minV, 0);
        }
        const count = horizontal ? clamp(Math.floor(area.width / 90), 3, 8) : clamp(Math.floor(area.height / 48), 3, 8);
        const baseTicks = niceTicks(minV, maxV || 1, count);
        const vt = applyDomain(baseTicks, horizontal ? style?.xMin : style?.yMin, horizontal ? style?.xMax : style?.yMax, count);
        const unitPct = spec.percent || pct100;
        const fv = unitPct ? percentTickFormatter(vt.step, locale) : tickFormatter(vt.step, vt.ticks, locale);
        const segText = (s: Seg) => (pct100 ? formatPercent(s.v1 - s.v0 === 0 ? 0 : Math.abs(s.v1 - s.v0) / 100, locale) : fmtVal(s.count));
        const valueName = pct100 ? tr(t, 'percent') : yName;
        const autoLabels = !grouped;
        const wantLabels = style?.valueLabels === true || (style?.valueLabels !== false && autoLabels);
        const nBars = cats.length;

        const tipOf = (s: Seg) => ({
          title: cats[s.cat],
          rows: [
            { label: grouped ? gList[s.group] || tr(t, 'missing') : valueName, value: fmtVal(s.count), color: gColor(s.group), key: 'rect' as const },
            ...(pct100 ? [{ label: tr(t, 'share'), value: segText(s), key: 'none' as const }] : []),
            ...(s.err ? [{ label: `${tr(t, 'lowerBound')} – ${tr(t, 'upperBound')}`, value: `${formatValue(s.err.lo, locale)} – ${formatValue(s.err.hi, locale)}`, key: 'none' as const }] : []),
          ],
        });
        const ariaOf = (s: Seg) => `${cats[s.cat]}${grouped ? ', ' + gList[s.group] : ''}: ${fmtVal(s.count)}`;

        if (horizontal) {
          const labels = cats.map((cName) => truncateText(cName, catW(area.width), FONT.tick * fs));
          const valLabW = wantLabels && !stacked ? Math.max(...segs.map((s) => measureText(segText(s), FONT.label * fs))) + 8 : 0;
          const m = plotMargins({ yTickLabels: labels, yTitle: xT, xTitle: valueName, right: Math.max(16, valLabW), style });
          const plotW = area.width - m.left - m.right;
          const plotH = area.height - m.top - m.bottom;
          const sx = linearScale(vt.domain, [m.left, m.left + plotW]);
          const band = plotH / nBars;
          const cluster = Math.min(nG * MAX_BAR + (nG - 1) * GAP, band * (nG > 1 && !stacked ? 0.84 : 0.7));
          const slot = stacked ? cluster : Math.max(1, (cluster - (nG - 1) * GAP) / nG);
          const base = sx(Math.max(vt.domain[0], Math.min(0, vt.domain[1])));
          area.reg.y = (i: number) => m.top + band * (i + 0.5);
          return (
            <g>
              <defs>
                <clipPath id={area.uid + '-bc'}>
                  <rect x={m.left} y={m.top - 2} width={plotW} height={plotH + 4} />
                </clipPath>
              </defs>
              <XAxis axis={{ scale: sx, ticks: vt.ticks, format: fv }} top={m.top} height={plotH} left={m.left} width={plotW} grid />
              {cats.map((_c, ci) => (
                <text key={ci} className="pspp-chart__tick pspp-chart__tick--cat" x={m.left - 8} y={m.top + band * (ci + 0.5)} textAnchor="end" dominantBaseline="central">
                  {labels[ci]}
                </text>
              ))}
              <g clipPath={`url(#${area.uid}-bc)`}>
                {segs.map((s, k) => {
                  const cy = m.top + band * (s.cat + 0.5);
                  const y = stacked ? cy - slot / 2 : cy - cluster / 2 + s.group * (slot + GAP);
                  const xa = sx(s.v0);
                  const xb = sx(s.v1);
                  const x = Math.min(xa, xb);
                  const w = Math.abs(xb - xa);
                  const txt = segText(s);
                  const tw = measureText(txt, FONT.label * fs);
                  return (
                    <g key={k} className="pspp-chart__mark" {...markTip(area.tip, tipOf(s), ariaOf(s))}>
                      <rect x={m.left} y={y - GAP / 2} width={plotW} height={slot + GAP} className="pspp-chart__hitband" data-export="omit" />
                      {stacked ? (
                        <rect x={x} y={y} width={w} height={slot} style={{ fill: gColor(s.group), stroke: 'var(--c-surface)', strokeWidth: 1 }} />
                      ) : (
                        <path d={hBarPath(y, slot, base, xb)} style={{ fill: gColor(s.group) }} />
                      )}
                      {s.err && (
                        <path
                          className="pspp-chart__whisker"
                          d={`M${sx(value(s.err.lo))},${y + slot / 2}H${sx(value(s.err.hi))}M${sx(value(s.err.lo))},${y + slot / 2 - 3}V${y + slot / 2 + 3}M${sx(value(s.err.hi))},${y + slot / 2 - 3}V${y + slot / 2 + 3}`}
                          fill="none"
                        />
                      )}
                      {wantLabels && (stacked ? w >= tw + 8 && slot >= FONT.label * fs + 2 : slot >= FONT.label * fs - 2) && (
                        <text
                          className={stacked ? 'pspp-chart__value pspp-chart__value--in' : 'pspp-chart__value'}
                          x={stacked ? x + w / 2 : (s.v1 >= 0 ? Math.max(xa, xb) + 5 : Math.min(xa, xb) - 5)}
                          y={y + slot / 2}
                          textAnchor={stacked ? 'middle' : s.v1 >= 0 ? 'start' : 'end'}
                          dominantBaseline="central"
                        >
                          {txt}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              <line className="pspp-chart__baseline" x1={Math.round(base) + 0.5} x2={Math.round(base) + 0.5} y1={m.top} y2={m.top + plotH} aria-hidden="true" />
              <AxisTitles xTitle={valueName} yTitle={xT} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
            </g>
          );
        }

        // First pass for the left margin, then size the category labels.
        const m = plotMargins({ yTickLabels: vt.ticks.map(fv), yTitle: valueName, style });
        const plotW = area.width - m.left - m.right;
        const band = plotW / nBars;
        const { mode, every, labels: rotLabels, labelBand } = catLabels(cats, band);

        const fitsAll = !grouped
          ? cats.every((cName) => measureText(fmtVal(cell.get(cName + '\u0000') ?? 0), FONT.label * fs) <= band - 4)
          : true;
        const labelsOn = wantLabels && nBars <= 24 && (style?.valueLabels === true || fitsAll);
        const above = labelsOn && !stacked;
        const top = m.top + (above ? 14 * fs : 0);
        const plotH = area.height - top - labelBand - 4 - (xT ? 20 : 0);
        const sy = linearScale(vt.domain, [top + plotH, top]);
        const base = sy(Math.max(vt.domain[0], Math.min(0, vt.domain[1])));
        const cluster = Math.min(nG * MAX_BAR + (nG - 1) * GAP, band * (nG > 1 && !stacked ? 0.84 : 0.7));
        const slot = stacked ? cluster : Math.max(1, (cluster - (nG - 1) * GAP) / nG);
        area.reg.x = (i: number) => m.left + band * (i + 0.5);
        area.reg.top = top;
        area.reg.height = plotH;

        return (
          <g>
            <defs>
              <clipPath id={area.uid + '-bc'}>
                <rect x={m.left} y={top - 2} width={plotW} height={plotH + 4} />
              </clipPath>
            </defs>
            <YAxis axis={{ scale: sy, ticks: vt.ticks, format: fv }} left={m.left} width={plotW} />
            {cats.map((_c, ci) => {
              const cx = m.left + band * (ci + 0.5);
              return ci % every === 0 ? (
                mode === 'flat' ? (
                  <text key={'t' + ci} className="pspp-chart__tick pspp-chart__tick--cat" x={cx} y={top + plotH + 15} textAnchor="middle">
                    {rotLabels[ci]}
                  </text>
                ) : (
                  <text
                    key={'t' + ci}
                    className="pspp-chart__tick pspp-chart__tick--cat"
                    transform={`translate(${cx} ${top + plotH + 8}) rotate(${mode === 'tilt' ? -45 : -90})`}
                    textAnchor="end"
                    dominantBaseline="central"
                  >
                    {rotLabels[ci]}
                  </text>
                )
              ) : null;
            })}
            <g clipPath={`url(#${area.uid}-bc)`}>
              {segs.map((s, k) => {
                const cx = m.left + band * (s.cat + 0.5);
                const x = stacked ? cx - slot / 2 : cx - cluster / 2 + s.group * (slot + GAP);
                const ya = sy(s.v0);
                const yb = sy(s.v1);
                const txt = segText(s);
                const tw = measureText(txt, FONT.label * fs);
                const inSeg = stacked && slot >= tw + 4 && Math.abs(yb - ya) >= FONT.label * fs + 2;
                const outSeg = !stacked && tw <= slot + band * 0.2;
                return (
                  <g key={k} className="pspp-chart__mark" {...markTip(area.tip, tipOf(s), ariaOf(s))}>
                    <rect x={x - GAP / 2} y={top} width={slot + GAP} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                    {stacked ? (
                      <rect x={x} y={Math.min(ya, yb)} width={slot} height={Math.abs(yb - ya)} style={{ fill: gColor(s.group), stroke: 'var(--c-surface)', strokeWidth: 1 }} />
                    ) : (
                      <path d={barPath(x, slot, base, yb)} style={{ fill: gColor(s.group) }} />
                    )}
                    {s.err && (
                      <path
                        className="pspp-chart__whisker"
                        d={`M${x + slot / 2},${sy(value(s.err.lo))}V${sy(value(s.err.hi))}M${x + slot / 2 - 3},${sy(value(s.err.lo))}H${x + slot / 2 + 3}M${x + slot / 2 - 3},${sy(value(s.err.hi))}H${x + slot / 2 + 3}`}
                        fill="none"
                      />
                    )}
                    {labelsOn && (stacked ? inSeg : outSeg) && (
                      <text
                        className={stacked ? 'pspp-chart__value pspp-chart__value--in' : 'pspp-chart__value'}
                        x={x + slot / 2}
                        y={stacked ? (ya + yb) / 2 : s.err ? Math.min(yb, sy(value(s.err.hi))) - 5 : (s.v1 >= 0 ? Math.min(yb, base) - 5 : Math.max(yb, base) + 12)}
                        textAnchor="middle"
                        dominantBaseline={stacked ? 'central' : undefined}
                      >
                        {txt}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            <Baseline x1={m.left} x2={m.left + plotW} y={base} />
            <AxisTitles xTitle={xT} yTitle={valueName} left={m.left} top={top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
