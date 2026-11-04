/* Dendrogram of a hierarchical cluster analysis (CLUSTER /PLOT=DENDROGRAM), drawn like SPSS:
   a horizontal tree with the cases down the left (label and case number) and the "rescaled
   distance cluster combine" axis (0–25) on top.

   Spec (chart JSON written by src/ext/commands/cluster.ts):
     { type: 'dendrogram', title, xlabel,
       leaves: [{ label, number }]            cases in file order (label may be '')
       merges: [{ a, b, h, coef }]            agglomeration stages: clusters a < b (1-based
                                              case numbers), rescaled distance h, coefficient
       strings: { stage, cluster1, cluster2, coefficient, distance, case } }  table/tooltip labels */

import { useMemo } from 'react';
import { ChartShell, FONT, markTip, type ChartCommonProps } from './shell';
import { formatValue, measureText, truncateText } from './scale';
import { tr } from './strings';

export interface DendrogramSpec {
  type: 'dendrogram';
  title: string;
  xlabel: string;
  leaves: { label: string; number: number }[];
  merges: { a: number; b: number; h: number; coef: number | null }[];
  strings: { stage: string; cluster1: string; cluster2: string; coefficient: string; distance: string; case: string };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Defensive parse of the chart JSON (TITLE already cleaned by parseChart). */
export function parseDendrogram(c: Obj, title: string): DendrogramSpec {
  const leaves = arr(c.leaves)
    .filter(isObj)
    .map((l, i) => ({ label: str(l.label).trim(), number: num(l.number) ?? i + 1 }));
  const n = leaves.length;
  const ok = (x: number | null): x is number => x !== null && Number.isInteger(x) && x >= 1 && x <= n;
  const merges = arr(c.merges)
    .filter(isObj)
    .flatMap((m) => {
      const a = num(m.a);
      const b = num(m.b);
      const h = num(m.h);
      return ok(a) && ok(b) && a !== b && h !== null ? [{ a: Math.min(a, b), b: Math.max(a, b), h, coef: num(m.coef) }] : [];
    });
  const s = isObj(c.strings) ? c.strings : {};
  return {
    type: 'dendrogram',
    title,
    xlabel: str(c.xlabel, 'Rescaled Distance Cluster Combine'),
    leaves,
    merges,
    strings: {
      stage: str(s.stage, 'Stage'),
      cluster1: str(s.cluster1, 'Cluster 1'),
      cluster2: str(s.cluster2, 'Cluster 2'),
      coefficient: str(s.coefficient, 'Coefficients'),
      distance: str(s.distance, 'Rescaled Distance Cluster Combine'),
      case: str(s.case, 'Case'),
    },
  };
}

type Node = { leaf: number } | { l: Node; r: Node };

/** Leaf order without crossings: depth-first, cluster 1 (lower case number) above cluster 2. */
export function leafOrder(n: number, merges: DendrogramSpec['merges']): number[] {
  const tree = new Map<number, Node>();
  for (let i = 1; i <= n; i++) tree.set(i, { leaf: i });
  for (const m of merges) {
    const l = tree.get(m.a);
    const r = tree.get(m.b);
    if (!l || !r) continue;
    tree.set(m.a, { l, r });
    tree.delete(m.b);
  }
  const out: number[] = [];
  const walk = (x: Node) => {
    const stack: Node[] = [x];
    while (stack.length) {
      const t = stack.pop()!;
      if ('leaf' in t) out.push(t.leaf);
      else stack.push(t.r, t.l);
    }
  };
  [...tree.keys()].sort((a, b) => a - b).forEach((k) => walk(tree.get(k)!));
  return out;
}

const MAX_H = 25;
const AXIS_H = 40;

export function DendrogramChart({ spec, ...c }: { spec: DendrogramSpec } & ChartCommonProps) {
  const { t, locale } = c;
  const n = spec.leaves.length;
  const rowH = n > 300 ? 5 : n > 150 ? 8 : n > 60 ? 12 : 18;
  const order = useMemo(() => leafOrder(n, spec.merges), [n, spec.merges]);
  const title = spec.title || tr(t, 'untitled');
  const S = spec.strings;
  const hasLabels = spec.leaves.some((l) => l.label);
  const fontSize = Math.min(FONT.label, rowH - 2);

  return (
    <ChartShell
      {...c}
      title={title}
      ariaLabel={`${title}. ${tr(t, 'ariaValues', { count: n })}.`}
      plotHeight={() => AXIS_H + Math.max(1, n) * rowH + 6}
      table={{
        columns: [S.stage, S.cluster1, S.cluster2, S.coefficient, S.distance],
        rows: spec.merges.map((m, i) => [String(i + 1), String(m.a), String(m.b), formatValue(m.coef, locale, 3), formatValue(m.h, locale, 3)]),
        numeric: [true, true, true, true, true],
      }}
    >
      {(area) => {
        if (!n) {
          return (
            <text className="pspp-chart__tick" x={area.width / 2} y={40} textAnchor="middle">
              {tr(t, 'noData')}
            </text>
          );
        }
        const showText = rowH >= 8;
        const numW = showText ? measureText(String(Math.max(...spec.leaves.map((l) => l.number))), fontSize) : 0;
        const maxLabelW = Math.min(area.width * 0.3, 180);
        const labels = spec.leaves.map((l) => (showText && hasLabels ? truncateText(l.label, maxLabelW, fontSize) : ''));
        const labelW = hasLabels && showText ? Math.max(...labels.map((l) => measureText(l, fontSize))) : 0;
        const treeLeft = Math.ceil(labelW + (labelW ? 10 : 0) + numW + 10);
        const treeW = Math.max(60, area.width - treeLeft - 14);
        const sx = (h: number) => treeLeft + (Math.max(0, Math.min(MAX_H, h)) / MAX_H) * treeW;
        const rowOf = new Map<number, number>();
        order.forEach((leaf, i) => rowOf.set(leaf, i));
        const y0 = AXIS_H;
        const yOf = (row: number) => y0 + row * rowH + rowH / 2;

        // node positions per current cluster label
        const pos = new Map<number, { x: number; y: number }>();
        for (let i = 1; i <= n; i++) pos.set(i, { x: sx(0), y: yOf(rowOf.get(i) ?? i - 1) });
        const segs: string[] = [];
        const hits: { x: number; y1: number; y2: number; i: number }[] = [];
        spec.merges.forEach((m, i) => {
          const pa = pos.get(m.a);
          const pb = pos.get(m.b);
          if (!pa || !pb) return;
          const x = sx(m.h);
          segs.push(`M${pa.x},${pa.y}H${x}M${pb.x},${pb.y}H${x}M${x},${pa.y}V${pb.y}`);
          hits.push({ x, y1: Math.min(pa.y, pb.y), y2: Math.max(pa.y, pb.y), i });
          pos.set(m.a, { x, y: (pa.y + pb.y) / 2 });
          pos.delete(m.b);
        });
        const ticks = [0, 5, 10, 15, 20, 25];
        const bottom = y0 + n * rowH;
        return (
          <g>
            <text className="pspp-chart__axis-title" x={treeLeft + treeW / 2} y={10} textAnchor="middle" dominantBaseline="central">
              {spec.xlabel}
            </text>
            <g className="pspp-chart__axis" aria-hidden="true">
              {ticks.map((v) => (
                <g key={v}>
                  <line className="pspp-chart__grid" x1={Math.round(sx(v)) + 0.5} x2={Math.round(sx(v)) + 0.5} y1={y0 - 4} y2={bottom} />
                  <text className="pspp-chart__tick" x={sx(v)} y={y0 - 12} textAnchor="middle">
                    {formatValue(v, locale)}
                  </text>
                </g>
              ))}
            </g>
            {showText && (
              <g aria-hidden="true">
                {order.map((leaf, row) => {
                  const l = spec.leaves[leaf - 1];
                  const y = yOf(row);
                  return (
                    <g key={leaf}>
                      {labelW > 0 && (
                        <text className="pspp-chart__tick pspp-chart__tick--cat" x={0} y={y} dominantBaseline="central" style={{ fontSize }}>
                          {labels[leaf - 1]}
                        </text>
                      )}
                      <text className="pspp-chart__tick" x={treeLeft - 8} y={y} textAnchor="end" dominantBaseline="central" style={{ fontSize }}>
                        {l.number}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
            <path d={segs.join('')} fill="none" style={{ stroke: 'var(--c-series-1)', strokeWidth: n > 150 ? 1 : 1.5, strokeLinejoin: 'miter', fill: 'none' }} />
            <g data-export="omit">
              {hits.map((hh) => {
                const m = spec.merges[hh.i];
                const content = {
                  title: `${S.stage} ${hh.i + 1}`,
                  rows: [
                    { label: S.cluster1, value: String(m.a) + (spec.leaves[m.a - 1]?.label ? ` (${spec.leaves[m.a - 1].label})` : '') },
                    { label: S.cluster2, value: String(m.b) + (spec.leaves[m.b - 1]?.label ? ` (${spec.leaves[m.b - 1].label})` : '') },
                    { label: S.coefficient, value: formatValue(m.coef, locale, 3) },
                    { label: S.distance, value: formatValue(m.h, locale, 2) },
                  ],
                };
                return (
                  <rect
                    key={hh.i}
                    className="pspp-chart__hit"
                    x={hh.x - 5}
                    y={hh.y1 - 2}
                    width={10}
                    height={Math.max(4, hh.y2 - hh.y1 + 4)}
                    style={{ fill: 'transparent', cursor: 'default' }}
                    {...markTip(area.tip, content)}
                  />
                );
              })}
            </g>
          </g>
        );
      }}
    </ChartShell>
  );
}
