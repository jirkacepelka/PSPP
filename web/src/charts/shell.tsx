/* The chart container and shared SVG primitives: responsive sizing, wrapped
   title/subtitle, legend, hover toolbar (data table + export), tooltip,
   axes, gridlines and marker shapes. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { downloadPng, downloadSvg } from './export';
import { clamp, measureText, setMeasureFont, truncateText, wrapText, type LinearScale } from './scale';
import { tr, type ChartT } from './strings';

/* ------------------------------------------------------------------ types */

export interface ChartCommonProps {
  t: ChartT;
  locale?: string;
  /** Fixed width in px; omit to fill the container. */
  width?: number;
  /** Fixed total height in px; omit for an aspect-ratio based height. */
  height?: number;
}

export type MarkerShape =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'triangleDown'
  | 'plus'
  | 'hexagon'
  | 'star'
  | 'asterisk';

export const GROUP_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'plus', 'hexagon', 'star'];

export interface LegendItem {
  label: string;
  kind: 'rect' | 'line' | 'marker';
  color: string;
  shape?: MarkerShape;
}

export interface TableSpec {
  columns: string[];
  rows: string[][];
  /** Which columns hold numbers (right-aligned, tabular figures). */
  numeric?: boolean[];
  note?: string;
}

export interface TipRow {
  label: string;
  value: string;
  color?: string;
  key?: 'line' | 'marker' | 'rect' | 'none';
  shape?: MarkerShape;
}

export interface TipContent {
  title?: string;
  rows: TipRow[];
}

interface TipApi {
  show(at: { clientX: number; clientY: number } | Element, content: TipContent): void;
  hide(): void;
}

export interface PlotArea {
  width: number;
  height: number;
  uid: string;
}

/** Categorical slot colors (1-based slots, never cycled past 8). */
export const seriesColor = (i: number): string => (i >= 0 && i < 8 ? `var(--c-series-${i + 1})` : 'var(--c-other)');

export const FONT = {
  title: 14,
  subtitle: 12,
  legend: 12,
  axisTitle: 12,
  tick: 11,
  label: 11,
};

/* ---------------------------------------------------------------- tooltip */

const TipCtx = createContext<TipApi>({ show: () => undefined, hide: () => undefined });
export const useTip = (): TipApi => useContext(TipCtx);

/** Hover + keyboard focus handlers for one mark (bar, box, slice). */
export function useMarkTip(): (content: TipContent, ariaLabel?: string) => Record<string, unknown> {
  const tip = useTip();
  return useCallback(
    (content: TipContent, ariaLabel?: string) => ({
      tabIndex: 0,
      role: 'graphics-symbol',
      'aria-label': ariaLabel ?? [content.title, ...content.rows.map((r) => `${r.label}: ${r.value}`)].filter(Boolean).join(', '),
      onPointerEnter: (e: React.PointerEvent) => tip.show(e, content),
      onPointerMove: (e: React.PointerEvent) => tip.show(e, content),
      onPointerLeave: () => tip.hide(),
      onFocus: (e: React.FocusEvent) => tip.show(e.currentTarget, content),
      onBlur: () => tip.hide(),
    }),
    [tip],
  );
}

function TipKey({ row }: { row: TipRow }) {
  if (!row.color || row.key === 'none') return null;
  return (
    <svg className="pspp-chart__tipkey" width="14" height="10" aria-hidden="true">
      {row.key === 'marker' ? (
        <Marker shape={row.shape ?? 'circle'} x={7} y={5} r={3.5} color={row.color} ring={false} />
      ) : row.key === 'rect' ? (
        <rect x="2" y="0" width="10" height="10" rx="2" style={{ fill: row.color }} />
      ) : (
        <line x1="1" x2="13" y1="5" y2="5" style={{ stroke: row.color, strokeWidth: 2, strokeLinecap: 'round' }} />
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------- markers */

function shapePath(shape: MarkerShape, x: number, y: number, r: number): string {
  const poly = (n: number, rot: number, rr = r) => {
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
    }
    return 'M' + pts.join('L') + 'Z';
  };
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return `M${x - s},${y - s}h${2 * s}v${2 * s}h${-2 * s}Z`;
    }
    case 'triangle':
      return poly(3, -Math.PI / 2, r * 1.2);
    case 'triangleDown':
      return poly(3, Math.PI / 2, r * 1.2);
    case 'diamond':
      return poly(4, 0, r * 1.2);
    case 'hexagon':
      return poly(6, 0, r * 1.05);
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.55 : r * 1.3;
        pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
      }
      return 'M' + pts.join('L') + 'Z';
    }
    case 'plus': {
      const a = r * 1.1;
      const b = r * 0.38;
      return `M${x - b},${y - a}h${2 * b}v${a - b}h${a - b}v${2 * b}h${b - a}v${a - b}h${-2 * b}v${b - a}h${b - a}v${-2 * b}h${a - b}Z`;
    }
    default:
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
  }
}

export function Marker({
  shape,
  x,
  y,
  r = 4,
  color,
  ring = true,
  className,
}: {
  shape: MarkerShape;
  x: number;
  y: number;
  r?: number;
  color: string;
  ring?: boolean;
  className?: string;
}) {
  if (shape === 'asterisk') {
    const a = r * 1.35;
    const d = [0, 60, 120]
      .map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const dx = a * Math.sin(rad);
        const dy = a * Math.cos(rad);
        return `M${x - dx},${y - dy}L${x + dx},${y + dy}`;
      })
      .join('');
    return (
      <g className={className}>
        {ring && <path d={d} style={{ stroke: 'var(--c-surface)', strokeWidth: 6, strokeLinecap: 'round', fill: 'none' }} />}
        <path d={d} style={{ stroke: color, strokeWidth: 2, strokeLinecap: 'round', fill: 'none' }} />
      </g>
    );
  }
  return (
    <path
      className={className}
      d={shapePath(shape, x, y, r)}
      style={ring ? { fill: color, stroke: 'var(--c-surface)', strokeWidth: 4, paintOrder: 'stroke', strokeLinejoin: 'round' } : { fill: color }}
    />
  );
}

/** Column path: square at the baseline, 4px rounded data end. Handles negative values. */
export function barPath(x: number, w: number, yBase: number, yVal: number, radius = 4): string {
  const h = Math.abs(yBase - yVal);
  if (h <= 0 || w <= 0) return '';
  const r = Math.min(radius, w / 2, h);
  if (yVal <= yBase) {
    return `M${x},${yBase}V${yVal + r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yVal - r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal - r}V${yBase}Z`;
}

/* ------------------------------------------------------------------- axes */

export interface AxisSpec {
  scale: LinearScale;
  ticks: number[];
  format: (v: number) => string;
}

/** Margins around the plot rectangle that leave room for tick labels and axis titles. */
export function plotMargins(opts: { yTickLabels: string[]; yTitle?: string; xTitle?: string; xTickLabels?: boolean; extraBottom?: number; right?: number }) {
  const tickW = opts.yTickLabels.reduce((m, s) => Math.max(m, measureText(s, FONT.tick)), 0);
  const left = Math.ceil(tickW + 8 + (opts.yTitle ? 22 : 0));
  const bottom = (opts.xTickLabels === false ? 4 : 20) + (opts.xTitle ? 22 : 0) + (opts.extraBottom ?? 0);
  return { left, right: opts.right ?? 12, top: 10, bottom };
}

/** Horizontal gridlines + y tick labels (left of plot). */
export function YAxis({ axis, left, width, grid = true }: { axis: AxisSpec; left: number; width: number; grid?: boolean }) {
  return (
    <g className="pspp-chart__axis pspp-chart__axis--y" aria-hidden="true">
      {axis.ticks.map((v) => {
        const y = Math.round(axis.scale(v)) + 0.5;
        return (
          <g key={v}>
            {grid && <line className="pspp-chart__grid" x1={left} x2={left + width} y1={y} y2={y} />}
            <text className="pspp-chart__tick" x={left - 8} y={y} textAnchor="end" dominantBaseline="central">
              {axis.format(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Pick every k-th tick so the labels don't collide. */
function thinTicks(px: number[], labels: string[], minGap = 10): number {
  for (let k = 1; k < labels.length; k++) {
    let ok = true;
    let prevRight = -Infinity;
    for (let i = 0; i < labels.length; i += k) {
      const w = measureText(labels[i], FONT.tick);
      if (px[i] - w / 2 < prevRight + minGap) {
        ok = false;
        break;
      }
      prevRight = px[i] + w / 2;
    }
    if (ok) return k;
  }
  return Math.max(1, labels.length);
}

/** X tick labels below the plot, thinned to avoid collisions; optional vertical gridlines. */
export function XAxis({
  axis,
  top,
  height,
  left,
  width,
  grid = false,
}: {
  axis: AxisSpec;
  top: number;
  height: number;
  left: number;
  width: number;
  grid?: boolean;
}) {
  const px = axis.ticks.map((v) => axis.scale(v));
  const labels = axis.ticks.map(axis.format);
  const k = thinTicks(px, labels);
  return (
    <g className="pspp-chart__axis pspp-chart__axis--x" aria-hidden="true">
      {grid &&
        axis.ticks.map((v, i) => (
          <line key={'g' + v} className="pspp-chart__grid" x1={Math.round(px[i]) + 0.5} x2={Math.round(px[i]) + 0.5} y1={top} y2={top + height} />
        ))}
      {axis.ticks.map((v, i) => {
        if (i % k) return null;
        const w = measureText(labels[i], FONT.tick);
        let anchor: 'middle' | 'start' | 'end' = 'middle';
        let x = px[i];
        if (x - w / 2 < left - 24) {
          anchor = 'start';
          x = Math.max(x - 4, left - 24);
        } else if (x + w / 2 > left + width + 12) {
          anchor = 'end';
          x = Math.min(x + 4, left + width + 12);
        }
        return (
          <g key={v}>
            <line className="pspp-chart__tickmark" x1={Math.round(px[i]) + 0.5} x2={Math.round(px[i]) + 0.5} y1={top + height} y2={top + height + 4} />
            <text className="pspp-chart__tick" x={x} y={top + height + 15} textAnchor={anchor}>
              {labels[i]}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Axis baseline (the one darker hairline). */
export function Baseline({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  const yy = Math.round(y) + 0.5;
  return <line className="pspp-chart__baseline" x1={x1} x2={x2} y1={yy} y2={yy} aria-hidden="true" />;
}

export function AxisTitles({
  xTitle,
  yTitle,
  left,
  top,
  width,
  height,
  totalHeight,
}: {
  xTitle?: string;
  yTitle?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  totalHeight: number;
}) {
  return (
    <g aria-hidden="true">
      {xTitle && (
        <text className="pspp-chart__axis-title" x={left + width / 2} y={totalHeight - 4} textAnchor="middle">
          {truncateText(xTitle, width + left * 0.8, FONT.axisTitle)}
        </text>
      )}
      {yTitle && (
        <text className="pspp-chart__axis-title" transform={`translate(11 ${top + height / 2}) rotate(-90)`} textAnchor="middle" dominantBaseline="central">
          {truncateText(yTitle, height + 10, FONT.axisTitle)}
        </text>
      )}
    </g>
  );
}

/* ----------------------------------------------------------------- legend */

interface LegendLayout {
  rows: { item: LegendItem; x: number; text: string }[][];
  height: number;
}

const SWATCH = 16;

function layoutLegend(items: LegendItem[], maxW: number): LegendLayout {
  const rows: LegendLayout['rows'] = [];
  let row: LegendLayout['rows'][number] = [];
  let x = 0;
  for (const item of items) {
    const text = truncateText(item.label, Math.max(40, maxW - SWATCH - 6), FONT.legend);
    const w = SWATCH + 6 + measureText(text, FONT.legend);
    if (row.length && x + w > maxW) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ item, x, text });
    x += w + 16;
  }
  if (row.length) rows.push(row);
  return { rows, height: rows.length * 20 };
}

export function LegendSwatch({ item, x, y }: { item: LegendItem; x: number; y: number }) {
  if (item.kind === 'rect') return <rect x={x + 2} y={y - 6} width={12} height={12} rx={2} style={{ fill: item.color }} />;
  if (item.kind === 'line') return <line x1={x} x2={x + SWATCH} y1={y} y2={y} style={{ stroke: item.color, strokeWidth: 2, strokeLinecap: 'round' }} />;
  return <Marker shape={item.shape ?? 'circle'} x={x + SWATCH / 2} y={y} r={4} color={item.color} />;
}

function Legend({ layout, y }: { layout: LegendLayout; y: number }) {
  return (
    <g className="pspp-chart__legend" aria-hidden="true">
      {layout.rows.map((row, ri) =>
        row.map(({ item, x, text }, i) => (
          <g key={ri + ':' + i}>
            <LegendSwatch item={item} x={x} y={y + ri * 20 + 10} />
            <text className="pspp-chart__legend-text" x={x + SWATCH + 6} y={y + ri * 20 + 10} dominantBaseline="central">
              {text}
            </text>
          </g>
        )),
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ table */

const MAX_TABLE_ROWS = 500;

function DataTable({ table, title, t }: { table: TableSpec; title: string; t: ChartT }) {
  const rows = table.rows.slice(0, MAX_TABLE_ROWS);
  return (
    <div className="pspp-chart__table-wrap">
      <table className="pspp-chart__table">
        <caption className="pspp-chart__sr">{title}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={table.numeric?.[i] ? 'num' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) =>
                ci === 0 && !table.numeric?.[0] ? (
                  <th key={ci} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={ci} className={table.numeric?.[ci] ? 'num' : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {(table.rows.length > MAX_TABLE_ROWS || table.note) && (
        <p className="pspp-chart__note">
          {table.rows.length > MAX_TABLE_ROWS && tr(t, 'tableTruncated', { shown: MAX_TABLE_ROWS, total: table.rows.length })} {table.note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ icons */

const IconTable = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 6.5h12M2 9.75h12M6.5 6.5V13" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5v7.5M4.5 7l3.5 3.5L11.5 7M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ------------------------------------------------------------------ shell */

export interface ChartShellProps extends ChartCommonProps {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  ariaLabel: string;
  table: TableSpec;
  /** Plot-area height for a given inner width (when no fixed height is set). */
  plotHeight?: (innerWidth: number) => number;
  children: (area: PlotArea) => ReactNode;
}

const TOOLBAR_RESERVE = 104;

export function ChartShell(props: ChartShellProps) {
  const { title, subtitle, legend, ariaLabel, table, t, children } = props;
  const rootRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [measured, setMeasured] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; flipX: boolean; flipY: boolean; content: TipContent } | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ff = getComputedStyle(el).fontFamily;
    if (ff) setMeasureFont(ff);
    if (props.width) return;
    setMeasured(Math.floor(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      setMeasured((old) => (Math.abs(old - w) >= 1 ? w : old));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.width]);

  const tipApi = useMemo<TipApi>(
    () => ({
      show(at, content) {
        const root = rootRef.current;
        if (!root) return;
        const r = root.getBoundingClientRect();
        let x: number;
        let y: number;
        if (at instanceof Element) {
          const b = at.getBoundingClientRect();
          x = b.left + b.width / 2 - r.left;
          y = b.top + Math.min(b.height / 2, 16) - r.top;
        } else {
          x = at.clientX - r.left;
          y = at.clientY - r.top;
        }
        setTip({ x, y, flipX: x > r.width * 0.6, flipY: y > 120, content });
      },
      hide() {
        setTip(null);
      },
    }),
    [],
  );

  const width = props.width ?? measured;
  const px = width < 480 ? 12 : 16;
  const innerW = Math.max(120, width - px * 2);

  // Header layout (all inside the SVG, so exports carry the title and legend).
  const titleLines = width ? wrapText(title, Math.max(80, innerW - TOOLBAR_RESERVE), FONT.title, 600, 3) : [];
  const subLines = width && subtitle ? wrapText(subtitle, innerW, FONT.subtitle, 400, 3) : [];
  const legendLayout = width && legend && legend.length ? layoutLegend(legend, innerW) : null;
  let y = 14;
  const titleY = y;
  y += titleLines.length * 20;
  const subY = y;
  y += subLines.length * 17;
  if (subLines.length) y += 2;
  const legendY = y + (legendLayout ? 4 : 0);
  if (legendLayout) y = legendY + legendLayout.height;
  const headerH = y + 8;
  const bottomPad = 12;
  const defaultPlotH = props.plotHeight ? props.plotHeight(innerW) : clamp(Math.round(innerW * 0.56), 220, 420);
  const plotH = Math.round(props.height ? Math.max(160, props.height - headerH - bottomPad) : defaultPlotH);
  const totalH = headerH + plotH + bottomPad;

  const doSvg = () => svgRef.current && downloadSvg(svgRef.current, title);
  const doPng = () => {
    if (svgRef.current) void downloadPng(svgRef.current, title).catch(() => undefined);
  };

  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTip(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tip]);

  const tableLabel = showTable ? tr(t, 'hideDataTable') : tr(t, 'showDataTable');
  const svgLabel = tr(t, 'downloadSvg');
  const pngLabel = tr(t, 'downloadPng');

  return (
    <figure ref={rootRef} className="pspp-chart" style={props.width ? ({ width: props.width } as CSSProperties) : undefined}>
      <TipCtx.Provider value={tipApi}>
        {width > 0 ? (
          <svg
            ref={svgRef}
            className="pspp-chart__svg"
            role="img"
            aria-label={ariaLabel}
            width={width}
            height={totalH}
            viewBox={`0 0 ${width} ${totalH}`}
          >
            <title>{ariaLabel}</title>
            <rect className="pspp-chart__bg" x="0" y="0" width={width} height={totalH} />
            <g transform={`translate(${px} 0)`}>
              {titleLines.map((l, i) => (
                <text key={i} className="pspp-chart__title" x={0} y={titleY + i * 20 + 10} dominantBaseline="central">
                  {l}
                </text>
              ))}
              {subLines.map((l, i) => (
                <text key={i} className="pspp-chart__subtitle" x={0} y={subY + i * 17 + 9} dominantBaseline="central">
                  {l}
                </text>
              ))}
              {legendLayout && <Legend layout={legendLayout} y={legendY} />}
              <g transform={`translate(0 ${headerH})`}>{children({ width: innerW, height: plotH, uid })}</g>
            </g>
          </svg>
        ) : (
          <div style={{ height: 320 }} />
        )}
      </TipCtx.Provider>
      <div className="pspp-chart__toolbar" role="toolbar" aria-label={tr(t, 'chartTools')}>
        <button type="button" className="pspp-chart__btn" aria-pressed={showTable} title={tableLabel} aria-label={tableLabel} onClick={() => setShowTable((s) => !s)}>
          <IconTable />
        </button>
        <button type="button" className="pspp-chart__btn" title={svgLabel} aria-label={svgLabel} onClick={doSvg}>
          <IconDownload />
          <span>SVG</span>
        </button>
        <button type="button" className="pspp-chart__btn" title={pngLabel} aria-label={pngLabel} onClick={doPng}>
          <IconDownload />
          <span>PNG</span>
        </button>
      </div>
      {tip && (
        <div
          className="pspp-chart__tooltip"
          role="presentation"
          style={{
            left: tip.x,
            top: tip.y,
            transform: `translate(${tip.flipX ? 'calc(-100% - 14px)' : '14px'}, ${tip.flipY ? 'calc(-100% - 10px)' : '10px'})`,
          }}
        >
          {tip.content.title && <div className="pspp-chart__tip-title">{tip.content.title}</div>}
          {tip.content.rows.map((r, i) => (
            <div key={i} className="pspp-chart__tip-row">
              <TipKey row={r} />
              <span className="pspp-chart__tip-value">{r.value}</span>
              <span className="pspp-chart__tip-label">{r.label}</span>
            </div>
          ))}
        </div>
      )}
      {showTable && <DataTable table={table} title={title} t={t} />}
    </figure>
  );
}
