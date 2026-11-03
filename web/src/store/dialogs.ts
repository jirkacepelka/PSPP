/*
 * Dialog memory: the last values used in each analysis dialog, per dataset, so reopening a
 * dialog (or "Recall dialog") restores the previous selection like SPSS's dialog recall.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';

export type DialogValues = Record<string, unknown>;

interface DialogMemoryState {
  /** dataset title → specId → values */
  lastValues: Record<string, Record<string, DialogValues>>;
  /** Most recently run dialogs, newest first (for "Recall dialog"). */
  recent: string[];
  remember: (dataset: string, specId: string, values: DialogValues) => void;
  get: (dataset: string, specId: string) => DialogValues | undefined;
  load: (s: Pick<DialogMemoryState, 'lastValues' | 'recent'>) => void;
}

export const useDialogMemory = create<DialogMemoryState>((set, get) => ({
  lastValues: {},
  recent: [],
  remember: (dataset, specId, values) =>
    set({
      lastValues: { ...get().lastValues, [dataset]: { ...(get().lastValues[dataset] ?? {}), [specId]: values } },
      recent: [specId, ...get().recent.filter((x) => x !== specId)].slice(0, 12),
    }),
  get: (dataset, specId) => get().lastValues[dataset]?.[specId],
  load: (s) => set({ lastValues: s.lastValues ?? {}, recent: s.recent ?? [] }),
}));
