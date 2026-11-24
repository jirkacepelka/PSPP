/*
 * Glue between the studio and the output document: build the chart item (spec + definition +
 * style), insert it as a new result, or replace an existing one in place.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { GraphDef, ChartStyle } from '../charts/studioTypes';
import type { OutputItem } from '../engine/types';
import { useOutput, type OutputEntry } from '../store/output';
import { cleanStyle, innerChart } from './series';

type ChartItem = Extract<OutputItem, { kind: 'chart' }>;

let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;

/** Style members that also apply inside every panel (the titles of the whole chart stay outside). */
const PANEL_KEYS: (keyof ChartStyle)[] = ['xTitle', 'yTitle', 'legend', 'legendTitle', 'palette', 'grid', 'xMin', 'xMax', 'yMin', 'yMax', 'valueLabels', 'fontScale'];

/**
 * Copies of the panels of a panels spec with the user's style merged over the shared axes the studio
 * computed, so each panel is a complete styled chart. Reference lines and annotations go to the first
 * panel only for the I-MR control chart, whose second panel has another scale.
 */
function stylePanels(panels: unknown, def: GraphDef, s: ChartStyle): unknown {
  if (!Array.isArray(panels)) return panels;
  const firstOnly = def.kind === 'control' && def.variant === 'imr';
  return panels.map((p, i) => {
    if (!isObj(p) || !isObj(p.chart)) return p;
    const own: Record<string, unknown> = isObj(p.chart.style) ? { ...p.chart.style } : {};
    for (const k of PANEL_KEYS) if (s[k] !== undefined) own[k] = s[k];
    if (!firstOnly || i === 0) {
      if (s.refLines) own.refLines = s.refLines;
      if (s.annotations) own.annotations = s.annotations;
    }
    return { ...p, chart: { ...p.chart, ...(Object.keys(own).length ? { style: own } : {}) } };
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The chart object stored in the output: the resolved spec plus the definition and the style. */
export function studioChart(spec: Record<string, unknown>, def: GraphDef, style: ChartStyle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...spec, studio: def };
  const s = cleanStyle(style);
  if (spec.type === 'panels') out.panels = stylePanels(spec.panels, def, s);
  if (Object.keys(s).length) out.style = s;
  else delete out.style;
  return out;
}

/** Inserts a new result with one chart; returns the ids. */
export function insertStudioChart(chart: Record<string, unknown>, title: string): { entryId: string; itemId: string } {
  const entryId = uid('e');
  const itemId = uid('g');
  const entry: OutputEntry = { id: entryId, title, syntax: '', time: Date.now(), items: [{ id: itemId, kind: 'chart', title, chart }], status: 'ok' };
  useOutput.getState().add(entry);
  return { entryId, itemId };
}

/** Finds a chart item and its entry. */
export function findChartItem(entries: OutputEntry[], entryId: string, itemId: string): { entry: OutputEntry; item: ChartItem } | null {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const walk = (items: OutputItem[]): ChartItem | null => {
    for (const i of items) {
      if (i.kind === 'chart' && i.id === itemId) return i;
      if (i.kind === 'group') {
        const hit = walk(i.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const item = walk(entry.items);
  return item ? { entry, item } : null;
}

/** Replaces the chart of an existing item. A result made only of this studio chart is renamed too. */
export function updateStudioChart(entry: OutputEntry, item: ChartItem, chart: Record<string, unknown>, title: string) {
  const only = entry.items.length === 1 && !entry.source;
  useOutput.getState().replaceItem(item.id, { ...item, title, chart }, only ? title : undefined);
}

/** Applies a style to a chart of the engine (appearance-only editing), keeping everything else. */
export function restyleChart(chart: unknown, style: ChartStyle): unknown {
  const inner = innerChart(chart);
  if (!inner) return chart;
  const s = cleanStyle(style);
  const next: Record<string, unknown> = { ...inner };
  if (Object.keys(s).length) next.style = s;
  else delete next.style;
  return inner === chart ? next : { ...(chart as Record<string, unknown>), chart: next };
}
