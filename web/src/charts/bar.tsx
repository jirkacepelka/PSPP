import { AxisTitles, Baseline, ChartShell, FONT, YAxis, barPath, plotMargins, seriesColor, markTip, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatPercent, formatValue, linearScale, measureText, niceTicks, percentTickFormatter, tickFormatter, truncateText } from './scale';
import { tr } from './strings';
import type { BarSpec } from './types';

const GAP = 2;
const MAX_BAR = 24;
const MAX_ROTATED = 110;

/** How category labels fit a band: flat, tilted 45°, or vertical (thinned if still too dense). */
function catLabels(cats: string[], band: number) {
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

export function BarChart({ spec, ...c }: { spec: BarSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const title = spec.title || tr(t, 'barChart');
  const yName = spec.ylabel || (spec.percent ? tr(t, 'percent') : tr(t, 'count'));

  const cats: string[] = [];
  const groups: string[] = [];
  const cell = new Map<string, number>();
  const grouped = spec.bars.some((b) => b.group !== null);
  for (const b of spec.bars) {
    if (!cats.includes(b.x)) cats.push(b.x);
    const g = b.group ?? '';
    if (grouped && !groups.includes(g)) groups.push(g);
    cell.set(b.x + '\u0000' + g, (cell.get(b.x + '\u0000' + g) ?? 0) + b.count);
  }
  const nG = grouped ? groups.length : 1;
  const gList = grouped ? groups : [''];
  const value = (count: number) => (spec.percent && spec.total ? (count * 100) / spec.total : count);
  const fmtVal = (count: number) => (spec.percent && spec.total ? formatPercent(count / spec.total, locale) : formatValue(count, locale));
  // Groups beyond the eighth slot fold into the neutral "other" color.
  const gColor = (gi: number) => (grouped ? seriesColor(gi) : seriesColor(0));
  const legend: LegendItem[] | undefined = grouped ? groups.map((g, gi) => ({ label: g || tr(t, 'missing'), kind: 'rect', color: gColor(gi) })) : undefined;

  const tableCols = grouped ? [tr(t, 'category'), tr(t, 'group'), yName] : [tr(t, 'category'), yName];
  const rows = spec.bars.map((b) => (grouped ? [b.x, b.group ?? '', fmtVal(b.count)] : [b.x, fmtVal(b.count)]));

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${yName}. ${tr(t, 'ariaBars', { count: spec.bars.length })}: ${spec.bars
        .slice(0, 30)
        .map((b) => `${b.x}${grouped ? ' / ' + (b.group ?? '') : ''} ${fmtVal(b.count)}`)
        .join(', ')}.`}
      table={{ columns: tableCols, rows, numeric: grouped ? [false, false, true] : [false, true] }}
      plotHeight={(w) => clamp(Math.round(w * 0.56), 240, 420) + catLabels(cats, Math.max(1, (w - 64) / Math.max(1, cats.length))).labelBand - 18}
    >
      {(area) => {
        if (!cats.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const maxV = spec.bars.reduce((m, b) => Math.max(m, value(b.count)), 0);
        const minV = Math.min(0, ...spec.bars.map((b) => value(b.count)));
        const yt = niceTicks(minV, maxV || 1, clamp(Math.floor(area.height / 48), 3, 8));
        const fy = spec.percent ? percentTickFormatter(yt.step, locale) : tickFormatter(yt.step, yt.ticks, locale);

        // First pass for the left margin, then size the category labels.
        const m = plotMargins({ yTickLabels: yt.ticks.map(fy), yTitle: yName });
        const plotW = area.width - m.left - m.right;
        const band = plotW / cats.length;
        const { mode, every, labels: rotLabels, labelBand } = catLabels(cats, band);

        const showValues = !grouped && cats.length <= 24 && cats.every((cName) => measureText(fmtVal(cell.get(cName + '\u0000') ?? 0), FONT.label) <= band - 4);
        const top = m.top + (showValues ? 14 : 0);
        const plotH = area.height - top - labelBand - 4;
        const sy = linearScale(yt.domain, [top + plotH, top]);
        const base = sy(0);
        const cluster = Math.min(nG * MAX_BAR + (nG - 1) * GAP, band * (nG > 1 ? 0.84 : 0.7));
        const barW = Math.max(1, (cluster - (nG - 1) * GAP) / nG);

        return (
          <g>
            <YAxis axis={{ scale: sy, ticks: yt.ticks, format: fy }} left={m.left} width={plotW} />
            {cats.map((cName, ci) => {
              const cx = m.left + band * (ci + 0.5);
              const x0 = cx - cluster / 2;
              return (
                <g key={ci}>
                  {gList.map((g, gi) => {
                    const count = cell.get(cName + '\u0000' + g);
                    if (count === undefined) return null;
                    const x = x0 + gi * (barW + GAP);
                    const yv = sy(value(count));
                    const tip = {
                      title: cName,
                      rows: [{ label: grouped ? g || tr(t, 'missing') : yName, value: fmtVal(count), color: gColor(gi), key: 'rect' as const }],
                    };
                    return (
                      <g key={gi} className="pspp-chart__mark" {...markTip(area.tip, tip, `${cName}${grouped ? ', ' + g : ''}: ${fmtVal(count)}`)}>
                        <rect x={x - GAP / 2} y={top} width={barW + GAP} height={plotH} className="pspp-chart__hitband" data-export="omit" />
                        <path d={barPath(x, barW, base, yv)} style={{ fill: gColor(gi) }} />
                        {showValues && (
                          <text className="pspp-chart__value" x={x + barW / 2} y={Math.min(yv, base) - 5} textAnchor="middle">
                            {fmtVal(count)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {ci % every === 0 &&
                    (mode === 'flat' ? (
                      <text className="pspp-chart__tick pspp-chart__tick--cat" x={cx} y={top + plotH + 15} textAnchor="middle">
                        {rotLabels[ci]}
                      </text>
                    ) : (
                      <text
                        className="pspp-chart__tick pspp-chart__tick--cat"
                        transform={`translate(${cx} ${top + plotH + 8}) rotate(${mode === 'tilt' ? -45 : -90})`}
                        textAnchor="end"
                        dominantBaseline="central"
                      >
                        {rotLabels[ci]}
                      </text>
                    ))}
                </g>
              );
            })}
            <Baseline x1={m.left} x2={m.left + plotW} y={base} />
            <AxisTitles yTitle={yName} left={m.left} top={top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
