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
}

interface OutputState {
  entries: OutputEntry[];
  selectedId: string | null;
  add: (entry: OutputEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  select: (id: string | null) => void;
  load: (entries: OutputEntry[]) => void;
}

function removeItem(items: OutputItem[], id: string): OutputItem[] {
  return items
    .filter((i) => i.id !== id)
    .map((i) => (i.kind === 'group' ? { ...i, children: removeItem(i.children, id) } : i));
}

export const useOutput = create<OutputState>((set, get) => ({
  entries: [],
  selectedId: null,
  add: (entry) => set({ entries: [...get().entries, entry], selectedId: entry.id }),
  remove: (id) =>
    set({
      entries: get()
        .entries.filter((e) => e.id !== id)
        .map((e) => ({ ...e, items: removeItem(e.items, id) })),
    }),
  clear: () => set({ entries: [], selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  load: (entries) => set({ entries }),
}));
