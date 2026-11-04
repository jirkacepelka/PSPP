/*
 * Ordinal regression (PLUM) – computed in the browser as an extension analysis.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogContext, DialogSpec, Hint } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

/** Distinct non-empty values of a variable in the active dataset (null when unknown). */
export function distinctOf(ctx: DialogContext, name: string | undefined): number | null {
  const col = name ? ctx.column?.(name) : undefined;
  if (!col) return null;
  const v = ctx.variables.find((x) => x.name === name);
  const miss = new Set((v?.missing?.values ?? []).map(String));
  return new Set(col.filter((x) => x !== null && x !== '' && !miss.has(String(x).trimEnd())).map((x) => String(x).trimEnd())).size;
}

const LINKS = ['LOGIT', 'PROBIT', 'CLOGLOG', 'NLOGLOG', 'CAUCHIT'];

export const plum: DialogSpec = {
  id: 'plum',
  kind: 'analysis',
  title: 'dlg.plum.title',
  icon: 'stairs',
  command: 'PLUM',
  fields: [
    { kind: 'varlist', id: 'dependent', label: 'dlg.plum.dependent', max: 1, min: 1, prefer: ['ordinal'], groups: true },
    { kind: 'varlist', id: 'factors', label: 'dlg.plum.factors', prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'covariates', label: 'dlg.plum.covariates', filter: 'numeric', prefer: ['scale'] },
    { kind: 'select', id: 'link', label: 'dlg.plum.link', default: 'LOGIT', options: LINKS.map((l) => ({ value: l, label: `dlg.plum.${l.toLowerCase()}` })) },
    {
      kind: 'subdialog',
      id: 'output',
      label: 'dlg.plum.outputBtn',
      icon: 'checklist',
      fields: [
        { kind: 'checkbox', id: 'fit', label: 'dlg.plum.fit', default: true },
        { kind: 'checkbox', id: 'summary', label: 'dlg.plum.summary', default: true },
        { kind: 'checkbox', id: 'parameter', label: 'dlg.plum.parameters', default: true },
        { kind: 'checkbox', id: 'tparallel', label: 'dlg.plum.tparallel' },
        { kind: 'checkbox', id: 'history', label: 'dlg.plum.history' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'number', id: 'ciLevel', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99 },
        { kind: 'number', id: 'iterate', label: 'dlg.plum.iterate', default: 100, min: 1, step: 1 },
      ],
    },
  ],
  hints: (v, ctx) => {
    const d = vars(v, 'dependent')[0];
    const n = distinctOf(ctx, d);
    const out: Hint[] = [];
    if (n !== null && n > 10) out.push({ level: 'warn', text: 'dlg.plum.manyCats', args: { name: d, count: n }, field: 'dependent' });
    if (n === 2) out.push({ level: 'info', text: 'dlg.plum.binary', args: { name: d }, field: 'dependent' });
    return out;
  },
  toSyntax: (v) => {
    const f = vars(v, 'factors');
    const c = vars(v, 'covariates');
    const print = [bool(v, 'fit') && 'FIT', bool(v, 'parameter') && 'PARAMETER', bool(v, 'summary') && 'SUMMARY', bool(v, 'tparallel') && 'TPARALLEL', bool(v, 'history') && 'HISTORY(1)'].filter(Boolean) as string[];
    return command('PLUM', wrap([vars(v, 'dependent')[0] ?? '', ...(f.length ? ['BY', ...f] : []), ...(c.length ? ['WITH', ...c] : [])]), [
      `LINK=${str(v, 'link') || 'LOGIT'}`,
      `CRITERIA=CIN(${num(v, 'ciLevel') ?? 95}) MXITER(${Math.round(num(v, 'iterate') ?? 100)})`,
      `PRINT=${print.length ? print.join(' ') : 'NONE'}`,
    ]);
  },
};
