/* Mosaic plot: column widths by the x totals, cell heights by the y share within the column, optionally shaded by
   Pearson residual on a diverging scale.  Studio only (MosaicSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AxisTitles, ChartShell, FONT, plotMargins, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatPercent, formatValue, measureText, truncateText } from './scale';
import { mosaicLayout, pearsonResiduals, residualLevel } from './phase4Math';
import { EmptyPlot, tipProps } from './p4shared';
import { tr } from './strings';
import type { MosaicSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';

const GAP = 3;
/** Cells up to this many are keyboard focusable. */
const FOCUS_MAX = 150;

/** Diverging fill of a residual level: blue for more than expected, orange for fewer, neutral within +-2. */
export function residualFill(level: number): string {
  if (level === 0) return 'color-mix(in srgb, var(--c-muted) 22%, var(--c-surface))';
  const mix = Math.abs(level) >= 2 ? 82 : 42;
  return `color-mix(in srgb, var(${level > 0 ? '--c-series-1' : '--c-series-2'}) ${mix}%, var(--c-surface))`;
}

const LEVELS = [2, 1, 0, -1, -2] as const;
const LEVEL_TEXT: Record<number, string> = { 2: '> 4', 1: '2 – 4', 0: '−2 – 2', [-1]: '−4 – −2', [-2]: '< −4' };

export function MosaicChart({ spec, ...c }: { spec: MosaicSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'mosaicPlot');
  const xName = spec.xlabel || 'X';
  const yName = spec.ylabel || 'Y';
  const nx = spec.xs.length;
  const ny = spec.ys.length;
  const res = pearsonResiduals(spec.counts);
  const shade = spec.shade && res.total > 0;
  const colorOf = (yi: number) => (yi < 8 ? seriesColor(yi) : 'var(--c-other)');
  const fp = (v: number) => formatPercent(v, locale);
  const fv = (v: number) => formatValue(v, locale);

  const legend: LegendItem[] | undefined = shade
    ? LEVELS.map((l) => ({ label: LEVEL_TEXT[l], kind: 'rect' as const, color: residualFill(l) }))
    : ny > 1
      ? spec.ys.map((y, yi) => ({ label: y || tr(t, 'missing'), kind: 'rect' as const, color: colorOf(yi) }))
      : undefined;

  const rows: string[][] = [];
  for (let xi = 0; xi < nx; xi++) {
    const colT = spec.counts.reduce((s, r) => s + r[xi], 0);
    for (let yi = 0; yi < ny; yi++) {
      const n = spec.counts[yi][xi];
      rows.push([spec.xs[xi], spec.ys[yi], fv(n), colT > 0 ? fp(n / colT) : '–', ...(shade ? [formatValue(res.expected[yi][xi], locale, 2), formatValue(res.resid[yi][xi], locale, 2)] : [])]);
    }
  }
  const table = {
    columns: [xName, yName, tr(t, 'count'), tr(t, 'shareOfColumn'), ...(shade ? [tr(t, 'expected'), tr(t, 'residual')] : [])],
    rows,
    numeric: [false, false, true, true, ...(shade ? [true, true] : [])],
    note: shade ? `χ² = ${formatValue(res.chi2, locale, 2)}, ${tr(t, 'df')} = ${res.df}` : undefined,
  };

  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      legendTitle={shade ? tr(t, 'residual') : yName}
      ariaLabel={`${title}. ${xName} / ${yName}. ${tr(t, 'ariaCells', { count: nx * ny })}. ${tr(t, 'n')} = ${fv(res.total)}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(w * 0.62), 280, 480)}
    >
      {(area) => {
        if (!nx || !ny || !(res.total > 0)) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const size = FONT.tick * fs;
        const yLabels = spec.ys.map((s) => truncateText(s || tr(t, 'missing'), area.width * 0.26, size));
        const m0 = plotMargins({ yTickLabels: yLabels, yTitle: yName, xTitle: xName, style });
        const plotW = Math.max(40, area.width - m0.left - m0.right);
        const colW = mosaicLayout(spec.counts, plotW, 100, GAP).columns;

        // x labels: on the first level when they fit under their column, else on a second level, else dropped
        const xLab: { x: number; text: string; level: 0 | 1 }[] = [];
        const edge: [number, number] = [-Infinity, -Infinity];
        for (const col of colW) {
          if (!(col.w > 0)) continue;
          const text = truncateText(spec.xs[col.xi] || tr(t, 'missing'), Math.max(col.w + GAP, 56), size);
          const w = measureText(text, size);
          const cx = m0.left + col.x + col.w / 2;
          for (const lv of [0, 1] as const) {
            if (cx - w / 2 >= edge[lv] + 6) {
              xLab.push({ x: clamp(cx, m0.left + w / 2, m0.left + plotW - w / 2), text, level: lv });
              edge[lv] = cx + w / 2;
              break;
            }
          }
        }
        // a second label level takes room only when it is used
        const m = { ...m0, bottom: m0.bottom + (xLab.some((l) => l.level === 1) ? Math.round(14 * fs) : 0) };
        const plotH = Math.max(40, area.height - m.top - m.bottom);
        const lay = mosaicLayout(spec.counts, plotW, plotH, GAP);
        const focusable = lay.cells.length <= FOCUS_MAX;

        // y labels at the first column that holds the cell; labels closer than a line to the previous one are dropped
        const yLab: { y: number; text: string }[] = [];
        let lastY = -Infinity;
        for (let yi = 0; yi < ny; yi++) {
          const cell = lay.cells.find((k) => k.yi === yi);
          if (!cell) continue;
          const y = m.top + cell.y + cell.h / 2;
          if (y - lastY < size + 3) continue;
          yLab.push({ y, text: yLabels[yi] });
          lastY = y;
        }

        const tipOf = (k: (typeof lay.cells)[number]) => ({
          title: `${spec.xs[k.xi]} / ${spec.ys[k.yi]}`,
          rows: [
            { label: tr(t, 'count'), value: fv(k.count), color: shade ? residualFill(residualLevel(res.resid[k.yi][k.xi])) : colorOf(k.yi), key: 'rect' as const },
            { label: tr(t, 'shareOfColumn'), value: fp(k.colShare), key: 'none' as const },
            { label: tr(t, 'shareOfTotal'), value: fp(k.share), key: 'none' as const },
            ...(shade
              ? [
                  { label: tr(t, 'expected'), value: formatValue(res.expected[k.yi][k.xi], locale, 2), key: 'none' as const },
                  { label: tr(t, 'residual'), value: formatValue(res.resid[k.yi][k.xi], locale, 2), key: 'none' as const },
                ]
              : []),
          ],
        });

        return (
          <g>
            <g aria-hidden="true">
              {xLab.map((l, i) => (
                <text key={i} className="pspp-chart__tick pspp-chart__tick--cat" x={l.x} y={m.top + plotH + 14 * fs + l.level * 14 * fs} textAnchor="middle">
                  {l.text}
                </text>
              ))}
              {yLab.map((l, i) => (
                <text key={i} className="pspp-chart__tick pspp-chart__tick--cat" x={m.left - 8} y={l.y} textAnchor="end" dominantBaseline="central">
                  {l.text}
                </text>
              ))}
            </g>
            {lay.cells.map((k) => {
              const level = residualLevel(res.resid[k.yi][k.xi]);
              const pct = fp(k.colShare);
              const fits = k.w >= measureText(pct, size) + 8 && k.h >= size + 6;
              return (
                <g key={k.xi + ':' + k.yi} className="pspp-chart__mark" {...tipProps(area.tip, tipOf(k), focusable, `${spec.xs[k.xi]}, ${spec.ys[k.yi]}: ${fv(k.count)}, ${pct}`)}>
                  <rect x={m.left + k.x} y={m.top + k.y} width={Math.max(0, k.w)} height={Math.max(0, k.h)} rx={2} style={{ fill: shade ? residualFill(level) : colorOf(k.yi) }} />
                  {fits && (
                    <text
                      className={!shade || Math.abs(level) >= 2 ? 'pspp-chart__value pspp-chart__value--in' : 'pspp-chart__value'}
                      x={m.left + k.x + k.w / 2}
                      y={m.top + k.y + k.h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      pointerEvents="none"
                    >
                      {pct}
                    </text>
                  )}
                </g>
              );
            })}
            <AxisTitles xTitle={xName} yTitle={yName} left={m.left} top={m.top} width={plotW} height={plotH} totalHeight={area.height} />
          </g>
        );
      }}
    </ChartShell>
  );
}
