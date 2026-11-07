/*
 * Minimal SVG renderer for the demo engine's chart data. The real engine charts are rendered
 * by the shared PsppChart component (src/charts) once available.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { PsppChart } from '../../charts';
import { useData } from '../../store/data';
import type { Dataset } from '../../engine/types';

const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Histograms arrive from the engine as bins only. When the charted variable (matched by its label
 * or name, which the engine uses as the chart title) holds whole numbers only, mark the chart so
 * bins are labelled by their values ("20") instead of their bounds ("20 – 21").
 */
function withIntegerHint(chart: unknown, ds: Dataset | null, itemTitle: string): unknown {
  if (!ds || typeof chart !== 'object' || chart === null) return chart;
  const outer = chart as Record<string, unknown>;
  const inner = (typeof outer.chart === 'object' && outer.chart ? outer.chart : outer) as Record<string, unknown>;
  if (inner.type !== 'histogram') return chart;
  const title = norm(String(inner.title || outer.title || itemTitle || ''));
  if (!title) return chart;
  const idx = ds.variables.findIndex((v) => v.type !== 'string' && (norm(v.label ?? '') === title || norm(v.name) === title));
  if (idx < 0) return chart;
  const col = ds.columns[idx] ?? [];
  const integer = col.some((x) => typeof x === 'number') && col.every((x) => x === null || typeof x !== 'number' || !Number.isFinite(x) || Number.isInteger(x));
  if (!integer) return chart;
  return inner === outer ? { ...outer, integer: true } : { ...outer, chart: { ...inner, integer: true } };
}

interface SimpleChart {
  type: 'bar' | 'histogram' | 'pie';
  categories: string[];
  values: number[];
  xLabel?: string;
  yLabel?: string;
  mean?: number;
  sd?: number;
  n?: number;
}

/** True for the demo engine's simplified chart data (the real engine sends PSPP chart JSON). */
export function isSimple(c: unknown): c is SimpleChart {
  const x = c as SimpleChart;
  return !!x && typeof x === 'object' && ['bar', 'histogram', 'pie'].includes(x.type) && Array.isArray(x.values) && Array.isArray(x.categories);
}

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function ChartView({ chart, title }: { chart: unknown; title: string }) {
  const { t, i18n } = useTranslation();
  const ds = useData((s) => s.dataset);
  const hinted = useMemo(() => withIntegerHint(chart, ds, title), [chart, ds, title]);
  if (!isSimple(chart)) {
    return (
      <PsppChart
        chart={hinted}
        t={(key, fallback) => t(key, { ns: 'charts', defaultValue: fallback })}
        locale={i18n.language}
      />
    );
  }
  const W = 560;
  const H = 300;
  if (chart.type === 'pie') {
    const total = chart.values.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = 150;
    const cy = 150;
    const r = 120;
    return (
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {chart.values.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
          a0 = a1;
          return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="var(--paper)" strokeWidth={2} />;
        })}
        {chart.categories.map((c, i) => (
          <g key={i} transform={`translate(310, ${40 + i * 24})`}>
            <rect width={14} height={14} rx={3} fill={PALETTE[i % PALETTE.length]} />
            <text x={22} y={12} className="chart-text">
              {c} ({Math.round((100 * chart.values[i]) / total)} %)
            </text>
          </g>
        ))}
      </svg>
    );
  }
  const pad = { l: 52, r: 16, t: 16, b: 56 };
  const max = niceMax(Math.max(...chart.values, 0));
  const n = chart.values.length;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / Math.max(1, n);
  const gap = chart.type === 'histogram' ? 1 : Math.min(24, bw * 0.25);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {ticks.map((tk) => {
        const y = pad.t + ih - (tk / max) * ih;
        return (
          <g key={tk}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="chart-grid" />
            <text x={pad.l - 8} y={y + 4} textAnchor="end" className="chart-text">
              {Number(tk.toFixed(2))}
            </text>
          </g>
        );
      })}
      {chart.values.map((v, i) => {
        const h = (v / max) * ih;
        return (
          <rect key={i} x={pad.l + i * bw + gap / 2} y={pad.t + ih - h} width={Math.max(1, bw - gap)} height={h} rx={chart.type === 'histogram' ? 0 : 3} fill="var(--chart-1)">
            <title>{`${chart.categories[i]}: ${v}`}</title>
          </rect>
        );
      })}
      {chart.categories.map((c, i) =>
        n <= 12 || i % Math.ceil(n / 12) === 0 ? (
          <text key={i} x={pad.l + i * bw + bw / 2} y={H - pad.b + 18} textAnchor="middle" className="chart-text">
            {c.length > 14 ? `${c.slice(0, 13)}…` : c}
          </text>
        ) : null,
      )}
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} className="chart-axis" />
      {chart.xLabel && (
        <text x={pad.l + iw / 2} y={H - 10} textAnchor="middle" className="chart-text chart-label">
          {chart.xLabel}
        </text>
      )}
      {chart.yLabel && (
        <text transform={`translate(14, ${pad.t + ih / 2}) rotate(-90)`} textAnchor="middle" className="chart-text chart-label">
          {chart.yLabel}
        </text>
      )}
    </svg>
  );
}
