import { ChartShell, FONT, seriesColor, useMarkTip, type ChartCommonProps } from './shell';
import { formatPercent, formatValue, measureText, truncateText } from './scale';
import { tr } from './strings';
import type { PieSpec } from './types';

interface Slice {
  label: string;
  value: number;
  color: string;
  members?: string[];
}

const ROW = 22;

/** At most eight categorical slots: past eight slices, the smallest fold into "Other". */
function foldSlices(spec: PieSpec, otherLabel: string): { slices: Slice[]; folded: number } {
  const live = spec.slices.filter((s) => s.value > 0);
  if (live.length <= 8) return { slices: live.map((s, i) => ({ ...s, color: seriesColor(i) })), folded: 0 };
  const keep = new Set(
    live
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.value - a.s.value || a.i - b.i)
      .slice(0, 7)
      .map((e) => e.i),
  );
  const slices: Slice[] = [];
  const rest: typeof live = [];
  live.forEach((s, i) => (keep.has(i) ? slices.push({ ...s, color: seriesColor(slices.length) }) : rest.push(s)));
  slices.push({ label: otherLabel, value: rest.reduce((a, s) => a + s.value, 0), color: 'var(--c-other)', members: rest.map((s) => s.label) });
  return { slices, folded: rest.length };
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    return `M${cx},${cy - r}A${r},${r} 0 1,1 ${cx - 0.01},${cy - r}Z`;
  }
  const p = (a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${cx},${cy}L${p(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0},1 ${p(a1)}Z`;
}

export function PieChart({ spec, ...c }: { spec: PieSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const mark = useMarkTip();
  const title = spec.title || tr(t, 'pieChart');
  const { slices, folded } = foldSlices(spec, tr(t, 'other'));
  const total = slices.reduce((s, x) => s + x.value, 0);
  const allTotal = spec.slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const valueText = (v: number) => `${formatValue(v, locale)} (${formatPercent(total ? v / total : 0, locale)})`;
  const wide = (w: number) => w >= 520;
  const diameter = (w: number) => (wide(w) ? Math.min(300, Math.max(180, w * 0.42)) : Math.min(260, w - 24));

  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${tr(t, 'ariaSlices', { count: spec.slices.length })}: ${spec.slices
        .map((s) => `${s.label} ${formatValue(s.value, locale)}`)
        .join(', ')}.`}
      table={{
        columns: [tr(t, 'category'), tr(t, 'value'), tr(t, 'share')],
        rows: [
          ...spec.slices.map((s) => [s.label, formatValue(s.value, locale), formatPercent(allTotal ? s.value / allTotal : 0, locale)]),
          [tr(t, 'total'), formatValue(allTotal, locale), formatPercent(1, locale)],
        ],
        numeric: [false, true, true],
        note: folded ? tr(t, 'otherFolded', { count: folded }) : undefined,
      }}
      plotHeight={(w) => {
        const d = diameter(w);
        const legendH = slices.length * ROW;
        return Math.ceil(wide(w) ? Math.max(d, legendH) + 16 : d + 20 + legendH);
      }}
    >
      {(area) => {
        if (!slices.length || total <= 0) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const isWide = wide(area.width);
        const d = Math.min(diameter(area.width), isWide ? area.height - 16 : area.height - 20 - slices.length * ROW);
        const r = Math.max(40, d / 2);
        const cx = isWide ? r + 8 : area.width / 2;
        const cy = isWide ? area.height / 2 : r + 4;
        const legendX = isWide ? cx + r + 40 : Math.max(0, area.width / 2 - Math.min(area.width, 360) / 2);
        const legendW = isWide ? Math.min(380, area.width - legendX) : Math.min(area.width, 360);
        const legendY = isWide ? Math.max(0, area.height / 2 - (slices.length * ROW) / 2) : cy + r + 20;
        let a = 0;
        return (
          <g>
            {slices.map((s, i) => {
              const a0 = a;
              a += (s.value / total) * Math.PI * 2;
              const tip = {
                title: s.label,
                rows: [
                  { label: tr(t, 'value'), value: valueText(s.value), color: s.color, key: 'rect' as const },
                  ...(s.members ? [{ label: '', value: s.members.join(', '), key: 'none' as const }] : []),
                ],
              };
              return (
                <path
                  key={i}
                  className="pspp-chart__mark pspp-chart__slice"
                  d={arcPath(cx, cy, r, a0, a)}
                  style={{ fill: s.color }}
                  {...mark(tip, `${s.label}: ${valueText(s.value)}`)}
                />
              );
            })}
            <g aria-hidden="true">
              {slices.map((s, i) => {
                const y = legendY + i * ROW + ROW / 2;
                const vt = valueText(s.value);
                const vw = measureText(vt, FONT.legend);
                return (
                  <g key={i}>
                    <rect x={legendX} y={y - 6} width={12} height={12} rx={2} style={{ fill: s.color }} />
                    <text className="pspp-chart__legend-text" x={legendX + 20} y={y} dominantBaseline="central">
                      {truncateText(s.label, legendW - 20 - vw - 12, FONT.legend)}
                    </text>
                    <text className="pspp-chart__legend-value" x={legendX + legendW} y={y} textAnchor="end" dominantBaseline="central">
                      {vt}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        );
      }}
    </ChartShell>
  );
}
