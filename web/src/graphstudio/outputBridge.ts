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

/** The chart object stored in the output: the resolved spec plus the definition and the style. */
export function studioChart(spec: Record<string, unknown>, def: GraphDef, style: ChartStyle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...spec, studio: def };
  const s = cleanStyle(style);
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
