/*
 * Declarative analysis dialog framework – spec types.
 *
 * A dialog spec describes the fields of a PSPP/SPSS-style dialog (a source variable list,
 * target lists, options and sub-dialogs) and a pure `toSyntax(values)` function that turns
 * the collected values into PSPP syntax. The generic renderer (DialogRenderer.tsx) draws any spec.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Measure, Variable } from '../../engine/types';

export type VarFilter = 'any' | 'numeric' | 'string';

export type Values = Record<string, unknown>;

export interface DialogContext {
  variables: Variable[];
  /** Values of a variable in the active dataset (for distinct counts and group pickers). */
  column?: (name: string) => Cell[] | undefined;
}

/** A soft, inline note in a dialog (data-aware warnings and suggestions, DLG-2). */
export interface Hint {
  level: 'info' | 'warn';
  /** i18n key */
  text: string;
  args?: Record<string, string | number>;
  /** field the hint is about (shown next to it) */
  field?: string;
  /** one-click fix: a patch of dialog values, or a measurement-level change of a variable */
  action?: { label: string; args?: Record<string, string | number>; patch?: Values; setMeasure?: { variable: string; measure: Measure } };
}

interface FieldBase {
  /** i18n key for the label */
  label?: string;
  /** i18n key for a hint below the field */
  hint?: string;
  /** show the field only when the predicate is true */
  when?: (values: Values) => boolean;
}

/** Target variable list (variables moved from the source list). Value: string[] */
export interface VarListField extends FieldBase {
  kind: 'varlist';
  id: string;
  label: string;
  filter?: VarFilter;
  measures?: Measure[];
  min?: number;
  /** max number of variables (1 = single variable slot) */
  max?: number;
  /** i18n key for an icon-less placeholder */
  placeholder?: string;
  /** Suitable measurement levels: sorted first in the source list, others get a soft warning (not a filter). */
  prefer?: Measure[];
  /** Show the number of distinct values (group count) next to variables while this list is active. */
  groups?: boolean;
}

/**
 * Two (or more) values of a grouping variable, picked from its value labels and observed values
 * (T-test / Mann-Whitney groups, Kruskal-Wallis range). Value: stored in the fields named by IDS.
 */
export interface GroupValuesField extends FieldBase {
  kind: 'groupvalues';
  /** varlist field holding the grouping variable */
  source: string;
  /** value field ids, e.g. ['g1', 'g2'] */
  ids: string[];
  /** i18n keys for the individual pickers */
  labels: string[];
  /** 'pair' preselects the two most frequent values; 'range' the minimum and maximum */
  mode?: 'pair' | 'range';
}

export interface CheckboxField extends FieldBase {
  kind: 'checkbox';
  id: string;
  label: string;
  default?: boolean;
}

export interface RadioField extends FieldBase {
  kind: 'radio';
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  inline?: boolean;
}

export interface SelectField extends FieldBase {
  kind: 'select';
  id: string;
  label: string;
  options: { value: string; label: string; raw?: boolean }[];
  default: string;
}

export interface NumberField extends FieldBase {
  kind: 'number';
  id: string;
  label: string;
  default?: number | null;
  min?: number;
  max?: number;
  step?: number;
}

export interface TextField extends FieldBase {
  kind: 'text';
  id: string;
  label: string;
  default?: string;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  /** offer a variable picker / function insert toolbar (for expressions) */
  expression?: boolean;
}

export interface RowsColumn {
  id: string;
  label: string;
  type: 'text' | 'number' | 'variable' | 'select';
  options?: { value: string; label: string; raw?: boolean }[];
  filter?: VarFilter;
  placeholder?: string;
  width?: string;
}

/** Editable table of rows (e.g. recode old→new values, aggregate functions, pairs). Value: Record<string,string>[] */
export interface RowsField extends FieldBase {
  kind: 'rows';
  id: string;
  label: string;
  columns: RowsColumn[];
  minRows?: number;
  default?: Record<string, string>[];
}

export interface GroupField extends FieldBase {
  kind: 'group';
  label?: string;
  fields: Field[];
  columns?: 1 | 2 | 3;
}

/** Button opening a nested dialog with more fields (Statistics…, Options…, Charts…). */
export interface SubDialogField extends FieldBase {
  kind: 'subdialog';
  id: string;
  label: string;
  icon?: string;
  fields: Field[];
}

export interface InfoField extends FieldBase {
  kind: 'info';
  label: string;
}

export type Field = VarListField | GroupValuesField | CheckboxField | RadioField | SelectField | NumberField | TextField | RowsField | GroupField | SubDialogField | InfoField;

export interface DialogSpec {
  id: string;
  /** analysis (button "Spustit"), transform or data (button "Použít"; transforms roll back on error) */
  kind?: 'analysis' | 'transform' | 'data' | 'graph';
  /** i18n key */
  title: string;
  icon?: string;
  /** PSPP command name, used for Help links */
  command: string;
  /** source variable list filter (types shown in the left list) */
  source?: VarFilter;
  fields: Field[];
  /** returns an i18n key (or null when valid) */
  validate?: (values: Values, ctx: DialogContext) => string | null;
  toSyntax: (values: Values, ctx: DialogContext) => string;
  /** dialog width */
  size?: 'normal' | 'wide' | 'xwide';
  /** data-aware inline notes (soft validation, smart defaults) */
  hints?: (values: Values, ctx: DialogContext) => Hint[];
  /** validation error key → field id to focus and mark invalid */
  errorFields?: Record<string, string>;
}

/** Walk all fields (including nested groups/sub-dialogs). */
export function walkFields(fields: Field[], fn: (f: Field) => void) {
  for (const f of fields) {
    fn(f);
    if (f.kind === 'group' || f.kind === 'subdialog') walkFields(f.fields, fn);
  }
}

/** Default values for a spec. */
export function defaultValues(spec: DialogSpec): Values {
  const v: Values = {};
  walkFields(spec.fields, (f) => {
    switch (f.kind) {
      case 'varlist': v[f.id] = []; break;
      case 'checkbox': v[f.id] = f.default ?? false; break;
      case 'radio': case 'select': v[f.id] = f.default; break;
      case 'number': v[f.id] = f.default ?? null; break;
      case 'text': v[f.id] = f.default ?? ''; break;
      case 'rows': v[f.id] = f.default ? f.default.map((r) => ({ ...r })) : []; break;
      case 'groupvalues': for (const id of f.ids) v[id] ??= ''; break;
    }
  });
  return v;
}

/** Validates required variable lists (min) – generic part of validation. */
export function validateGeneric(spec: DialogSpec, values: Values): string | null {
  return validateDetailed(spec, values)?.key ?? null;
}

/** Like validateGeneric, but also names the field at fault. */
export function validateDetailed(spec: DialogSpec, values: Values, ctx?: DialogContext): { key: string; field?: string } | null {
  let err: { key: string; field?: string } | null = null;
  walkFields(spec.fields, (f) => {
    if (err) return;
    if (f.when && !f.when(values)) return;
    if (f.kind === 'varlist' && (f.min ?? 0) > 0) {
      const list = (values[f.id] as string[]) ?? [];
      if (list.length < (f.min ?? 0)) err = { key: (f.min ?? 0) > 1 && list.length > 0 ? 'dlg.errors.moreVariables' : 'dlg.errors.needVariables', field: f.id };
    }
  });
  if (err || !ctx || !spec.validate) return err;
  const key = spec.validate(values, ctx);
  return key ? { key, field: spec.errorFields?.[key] } : null;
}

/** Field labels by id (for error messages that name the field). */
export function fieldLabels(spec: DialogSpec): Record<string, string> {
  const out: Record<string, string> = {};
  walkFields(spec.fields, (f) => {
    if ('id' in f && f.label) out[f.id] = f.label;
  });
  return out;
}
