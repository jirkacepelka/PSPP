/*
 * Data-aware helpers for analysis dialogs: distinct values of a variable (with value labels and
 * counts), suitability of a variable for a target list, and generic measurement-level hints.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Measure, Variable } from '../../engine/types';
import type { DialogContext, DialogSpec, Hint, Values, VarListField } from './types';
import { walkFields } from './types';

export interface DistinctValue {
  value: string;
  label: string;
  count: number;
}

const isMissing = (v: Variable, x: Cell) => x === null || x === '' || v.missing.values.some((m) => String(m) === String(x)) || (typeof x === 'number' && !!v.missing.range && x >= v.missing.range.low && x <= v.missing.range.high);

/** Distinct non-missing values of V (observed, plus labelled values that do not occur), by frequency. */
export function distinctValues(v: Variable, column: Cell[] | undefined, limit = 200): DistinctValue[] {
  const counts = new Map<string, number>();
  for (const x of column ?? []) {
    if (isMissing(v, x)) continue;
    const k = typeof x === 'string' ? x.trimEnd() : String(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (counts.size > limit) break;
  }
  const labels = new Map(v.valueLabels.map((l) => [typeof l.value === 'string' ? l.value.trimEnd() : String(l.value), l.label]));
  for (const k of labels.keys()) if (!counts.has(k) && !v.missing.values.some((m) => String(m) === k)) counts.set(k, 0);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labels.get(value) ?? '', count }))
    .sort((a, b) => {
      const na = Number(a.value);
      const nb = Number(b.value);
      return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.value.localeCompare(b.value);
    });
}

/** Number of distinct non-missing values (capped at 99 for display). */
export function distinctCount(v: Variable, column: Cell[] | undefined): number {
  const s = new Set<string>();
  for (const x of column ?? []) {
    if (isMissing(v, x)) continue;
    s.add(String(x));
    if (s.size > 99) break;
  }
  return s.size;
}

/** Measurement level used for display (strings are their own kind). */
export function displayMeasure(v: Variable): 'nominal' | 'ordinal' | 'scale' | 'string' {
  if (v.type === 'string') return 'string';
  return v.measure === 'unknown' ? 'scale' : v.measure;
}

export function suits(f: VarListField | undefined, v: Variable): boolean {
  if (!f?.prefer) return true;
  const m = v.type === 'string' ? 'nominal' : v.measure === 'unknown' ? 'scale' : v.measure;
  return f.prefer.includes(m as Measure);
}

/** Soft warnings for variables whose measurement level does not suit their list (DLG-2). */
export function measureHints(spec: DialogSpec, values: Values, ctx: DialogContext): Hint[] {
  const out: Hint[] = [];
  walkFields(spec.fields, (f) => {
    if (f.kind !== 'varlist' || !f.prefer || (f.when && !f.when(values))) return;
    for (const name of (values[f.id] as string[]) ?? []) {
      const v = ctx.variables.find((x) => x.name === name);
      if (!v || v.measure === 'unknown' || suits(f, v)) continue;
      const target = f.prefer[0];
      out.push({
        level: 'warn',
        text: `dlg.hints.measure.${target}`,
        args: { name, measure: v.type === 'string' ? 'string' : v.measure },
        field: f.id,
        action: v.type === 'numeric' ? { label: `dlg.hints.setMeasure.${target}`, args: { name }, setMeasure: { variable: name, measure: target } } : undefined,
      });
    }
  });
  return out;
}

/**
 * Fills group-value fields (T-test groups, Kruskal-Wallis range) from the data, the way the dialog
 * preselects them, so a preset can be run without opening the dialog.
 */
export function completeGroupValues(spec: DialogSpec, values: Values, ctx: DialogContext): Values {
  const out = { ...values };
  walkFields(spec.fields, (f) => {
    if (f.kind !== 'groupvalues') return;
    const name = ((out[f.source] as string[]) ?? [])[0];
    const v = ctx.variables.find((x) => x.name === name);
    if (!v) return;
    const opts = distinctValues(v, ctx.column?.(name));
    if (opts.length < 2) return;
    const pick = f.mode === 'range' ? [opts[0].value, opts[opts.length - 1].value] : [...opts].sort((a, b) => b.count - a.count).slice(0, 2).map((o) => o.value).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    f.ids.forEach((id, i) => (out[id] = f.mode === 'range' ? Number(pick[i]) : pick[i]));
  });
  return out;
}
