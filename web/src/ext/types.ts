/*
 * Extension analyses: procedures PSPP lacks, computed in the browser and spliced into a run
 * in place of the command (same OutputItem format as the engine, so output view, APA copy,
 * interpretation and the journal work unchanged). Commands use SPSS syntax, so SPSS scripts run.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem } from '../engine/types';
import type { ParsedCommand } from './parse';

export interface ExtContext {
  /** the active dataset as left by the PSPP commands before this one */
  dataset: Dataset;
  /** 1-based line of the command in the submitted syntax (for messages) */
  line: number;
  /** UI/output language and decimal separator (output follows SET DECIMAL like PSPP's) */
  lang: 'cs' | 'en';
  decimal: '.' | ',';
  /** i18n lookup for output strings, keys under `ext.` */
  t: (key: string, args?: Record<string, unknown>) => string;
}

export interface ExtCommand {
  /** canonical SPSS command name, e.g. 'NONPAR CORR' */
  name: string;
  run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[];
}

/** Thrown for syntax or data errors; becomes an error message item at the command's line. */
export class ExtError extends Error {}
