/*
 * Shell-local layout state: journal panel, split-view ratio, Alt-mnemonic hinting and the
 * contextual command-bar slots that other feature areas can fill.
 *
 * Command-bar slot API (for WP2/WP3):
 *   useCommandBarSlot('syntax', <MyButtons/>)                 // appended after the defaults
 *   useCommandBarSlot('output', <MyButtons/>, { replace: true }) // replaces the shell defaults
 * The node is shown in the command bar while the calling component is mounted.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import type { View } from '../../store/ui';

const LS = 'pspp.shell.layout';

function read(): { journalOpen: boolean; splitRatio: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? '{}');
    return { journalOpen: !!v.journalOpen, splitRatio: typeof v.splitRatio === 'number' ? Math.min(0.8, Math.max(0.2, v.splitRatio)) : 0.5 };
  } catch {
    return { journalOpen: false, splitRatio: 0.5 };
  }
}

export interface Slot {
  node: ReactNode;
  replace: boolean;
}

interface LayoutState {
  journalOpen: boolean;
  splitRatio: number;
  /** Alt is held: menu-bar mnemonics are underlined. */
  altHeld: boolean;
  slots: Partial<Record<View, Slot>>;
  /** Initial query of the next palette opening ('@' = variables). */
  paletteSeed: string;
  setPaletteSeed: (s: string) => void;
  setJournal: (b: boolean) => void;
  setSplitRatio: (r: number) => void;
  setAltHeld: (b: boolean) => void;
  setSlot: (v: View, s: Slot | null) => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  ...read(),
  altHeld: false,
  slots: {},
  paletteSeed: '',
  setPaletteSeed: (paletteSeed) => set({ paletteSeed }),
  setJournal: (journalOpen) => {
    set({ journalOpen });
    save(get());
  },
  setSplitRatio: (r) => {
    set({ splitRatio: Math.min(0.8, Math.max(0.2, r)) });
    save(get());
  },
  setAltHeld: (altHeld) => get().altHeld !== altHeld && set({ altHeld }),
  setSlot: (v, s) => {
    const slots = { ...get().slots };
    if (s) slots[v] = s;
    else delete slots[v];
    set({ slots });
  },
}));

function save(s: LayoutState) {
  try {
    localStorage.setItem(LS, JSON.stringify({ journalOpen: s.journalOpen, splitRatio: s.splitRatio }));
  } catch {
    /* storage blocked */
  }
}

/** Puts NODE into the command bar of VIEW while the caller is mounted. */
export function useCommandBarSlot(view: View, node: ReactNode, opts: { replace?: boolean } = {}) {
  const replace = !!opts.replace;
  useEffect(() => {
    useLayout.getState().setSlot(view, { node, replace });
  }, [view, node, replace]);
  useEffect(() => () => useLayout.getState().setSlot(view, null), [view]);
}

/** Split view is offered only on wide screens. */
export const SPLIT_MIN_WIDTH = 1280;
