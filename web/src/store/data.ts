/*
 * Active dataset with undo/redo history.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';
import type { Cell, Dataset, Variable } from '../engine/types';
import { caseCount, changeVariableType, makeVariable, nextVarName } from '../lib/variables';

const MAX_HISTORY = 100;

export interface CellEdit {
  row: number;
  col: number;
  value: Cell;
}

interface DataState {
  dataset: Dataset | null;
  title: string;
  fileName: string | null;
  dirty: boolean;
  revision: number;
  past: Dataset[];
  future: Dataset[];
  /** Replace the dataset (e.g. file open). Clears history unless keepHistory. */
  load: (ds: Dataset | null, opts?: { title?: string; fileName?: string | null; keepHistory?: boolean; dirty?: boolean }) => void;
  /** Apply a modification to the dataset as one undoable step. */
  apply: (fn: (ds: Dataset) => Dataset) => void;
  setTitle: (t: string) => void;
  markSaved: (fileName?: string | null) => void;
  setCells: (edits: CellEdit[]) => void;
  insertCases: (at: number, count?: number) => void;
  deleteCases: (rows: number[]) => void;
  insertVariable: (at: number, init?: Partial<Variable>) => string;
  deleteVariables: (cols: number[]) => void;
  updateVariable: (index: number, patch: Partial<Variable>) => void;
  setVariableType: (index: number, type: 'numeric' | 'string', fmt: Variable['print']) => void;
  moveVariable: (from: number, to: number) => void;
  sortBy: (col: number, dir: 1 | -1) => void;
  undo: () => void;
  redo: () => void;
}

function blankFor(v: Variable): Cell {
  return v.type === 'string' ? '' : null;
}

/** Ensures all columns have length n. */
function normalize(ds: Dataset, n = caseCount(ds)): Dataset {
  let changed = false;
  const columns = ds.columns.map((c, i) => {
    if (c.length === n) return c;
    changed = true;
    const out = c.slice(0, n);
    while (out.length < n) out.push(blankFor(ds.variables[i]));
    return out;
  });
  return changed ? { ...ds, columns } : ds;
}

export const useData = create<DataState>((set, get) => {
  const commit = (next: Dataset) => {
    const { dataset, past } = get();
    if (!dataset || next === dataset) return;
    set({
      dataset: next,
      past: [...past.slice(-MAX_HISTORY + 1), dataset],
      future: [],
      dirty: true,
      revision: get().revision + 1,
    });
  };
  return {
    dataset: null,
    title: '',
    fileName: null,
    dirty: false,
    revision: 0,
    past: [],
    future: [],
    load: (ds, opts = {}) => {
      const prev = get().dataset;
      set({
        dataset: ds ? normalize(ds) : null,
        title: opts.title ?? ds?.name ?? get().title,
        fileName: opts.fileName === undefined ? get().fileName : opts.fileName,
        past: opts.keepHistory && prev ? [...get().past.slice(-MAX_HISTORY + 1), prev] : [],
        future: [],
        dirty: opts.dirty ?? false,
        revision: get().revision + 1,
      });
    },
    apply: (fn) => {
      const ds = get().dataset;
      if (!ds) return;
      commit(normalize(fn(ds)));
    },
    setTitle: (t) => {
      const ds = get().dataset;
      set({ title: t, dirty: true, dataset: ds ? { ...ds, name: t } : ds });
    },
    markSaved: (fileName) => set({ dirty: false, ...(fileName !== undefined ? { fileName } : {}) }),
    setCells: (edits) => {
      const ds = get().dataset;
      if (!ds || !edits.length) return;
      const variables = ds.variables.slice();
      const columns = ds.columns.slice();
      const maxCol = Math.max(...edits.map((e) => e.col));
      // create variables for edits beyond the last column (typing into empty columns)
      for (let c = variables.length; c <= maxCol; c++) {
        const sample = edits.find((e) => e.col === c && e.value !== null && e.value !== '');
        const isString = typeof sample?.value === 'string';
        const v = makeVariable(nextVarName(variables.map((x) => x.name)), isString ? { type: 'string', width: 8 } : {});
        variables.push(v);
        columns.push([]);
      }
      const copied = new Set<number>();
      let n = caseCount(ds);
      for (const e of edits) {
        if (!copied.has(e.col)) {
          columns[e.col] = columns[e.col].slice();
          copied.add(e.col);
        }
        const col = columns[e.col];
        const v = variables[e.col];
        while (col.length <= e.row) col.push(blankFor(v));
        let value = e.value;
        if (v.type === 'string' && typeof value === 'number') value = String(value);
        if (v.type === 'string' && value === null) value = '';
        if (v.type === 'numeric' && typeof value === 'string') {
          const num = Number(value);
          value = value.trim() === '' || !Number.isFinite(num) ? null : num;
        }
        col[e.row] = value;
        n = Math.max(n, e.row + 1);
      }
      commit(normalize({ ...ds, variables, columns }, n));
    },
    insertCases: (at, count = 1) =>
      get().apply((ds) => ({
        ...ds,
        columns: ds.columns.map((c, i) => {
          const out = c.slice();
          while (out.length < at) out.push(blankFor(ds.variables[i]));
          out.splice(at, 0, ...new Array(count).fill(blankFor(ds.variables[i])));
          return out;
        }),
      })),
    deleteCases: (rows) => {
      const del = new Set(rows);
      get().apply((ds) => ({ ...ds, columns: ds.columns.map((c) => c.filter((_, r) => !del.has(r))) }));
    },
    insertVariable: (at, init = {}) => {
      const ds = get().dataset;
      if (!ds) return '';
      const name = init.name ?? nextVarName(ds.variables.map((v) => v.name));
      const v = makeVariable(name, init);
      get().apply((d) => {
        const variables = d.variables.slice();
        const columns = d.columns.slice();
        const pos = Math.min(at, variables.length);
        variables.splice(pos, 0, v);
        columns.splice(pos, 0, new Array(caseCount(d)).fill(blankFor(v)));
        return { ...d, variables, columns };
      });
      return name;
    },
    deleteVariables: (cols) => {
      const del = new Set(cols);
      get().apply((ds) => {
        const removed = ds.variables.filter((_, i) => del.has(i)).map((v) => v.name);
        return {
          ...ds,
          variables: ds.variables.filter((_, i) => !del.has(i)),
          columns: ds.columns.filter((_, i) => !del.has(i)),
          weight: ds.weight && removed.includes(ds.weight) ? null : ds.weight,
          filter: ds.filter && removed.includes(ds.filter) ? null : ds.filter,
          split: (ds.split ?? []).filter((s) => !removed.includes(s)),
        };
      });
    },
    updateVariable: (index, patch) =>
      get().apply((ds) => {
        const variables = ds.variables.slice();
        const old = variables[index];
        if (!old) return ds;
        variables[index] = { ...old, ...patch };
        let { weight, filter, split } = ds;
        if (patch.name && patch.name !== old.name) {
          if (weight === old.name) weight = patch.name;
          if (filter === old.name) filter = patch.name;
          split = (split ?? []).map((s) => (s === old.name ? patch.name! : s));
        }
        return { ...ds, variables, weight, filter, split };
      }),
    setVariableType: (index, type, fmt) =>
      get().apply((ds) => {
        const variables = ds.variables.slice();
        const columns = ds.columns.slice();
        const r = changeVariableType(variables[index], columns[index], type, fmt);
        variables[index] = r.variable;
        columns[index] = r.column;
        return { ...ds, variables, columns };
      }),
    moveVariable: (from, to) =>
      get().apply((ds) => {
        const variables = ds.variables.slice();
        const columns = ds.columns.slice();
        const [v] = variables.splice(from, 1);
        const [c] = columns.splice(from, 1);
        variables.splice(to, 0, v);
        columns.splice(to, 0, c);
        return { ...ds, variables, columns };
      }),
    sortBy: (col, dir) =>
      get().apply((ds) => {
        const key = ds.columns[col];
        const n = caseCount(ds);
        const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
          const x = key[a] ?? null;
          const y = key[b] ?? null;
          if (x === y) return a - b;
          if (x === null || x === '') return -dir;
          if (y === null || y === '') return dir;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return c * dir || a - b;
        });
        return { ...ds, columns: ds.columns.map((c) => order.map((r) => c[r] ?? null)) };
      }),
    undo: () => {
      const { past, dataset, future } = get();
      if (!past.length || !dataset) return;
      set({ dataset: past[past.length - 1], past: past.slice(0, -1), future: [dataset, ...future], dirty: true, revision: get().revision + 1 });
    },
    redo: () => {
      const { past, dataset, future } = get();
      if (!future.length || !dataset) return;
      set({ dataset: future[0], future: future.slice(1), past: [...past, dataset], dirty: true, revision: get().revision + 1 });
    },
  };
});
