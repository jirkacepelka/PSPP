/* Scatterplot matrix: every pair of variables as a small scatterplot, the variable names on the
   diagonal.  Up to six variables.  Studio only (MatrixSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, FONT, GROUP_SHAPES, seriesColor, markTip, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatValue, linearScale, padExtent, tickFormatter, ticksWithin, truncateText, wrapText } from './scale';
import { tr } from './strings';
import type { MatrixSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';

const MAX_POINTS = 700;

function pearson(a: (number | null)[], b: (number | null)[]): { r: number | null; n: number } {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== null && b[i] !== null) (n++, (sa += a[i]!), (sb += b[i]!));
  if (n < 3) return { r: null, n };
  const ma = sa / n;
  const mb = sb / n;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== null && b[i] !== null) {
      saa += (a[i]! - ma) ** 2;
      sbb += (b[i]! - mb) ** 2;
      sab += (a[i]! - ma) * (b[i]! - mb);
    }
  return { r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null, n };
}

export function MatrixChart({ spec, ...c }: { spec: MatrixSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'scatterMatrix');
  const k = spec.vars.length;
  const cols = spec.vars.map((_, j) => spec.rows.map((r) => r[j] ?? null));
  const groupNames: string[] = [];
  if (spec.groups) for (const g of spec.groups) if (g !== null && !groupNames.includes(g)) groupNames.push(g);
  const gIdx = (i: number) => {
    const g = spec.groups?.[i];
    return g == null ? 0 : Math.min(8, groupNames.indexOf(g));
  };
  const legend: LegendItem[] | undefined = groupNames.length > 1 ? groupNames.slice(0, 8).map((g, i) => ({ label: g, kind: 'marker', shape: GROUP_SHAPES[i], color: seriesColor(i) })) : undefined;

  return (
    <ChartShell
      {...c}
      title={title}
      subtitle={spec.byvar ? spec.byvar : undefined}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaVariables', { count: k })}: ${spec.vars.join(', ')}. ${tr(t, 'ariaPoints', { count: spec.rows.length })}.`}
      table={{
        columns: [...(spec.groups ? [spec.byvar || tr(t, 'group')] : []), ...spec.vars],
        rows: spec.rows.map((r, i) => [...(spec.groups ? [spec.groups[i] ?? ''] : []), ...r.map((v) => (v === null ? '' : formatValue(v, locale)))]),
        numeric: [...(spec.groups ? [false] : []), ...spec.vars.map(() => true)],
      }}
      plotHeight={(w) => clamp(Math.round(Math.min(w, 760) * 0.92), 260, 720)}
    >
      {(area) => {
        if (!k || !spec.rows.length) {
          return (
            <text className="pspp-chart__empty" x={area.width / 2} y={area.height / 2} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const padL = 38 * fs;
        const padB = 20 * fs;
        const size = Math.max(60, Math.min(area.width - padL - 8, area.height - padB - 8));
        const cell = size / k;
        const x0 = padL + Math.max(0, (area.width - padL - size) / 2);
        const y0 = 4;
        const small = cell < 90;
        const ranges = cols.map((col) => {
          const vals = col.filter((v): v is number => v !== null);
          return vals.length ? padExtent(Math.min(...vals), Math.max(...vals), 0.06) : ([0, 1] as [number, number]);
        });
        const ticks = ranges.map((r) => ticksWithin(r[0], r[1], small ? 2 : 3));
        const stride = Math.max(1, Math.ceil(spec.rows.length / MAX_POINTS));
        const r = cell < 80 ? 1.8 : 2.4;
        return (
          <g>
            {Array.from({ length: k }, (_, i) =>
              Array.from({ length: k }, (_, j) => {
                const cx = x0 + j * cell;
                const cy = y0 + i * cell;
                if (i === j) {
                  const lines = wrapText(spec.vars[i], cell - 10, FONT.label * fs + 1, 600, 3);
                  return (
                    <g key={i + ':' + j}>
                      <rect x={cx} y={cy} width={cell} height={cell} className="pspp-chart__matrix-diag" />
                      {lines.map((l, li) => (
                        <text key={li} className="pspp-chart__axis-title pspp-chart__matrix-name" x={cx + cell / 2} y={cy + cell / 2 + (li - (lines.length - 1) / 2) * (FONT.label * fs + 4)} textAnchor="middle" dominantBaseline="central">
                          {l}
                        </text>
                      ))}
                    </g>
                  );
                }
                const sx = linearScale(ticks[j].domain, [cx + 3, cx + cell - 3]);
                const sy = linearScale(ticks[i].domain, [cy + cell - 3, cy + 3]);
                const { r: corr, n } = pearson(cols[j], cols[i]);
                const tip = {
                  title: `${spec.vars[i]} × ${spec.vars[j]}`,
                  rows: [
                    { label: tr(t, 'n'), value: formatValue(n, locale), key: 'none' as const },
                    { label: 'r', value: corr === null ? '–' : formatValue(corr, locale, 3), key: 'none' as const },
                  ],
                };
                return (
                  <g key={i + ':' + j} className="pspp-chart__mark pspp-chart__cell" {...markTip(area.tip, tip, `${spec.vars[i]} × ${spec.vars[j]}, r = ${corr === null ? '–' : formatValue(corr, locale, 3)}`)}>
                    <rect x={cx} y={cy} width={cell} height={cell} className="pspp-chart__matrix-cell" />
                    {ticks[j].ticks.map((v) => (
                      <line key={'x' + v} className="pspp-chart__grid" x1={Math.round(sx(v)) + 0.5} x2={Math.round(sx(v)) + 0.5} y1={cy} y2={cy + cell} />
                    ))}
                    {ticks[i].ticks.map((v) => (
                      <line key={'y' + v} className="pspp-chart__grid" x1={cx} x2={cx + cell} y1={Math.round(sy(v)) + 0.5} y2={Math.round(sy(v)) + 0.5} />
                    ))}
                    {spec.rows.map((_row, ri) => {
                      if (ri % stride) return null;
                      const a = cols[j][ri];
                      const b = cols[i][ri];
                      if (a === null || b === null) return null;
                      return <circle key={ri} cx={sx(a)} cy={sy(b)} r={r} style={{ fill: seriesColor(gIdx(ri)), fillOpacity: 0.65 }} />;
                    })}
                  </g>
                );
              }),
            )}
            {/* outer tick labels: x under the bottom row, y left of the first column */}
            <g className="pspp-chart__axis" aria-hidden="true">
              {Array.from({ length: k }, (_, j) => {
                const cx = x0 + j * cell;
                const sx = linearScale(ticks[j].domain, [cx + 3, cx + cell - 3]);
                const f = tickFormatter(ticks[j].step, ticks[j].ticks, locale);
                return ticks[j].ticks.map((v) => (
                  <text key={'bx' + j + ':' + v} className="pspp-chart__tick" x={sx(v)} y={y0 + size + 13 * fs} textAnchor="middle">
                    {truncateText(f(v), cell / 2, FONT.tick * fs)}
                  </text>
                ));
              })}
              {Array.from({ length: k }, (_, i) => {
                const cy = y0 + i * cell;
                const sy = linearScale(ticks[i].domain, [cy + cell - 3, cy + 3]);
                const f = tickFormatter(ticks[i].step, ticks[i].ticks, locale);
                return ticks[i].ticks.map((v) => (
                  <text key={'ly' + i + ':' + v} className="pspp-chart__tick" x={x0 - 6} y={sy(v)} textAnchor="end" dominantBaseline="central">
                    {f(v)}
                  </text>
                ));
              })}
            </g>
          </g>
        );
      }}
    </ChartShell>
  );
}
