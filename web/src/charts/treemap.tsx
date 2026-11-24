/* Treemap: squarified tiles by value, coloured by group, labels fitted to the tiles.  Studio only (TreemapSpec in
   studioTypes.ts).  SPDX-License-Identifier: GPL-3.0-or-later */

import { ChartShell, FONT, seriesColor, type ChartCommonProps, type LegendItem } from './shell';
import { clamp, formatPercent, formatValue, truncateText, wrapText } from './scale';
import { tileLabelRoom, treemapLayout } from './phase4Math';
import { EmptyPlot, tipProps } from './p4shared';
import { tr } from './strings';
import type { TreemapSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { fontScaleOf } from './styleSpec';

const PAD = 3;
const FOCUS_MAX = 120;

export function TreemapChart({ spec, ...c }: { spec: TreemapSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const style = useStyle();
  const fs = fontScaleOf(style);
  const title = spec.title || tr(t, 'treemap');
  const tiles = spec.tiles;
  const total = tiles.reduce((s, x) => s + x.value, 0);
  const groups: string[] = [];
  tiles.forEach((x) => x.group && !groups.includes(x.group) && groups.push(x.group));
  const grouped = groups.length > 1;
  const slot = (g: string | null | undefined) => (g ? groups.indexOf(g) : groups.length);
  const colorOf = (g: string | null | undefined) => (grouped ? (slot(g) < 8 ? seriesColor(slot(g)) : 'var(--c-other)') : seriesColor(0));
  const hasUngrouped = grouped && tiles.some((x) => !x.group);
  const legend: LegendItem[] | undefined = grouped
    ? [...groups.map((g) => ({ label: g, kind: 'rect' as const, color: colorOf(g) })), ...(hasUngrouped ? [{ label: tr(t, 'other'), kind: 'rect' as const, color: colorOf(null) }] : [])]
    : undefined;
  const fv = (v: number) => formatValue(v, locale);
  const fp = (v: number) => formatPercent(total > 0 ? v / total : 0, locale);
  const table = {
    columns: [tr(t, 'category'), ...(grouped ? [tr(t, 'group')] : []), tr(t, 'value'), tr(t, 'share')],
    rows: tiles.map((x) => [x.label, ...(grouped ? [x.group ?? ''] : []), fv(x.value), fp(x.value)]),
    numeric: [false, ...(grouped ? [false] : []), true, true],
  };
  return (
    <ChartShell
      {...c}
      title={title}
      legend={legend}
      ariaLabel={`${title}. ${tr(t, 'ariaTiles', { count: tiles.length })}: ${tiles
        .slice(0, 20)
        .map((x) => `${x.label} ${fp(x.value)}`)
        .join(', ')}.`}
      table={table}
      plotHeight={(w) => clamp(Math.round(w * 0.62), 260, 520)}
    >
      {(area) => {
        if (!tiles.length) return <EmptyPlot width={area.width} height={area.height} text={tr(t, 'noData')} />;
        const lay = treemapLayout(tiles, { x: 0, y: 4, w: area.width, h: area.height - 8 }, PAD);
        const size = FONT.label * fs;
        const lineH = Math.round(14 * fs);
        const showValues = style?.valueLabels !== false;
        const maxV = Math.max(...tiles.map((x) => x.value));
        const focusable = tiles.length <= FOCUS_MAX;
        return (
          <g>
            {tiles.map((x, i) => {
              const r = lay.tiles[i];
              if (!(r.w > 0.5 && r.h > 0.5)) return null;
              const room = tileLabelRoom(r.w, r.h, size);
              const inner = r.w - 10;
              const withValue = showValues && room.value;
              const maxLines = Math.max(1, Math.floor((r.h - 8) / lineH) - (withValue ? 1 : 0));
              const lines = room.label ? wrapText(x.label, inner, size, 600, Math.min(3, maxLines)) : [];
              const color = colorOf(x.group);
              // without groups the tint follows the value, with groups the group colour decides
              const mix = grouped ? 40 : Math.round(24 + 26 * Math.sqrt(x.value / maxV));
              const tip = {
                title: x.label,
                rows: [
                  { label: tr(t, 'value'), value: fv(x.value), color, key: 'rect' as const },
                  { label: tr(t, 'share'), value: fp(x.value), key: 'none' as const },
                  ...(x.group ? [{ label: tr(t, 'group'), value: x.group, key: 'none' as const }] : []),
                ],
              };
              return (
                <g key={i} className="pspp-chart__mark" {...tipProps(area.tip, tip, focusable, `${x.label}: ${fv(x.value)}, ${fp(x.value)}`)}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={Math.min(3, r.w / 4, r.h / 4)} style={{ fill: `color-mix(in srgb, ${color} ${mix}%, var(--c-surface))`, stroke: color, strokeWidth: 1.25 }} />
                  <g pointerEvents="none" aria-hidden="true">
                    {lines.map((l, k) => (
                      <text key={k} className="pspp-chart__tile-label" x={r.x + 5} y={r.y + 5 + lineH * k + lineH / 2} dominantBaseline="central">
                        {truncateText(l, inner, size, 600)}
                      </text>
                    ))}
                    {withValue && lines.length > 0 && (
                      <text className="pspp-chart__tile-value" x={r.x + 5} y={r.y + 5 + lineH * lines.length + lineH / 2} dominantBaseline="central">
                        {truncateText(`${fv(x.value)} · ${fp(x.value)}`, inner, size)}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartShell>
  );
}
