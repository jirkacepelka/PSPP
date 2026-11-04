/*
 * Multinomial logistic regression (NOMREG) – computed in the browser as an extension analysis.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, Hint } from '../types';
import { bool, command, lit, num, str, vars, wrap } from '../syntaxUtil';
import { distinctOf } from './plum';

export const nomreg: DialogSpec = {
  id: 'nomreg',
  kind: 'analysis',
  title: 'dlg.nomreg.title',
  icon: 'alt_route',
  command: 'NOMREG',
  fields: [
    { kind: 'varlist', id: 'dependent', label: 'dlg.nomreg.dependent', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'radio',
      id: 'base',
      label: 'dlg.nomreg.base',
      default: 'LAST',
      inline: true,
      options: [
        { value: 'LAST', label: 'dlg.nomreg.last' },
        { value: 'FIRST', label: 'dlg.nomreg.first' },
        { value: 'custom', label: 'dlg.nomreg.custom' },
      ],
    },
    { kind: 'text', id: 'baseValue', label: 'dlg.nomreg.baseValue', when: (v) => v.base === 'custom' },
    { kind: 'varlist', id: 'factors', label: 'dlg.nomreg.factors', prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'covariates', label: 'dlg.nomreg.covariates', filter: 'numeric', prefer: ['scale'] },
    {
      kind: 'subdialog',
      id: 'statistics',
      label: 'dlg.nomreg.statisticsBtn',
      icon: 'checklist',
      fields: [
        { kind: 'checkbox', id: 'cps', label: 'dlg.nomreg.cps', default: true },
        { kind: 'checkbox', id: 'mfi', label: 'dlg.nomreg.mfi', default: true },
        { kind: 'checkbox', id: 'summary', label: 'dlg.nomreg.summary', default: true },
        { kind: 'checkbox', id: 'lrt', label: 'dlg.nomreg.lrt', default: true },
        { kind: 'checkbox', id: 'parameter', label: 'dlg.nomreg.parameters', default: true },
        { kind: 'checkbox', id: 'fit', label: 'dlg.nomreg.fit' },
        { kind: 'checkbox', id: 'classtable', label: 'dlg.nomreg.classtable' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'number', id: 'ciLevel', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99 },
        { kind: 'number', id: 'iterate', label: 'dlg.nomreg.iterate', default: 100, min: 1, step: 1 },
      ],
    },
  ],
  errorFields: { 'dlg.nomreg.needBase': 'baseValue' },
  validate: (v) => (v.base === 'custom' && !str(v, 'baseValue') ? 'dlg.nomreg.needBase' : null),
  hints: (v, ctx) => {
    const d = vars(v, 'dependent')[0];
    const n = distinctOf(ctx, d);
    const out: Hint[] = [];
    if (n !== null && n > 10) out.push({ level: 'warn', text: 'dlg.nomreg.manyCats', args: { name: d, count: n }, field: 'dependent' });
    const dv = ctx.variables.find((x) => x.name === d);
    if (dv?.measure === 'ordinal' && dv.type !== 'string') out.push({ level: 'info', text: 'dlg.nomreg.ordinal', args: { name: d }, field: 'dependent' });
    return out;
  },
  toSyntax: (v, ctx) => {
    const d = vars(v, 'dependent')[0] ?? '';
    const f = vars(v, 'factors');
    const c = vars(v, 'covariates');
    const isString = ctx.variables.find((x) => x.name === d)?.type === 'string';
    const base = v.base === 'custom' ? lit(str(v, 'baseValue'), isString) : str(v, 'base') || 'LAST';
    const print = (['cps', 'mfi', 'summary', 'lrt', 'parameter', 'fit', 'classtable'] as const).filter((k) => bool(v, k)).map((k) => k.toUpperCase());
    return command('NOMREG', wrap([d, `(BASE=${base}`, 'ORDER=ASCENDING)', ...(f.length ? ['BY', ...f] : []), ...(c.length ? ['WITH', ...c] : [])]), [
      `CRITERIA=CIN(${num(v, 'ciLevel') ?? 95}) MXITER(${Math.round(num(v, 'iterate') ?? 100)})`,
      `PRINT=${print.length ? print.join(' ') : 'NONE'}`,
    ]);
  },
};
