/*
 * Declarative analysis dialog framework – spec types.
 *
 * A dialog spec describes the fields of a PSPP/SPSS-style dialog (a source variable list,
 * target lists, options and sub-dialogs) and a pure `toSyntax(values)` function that turns
 * the collected values into PSPP syntax. The generic renderer (DialogRenderer.tsx) draws any spec.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Measure, Variable } from '../../engine/types';

export type VarFilter = 'any' | 'numeric' | 'string';

export type Values = Record<string, unknown>;

export interface DialogContext {
  variables: Variable[];
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

export type Field = VarListField | CheckboxField | RadioField | SelectField | NumberField | TextField | RowsField | GroupField | SubDialogField | InfoField;

export interface DialogSpec {
  id: string;
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
    }
  });
  return v;
}

/** Validates required variable lists (min) – generic part of validation. */
export function validateGeneric(spec: DialogSpec, values: Values): string | null {
  let err: string | null = null;
  walkFields(spec.fields, (f) => {
    if (err) return;
    if (f.when && !f.when(values)) return;
    if (f.kind === 'varlist' && (f.min ?? 0) > 0) {
      const list = (values[f.id] as string[]) ?? [];
      if (list.length < (f.min ?? 0)) err = 'dialogs.errors.needVariables';
    }
  });
  return err;
}
