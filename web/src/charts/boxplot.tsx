import { Baseline, ChartShell, FONT, Marker, YAxis, plotMargins, seriesColor, markTip, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, niceTicks, padExtent, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { BoxplotSpec } from './types';
import { useStyle } from './styleLayer';
import { applyDomain } from './styleSpec';
import { clusterBoxes } from './studioMath';

export function BoxplotChart({ spec, ...c }: { spec: BoxplotSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const title = spec.title || tr(t, 'boxplot');
  const boxes = spec.boxes;
  const hasOut = boxes.some((b) => b.outliers.some((o) => !o.extreme));
  const hasExt = boxes.some((b) => b.outliers.some((o) => o.extreme));
  const layout = clusterBoxes(boxes);
  const clustered = layout.clustered;
  // clustered: boxes are coloured by group, outlier marks follow their box
  const outColor = clustered ? 'var(--c-ink-2)' : seriesColor(0);
  const extColor = clustered ? 'var(--c-ink-2)' : seriesColor(1);
  const legend: LegendItem[] = clustered ? layout.groups.map((g, gi) => ({ label: g || tr(t, 'missing'), kind: 'rect' as const, color: seriesColor(gi) })) : [];
  if (hasOut) legend.push({ label: tr(t, 'outlier'), kind: 'marker', shape: 'ring', color: outColor });
  if (hasExt) legend.push({ label: tr(t, 'extreme'), kind: 'marker', shape: 'asterisk', color: extColor });
  const anyLabel = boxes.some((b) => b.label);
  const nSlots = clustered ? layout.labels.length : boxes.length;
  const fv = (v: number | null) => formatValue(v, locale, 2);

  const all: number[] = [];
  for (const b of boxes) {
    all.push(...b.hinges);
    for (const w of b.whiskers) if (w !== null) all.push(w);
    for (const o of b.outliers) all.push(o.value);
  }
  const lo = spec.yMin ?? Math.min(...all);
  const hi = spec.yMax ?? Math.max(...all);

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend.length ? legend : undefined}
      ariaLabel={`${title}. ${tr(t, 'ariaBoxes', { count: boxes.length })}. ${boxes
        .map((b) => `${b.label ? b.label + ': ' : ''}${tr(t, 'median')} ${fv(b.hinges[1])}, ${tr(t, 'q1')} ${fv(b.hinges[0])}, ${tr(t, 'q3')} ${fv(b.hinges[2])}`)
        .join('; ')}.`}
      table={{
        columns: [tr(t, clustered ? 'category' : 'group'), ...(clustered ? [tr(t, 'group')] : []), tr(t, 'whiskerLow'), tr(t, 'q1'), tr(t, 'median'), tr(t, 'q3'), tr(t, 'whiskerHigh'), tr(t, 'outliers')],
        rows: boxes.map((b) => [
          b.label || title,
          ...(clustered ? [b.group ?? ''] : []),
          fv(b.whiskers[0]),
          fv(b.hinges[0]),
          fv(b.hinges[1]),
          fv(b.hinges[2]),
          fv(b.whiskers[1]),
          b.outliers.map((o) => `${fv(o.value)}${o.label ? ` (${tr(t, 'case')} ${o.label}${o.extreme ? ', ' + tr(t, 'extreme') : ''})` : o.extreme ? ` (${tr(t, 'extreme')})` : ''}`).join('; '),
        ]),
        numeric: [false, ...(clustered ? [false] : []), true, true, true, true, true, false],
      }}
    >
      {(area) => {
        if (!boxes.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const [d0, d1] = padExtent(lo, hi, 0.04);
        const yCount = clamp(Math.floor(area.height / 48), 3, 8);
        const yt = applyDomain(niceTicks(d0, d1, yCount), style?.yMin, style?.yMax, yCount);
        const fy = tickFormatter(yt.step, yt.ticks, locale);
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), xTickLabels: anyLabel, style });
        const plotW = area.width - m.left - m.right;
        const plotH = area.height - m.top - m.bottom;
        const sy = linearScale(yt.domain, [m.top + plotH, m.top]);
        const band = plotW / nSlots;
        area.reg.x = (i: number) => m.left + band * (i + 0.5);
        area.reg.top = m.top;
        area.reg.height = plotH;
        const nG = Math.max(1, layout.groups.length);
        const clusterW = Math.min(band * 0.84, nG * 64);
        const slotW = clusterW / nG;
        const boxW = clustered ? clamp(slotW * 0.78, 6, 56) : clamp(band * 0.4, 12, 56);
        const centreOf = (bi: number) => {
          const { li, gi } = layout.cell[bi];
          return clustered ? m.left + band * (li + 0.5) - clusterW / 2 + slotW * (gi + 0.5) : m.left + band * (bi + 0.5);
        };
        return (
          <g>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            {boxes.map((b, bi) => {
              const cx = Math.round(centreOf(bi)) + 0.5;
              const color = clustered ? seriesColor(layout.cell[bi].gi) : undefined;
              const boxLabel = [b.label, clustered ? b.group || tr(t, 'missing') : ''].filter(Boolean).join(' / ');
              const [q1, med, q3] = b.hinges.map(sy);
              const wl = b.whiskers[0] !== null ? sy(b.whiskers[0]) : null;
              const wh = b.whiskers[1] !== null ? sy(b.whiskers[1]) : null;
              const capW = boxW * 0.5;
              const tip = {
                title: boxLabel || undefined,
                rows: [
                  { label: tr(t, 'whiskerHigh'), value: fv(b.whiskers[1]), key: 'none' as const },
                  { label: tr(t, 'q3'), value: fv(b.hinges[2]), key: 'none' as const },
                  { label: tr(t, 'median'), value: fv(b.hinges[1]), color: 'var(--c-ink)', key: 'line' as const },
                  { label: tr(t, 'q1'), value: fv(b.hinges[0]), key: 'none' as const },
                  { label: tr(t, 'whiskerLow'), value: fv(b.whiskers[0]), key: 'none' as const },
                  ...(b.outliers.length ? [{ label: tr(t, 'outliers'), value: String(b.outliers.length), key: 'none' as const }] : []),
                ],
              };
              const top = Math.min(wh ?? q3, q3);
              const bottom = Math.max(wl ?? q1, q1);
              // Outlier labels: skip a label that would collide with the previous one.
              const outs = b.outliers.map((o) => ({ o, y: sy(o.value) })).sort((a, z) => a.y - z.y);
              let lastY = -Infinity;
              const labelled = new Set<number>();
              outs.forEach((e, i) => {
                if (e.o.label && e.y - lastY >= FONT.label + 2) {
                  labelled.add(i);
                  lastY = e.y;
                }
              });
              return (
                <g key={bi}>
                  <g className="pspp-chart__mark pspp-chart__box" {...markTip(area.tip, tip, `${boxLabel ? boxLabel + ': ' : ''}${tr(t, 'median')} ${fv(b.hinges[1])}, ${tr(t, 'q1')} ${fv(b.hinges[0])}, ${tr(t, 'q3')} ${fv(b.hinges[2])}`)}>
                    <rect x={cx - boxW / 2 - 6} y={top - 4} width={boxW + 12} height={bottom - top + 8} className="pspp-chart__hitband" data-export="omit" />
                    {wh !== null && <line className="pspp-chart__whisker" x1={cx} x2={cx} y1={wh} y2={q3} />}
                    {wl !== null && <line className="pspp-chart__whisker" x1={cx} x2={cx} y1={q1} y2={wl} />}
                    {wh !== null && <line className="pspp-chart__whisker" x1={cx - capW / 2} x2={cx + capW / 2} y1={wh} y2={wh} />}
                    {wl !== null && <line className="pspp-chart__whisker" x1={cx - capW / 2} x2={cx + capW / 2} y1={wl} y2={wl} />}
                    <rect
                      className="pspp-chart__boxbody"
                      x={cx - boxW / 2}
                      y={q3}
                      width={boxW}
                      height={Math.max(1, q1 - q3)}
                      rx={3}
                      style={color ? { fill: color, stroke: color, fillOpacity: 0.28 } : undefined}
                    />
                    <line className="pspp-chart__median" x1={cx - boxW / 2 + 1} x2={cx + boxW / 2 - 1} y1={med} y2={med} />
                  </g>
                  {outs.map((e, i) => {
                    const otip = {
                      title: e.o.label ? `${tr(t, 'case')} ${e.o.label}` : undefined,
                      rows: [
                        {
                          label: tr(t, e.o.extreme ? 'extreme' : 'outlier'),
                          value: fv(e.o.value),
                          color: color ?? (e.o.extreme ? extColor : outColor),
                          key: 'marker' as const,
                          shape: e.o.extreme ? ('asterisk' as const) : ('ring' as const),
                        },
                      ],
                    };
                    return (
                      <g key={'o' + i} className="pspp-chart__mark" {...markTip(area.tip, otip)}>
                        <circle cx={cx} cy={e.y} r={10} className="pspp-chart__hitband" data-export="omit" />
                        <Marker shape={e.o.extreme ? 'asterisk' : 'ring'} x={cx} y={e.y} r={4} color={color ?? (e.o.extreme ? extColor : outColor)} />
                        {labelled.has(i) && (
                          <text className="pspp-chart__label" x={cx + 9} y={e.y} dominantBaseline="central">
                            {e.o.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {b.label && !clustered && (
                    <text className="pspp-chart__tick pspp-chart__tick--cat" x={cx} y={m.top + plotH + 15} textAnchor="middle">
                      {truncateText(b.label, band - 4, FONT.tick)}
                    </text>
                  )}
                </g>
              );
            })}
            {clustered &&
              layout.labels.map((l, li) =>
                l ? (
                  <text key={'cl' + li} className="pspp-chart__tick pspp-chart__tick--cat" x={m.left + band * (li + 0.5)} y={m.top + plotH + 15} textAnchor="middle">
                    {truncateText(l, band - 4, FONT.tick)}
                  </text>
                ) : null,
              )}
            <Baseline x1={m.left} x2={m.left + plotW} y={m.top + plotH} />
          </g>
        );
      }}
    </ChartShell>
  );
}
