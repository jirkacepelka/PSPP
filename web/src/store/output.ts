/*
 * Output document (viewer items).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';
import type { OutputItem } from '../engine/types';

export interface OutputEntry {
  id: string;
  /** Group title (procedure name or "Log"). */
  title: string;
  syntax: string;
  time: number;
  items: OutputItem[];
  /** The dialog and values that produced this result (for Edit / Re-run). */
  source?: { specId: string; values: Record<string, unknown> };
  pinned?: boolean;
  /** Syntax tab the run came from. */
  tabId?: string;
  status?: 'ok' | 'error';
}

interface OutputState {
  entries: OutputEntry[];
  selectedId: string | null;
  add: (entry: OutputEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  select: (id: string | null) => void;
  load: (entries: OutputEntry[]) => void;
  /** Replaces an entry in place (re-run), keeping its position and pin. */
  replace: (id: string, entry: OutputEntry) => void;
  togglePin: (id: string) => void;
  /** Replaces one item (found by id, also inside groups) and optionally renames its entry; keeps positions and pins. */
  replaceItem: (itemId: string, item: OutputItem, entryTitle?: string) => void;
  /** Entries/items removed by the last remove() or clear(), for undo. */
  removed: OutputEntry[] | null;
  undoRemove: () => void;
}

function swapItem(items: OutputItem[], id: string, item: OutputItem): OutputItem[] {
  return items.map((i) => (i.id === id ? item : i.kind === 'group' ? { ...i, children: swapItem(i.children, id, item) } : i));
}

function hasItem(items: OutputItem[], id: string): boolean {
  return items.some((i) => i.id === id || (i.kind === 'group' && hasItem(i.children, id)));
}

function removeItem(items: OutputItem[], id: string): OutputItem[] {
  return items
    .filter((i) => i.id !== id)
    .map((i) => (i.kind === 'group' ? { ...i, children: removeItem(i.children, id) } : i));
}

export const useOutput = create<OutputState>((set, get) => ({
  entries: [],
  selectedId: null,
  removed: null,
  add: (entry) => set({ entries: [...get().entries, entry], selectedId: entry.id }),
  replace: (id, entry) =>
    set({
      entries: get().entries.map((e) => (e.id === id ? { ...entry, pinned: e.pinned } : e)),
      selectedId: entry.id,
    }),
  replaceItem: (itemId, item, entryTitle) =>
    set({
      entries: get().entries.map((e) => (hasItem(e.items, itemId) ? { ...e, ...(entryTitle ? { title: entryTitle } : {}), items: swapItem(e.items, itemId, item) } : e)),
    }),
  togglePin: (id) => set({ entries: get().entries.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e)) }),
  undoRemove: () => {
    const r = get().removed;
    if (r) set({ entries: r, removed: null });
  },
  remove: (id) =>
    set({
      removed: get().entries,
      entries: get()
        .entries.filter((e) => e.id !== id)
        .map((e) => ({ ...e, items: removeItem(e.items, id) })),
    }),
  clear: () => set({ removed: get().entries, entries: [], selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  load: (entries) => set({ entries }),
}));
