/*
 * PSPP Studio – engine contract shared by the UI, the WASM worker and the mock engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export type Measure = 'nominal' | 'ordinal' | 'scale' | 'unknown';
export type Role = 'input' | 'target' | 'both' | 'none' | 'partition' | 'split';
export type Align = 'left' | 'right' | 'center';
/** PSPP format type e.g. 'F','COMMA','DOT','E','DATE','ADATE','DATETIME','TIME','DOLLAR','A',... */
export interface VarFormat {
  type: string;
  w: number;
  d: number;
}
export interface Variable {
  name: string;
  label: string;
  type: 'numeric' | 'string';
  /** string width in bytes, 0 for numeric */
  width: number;
  print: VarFormat;
  write: VarFormat;
  valueLabels: { value: number | string; label: string }[];
  /** discrete up to 3, or range + 1 discrete */
  missing: { values: (number | string)[]; range?: { low: number; high: number } };
  columns: number;
  align: Align;
  measure: Measure;
  role: Role;
}
/** null = system-missing (numeric) */
export type Cell = number | string | null;
export interface Dataset {
  name: string;
  variables: Variable[];
  /** column-major, columns[varIndex][caseIndex] */
  columns: Cell[][];
  weight?: string | null;
  filter?: string | null;
  split?: string[];
  documents?: string[];
  fileLabel?: string;
}
export type OutputItem =
  | { id: string; kind: 'group'; title: string; command?: string; children: OutputItem[] }
  | { id: string; kind: 'table'; title: string; html: string; command?: string }
  | { id: string; kind: 'text'; subtype: 'title' | 'subtitle' | 'log' | 'syntax' | 'page-title'; text: string }
  | { id: string; kind: 'message'; severity: 'error' | 'warning' | 'note'; text: string; line?: number; file?: string }
  | { id: string; kind: 'chart'; title: string; chart: unknown }
  | { id: string; kind: 'image'; title: string; src: string };
/** dataset null = unchanged */
export interface RunResult {
  items: OutputItem[];
  dataset: Dataset | null;
  ok: boolean;
}
export interface EngineApi {
  init(): Promise<{ version: string }>;
  open(file: { name: string; bytes: Uint8Array }): Promise<{ dataset?: Dataset; syntax?: string; items?: OutputItem[] }>;
  save(dataset: Dataset, format: 'sav' | 'zsav' | 'por' | 'csv'): Promise<Uint8Array>;
  run(syntax: string, dataset: Dataset | null): Promise<RunResult>;
}
