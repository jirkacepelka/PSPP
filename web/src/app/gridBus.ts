/*
 * Bridge between global actions (menus, toolbar) and the active grid component.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
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
  focus(): void;
}

const noop = () => {};
const empty: GridCommands = { copy: noop, cut: noop, paste: noop, clear: noop, insertCase: noop, insertVariable: noop, deleteCases: noop, deleteVariables: noop, gotoCase: noop, focus: noop };

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
  focus: () => current.focus(),
};

export function registerGrid(cmds: GridCommands): () => void {
  current = cmds;
  return () => {
    if (current === cmds) current = empty;
  };
}
