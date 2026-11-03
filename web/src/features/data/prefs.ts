/*
 * Per-user Data View preferences that have no place in the global settings store
 * (kept in localStorage; failures are ignored).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';

interface DataPrefs {
  /** Mark suspicious values (F4): unlabelled codes, out of range, stray whitespace. */
  highlightFlags: boolean;
  /** Variable label as a second line in column headers (DV-3). */
  headerLabels: boolean;
  set: (p: Partial<Omit<DataPrefs, 'set'>>) => void;
}

const KEY = 'pspp.dataPrefs.v1';

function load(): Partial<DataPrefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DataPrefs>;
  } catch {
    return {};
  }
}

export const useDataPrefs = create<DataPrefs>((set, get) => ({
  highlightFlags: true,
  headerLabels: true,
  ...load(),
  set: (p) => {
    set(p);
    try {
      const { highlightFlags, headerLabels } = get();
      localStorage.setItem(KEY, JSON.stringify({ highlightFlags, headerLabels }));
    } catch {
      /* ignore */
    }
  },
}));
