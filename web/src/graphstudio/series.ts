/*
 * Series of a chart spec (what the palette colours apply to) and helpers to read the chart object
 * of an output item, for the appearance editor of engine charts.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { ChartStyle } from '../charts/studioTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The object carrying `type` (an item's chart may be wrapped as { chart: {...} }). */
export function innerChart(chart: unknown): Obj | null {
  if (!isObj(chart)) return null;
  return isObj(chart.chart) ? chart.chart : chart;
}

/** Names of the colour-bearing series of a chart spec, in palette order. */
export function seriesNames(chart: unknown): string[] {
  const c = innerChart(chart);
  if (!c) return [];
  switch (c.type) {
    case 'bar': {
      const groups = [...new Set(arr(c.bars).filter(isObj).map((b) => b.group).filter((g): g is string => typeof g === 'string'))];
      return groups.length ? groups.map(str) : [str(c.ylabel) || str(c.title)];
    }
    case 'line':
    case 'area':
    case 'survival':
      return arr(c.series).filter(isObj).map((s) => str(s.name));
    case 'pie':
      return arr(c.slices).filter(isObj).map((s) => str(s.label));
    case 'histogram':
      return arr(c.series).length ? arr(c.series).filter(isObj).map((s) => str(s.name)) : [str(c.title)];
    case 'scatter': {
      const groups = [...new Set(arr(c.points).map((p) => arr(p)[2]).filter((g): g is string => typeof g === 'string'))];
      return groups.length ? groups.map(str) : [str(c.ylabel) || str(c.title)];
    }
    case 'roc':
      return arr(c.curves).filter(isObj).map((s) => str(s.name));
    case 'pyramid':
      return [str(c.leftName), str(c.rightName)];
    case 'dot': {
      const groups = [...new Set(arr(c.bins).filter(isObj).map((b) => b.group).filter((g): g is string => typeof g === 'string'))];
      return groups.length ? groups : [str(c.title)];
    }
    case 'matrix':
      return [...new Set(arr(c.groups).filter((g): g is string => typeof g === 'string'))];
    case 'boxplot': {
      const groups = [...new Set(arr(c.boxes).filter(isObj).map((b) => b.group).filter((g): g is string => typeof g === 'string'))];
      return groups.length ? groups.map(str) : [str(c.title)];
    }
    case 'pareto':
    case 'heatmap':
    case 'highlow':
    case 'probplot':
    case 'control':
      return [str(c.title)];
    case 'sequence':
      return arr(c.series).filter(isObj).map((s) => str(s.name));
    case 'dualaxis':
      return [isObj(c.left) ? str(c.left.name) : '', isObj(c.right) ? str(c.right.name) : ''];
    case 'density':
      return arr(c.curves).filter(isObj).map((s) => str(s.name));
    case 'violin':
      return arr(c.violins).filter(isObj).map((s) => str(s.label));
    case 'panels': {
      // the colours of the panels follow the first one
      const first = arr(c.panels).find(isObj);
      return first ? seriesNames(first.chart) : [];
    }
    default:
      return [];
  }
}

/** Chart styles keep only meaningful values: empty strings and nulls are dropped. */
export function cleanStyle(style: ChartStyle): ChartStyle {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (k === 'palette' && Array.isArray(v) && v.every((x) => x === null)) continue;
    if ((k === 'xMin' || k === 'xMax' || k === 'yMin' || k === 'yMax') && v === null) continue;
    if (k === 'fontScale' && v === 1) continue;
    out[k] = v;
  }
  return out as ChartStyle;
}
