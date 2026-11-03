/*
 * Bridge between global actions (menus, toolbar) and the active grid component, plus the
 * "active variable" shared by the Data View, the Variable View and the variable inspector.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';

export interface GridCommands {
  copy(): void;
  cut(): void;
  paste(): void;
  clear(): void;
  insertCase(): void;
  insertVariable(): void;
  deleteCases(): void;
  deleteVariables(): void;
  gotoCase(row: number, col?: number): void;
  /** Scroll to and select variable INDEX (column in Data View, row in Variable View). */
  gotoVariable(index: number): void;
  focus(): void;
}

const noop = () => {};
const empty: GridCommands = { copy: noop, cut: noop, paste: noop, clear: noop, insertCase: noop, insertVariable: noop, deleteCases: noop, deleteVariables: noop, gotoCase: noop, gotoVariable: noop, focus: noop };

let current: GridCommands = empty;

export const gridCommands: GridCommands = {
  copy: () => current.copy(),
  cut: () => current.cut(),
  paste: () => current.paste(),
  clear: () => current.clear(),
  insertCase: () => current.insertCase(),
  insertVariable: () => current.insertVariable(),
  deleteCases: () => current.deleteCases(),
  deleteVariables: () => current.deleteVariables(),
  gotoCase: (r, c) => current.gotoCase(r, c),
  gotoVariable: (i) => {
    useActiveVariable.getState().setActive(i);
    current.gotoVariable(i);
  },
  focus: () => current.focus(),
};

export function registerGrid(cmds: GridCommands): () => void {
  current = cmds;
  return () => {
    if (current === cmds) current = empty;
  };
}

interface ActiveVariableState {
  /** index of the variable the user is working with (selected column / row), or null */
  index: number | null;
  /** all selected variable indices (multi-selection), sorted; includes `index` */
  selection: number[];
  setActive: (index: number | null, selection?: number[]) => void;
}

/** The variable the inspector follows. Set by the Data View (column) and Variable View (row). */
export const useActiveVariable = create<ActiveVariableState>((set, get) => ({
  index: null,
  selection: [],
  setActive: (index, selection) => {
    const sel = selection ?? (index === null ? [] : [index]);
    const cur = get();
    if (cur.index === index && cur.selection.length === sel.length && cur.selection.every((x, i) => x === sel[i])) return;
    set({ index, selection: sel });
  },
}));
