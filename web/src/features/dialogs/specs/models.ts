/*
 * Models: binary logistic regression and univariate GLM.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

export const logistic: DialogSpec = {
  id: 'logistic',
  kind: 'analysis',
  title: 'dlg.logistic.title',
  icon: 'show_chart',
  command: 'LOGISTIC REGRESSION',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'dependent', label: 'dlg.logistic.dependent', filter: 'numeric', max: 1, min: 1, prefer: ['nominal'], groups: true },
    { kind: 'varlist', id: 'covariates', label: 'dlg.logistic.covariates', filter: 'numeric', prefer: ['scale', 'ordinal'] },
    { kind: 'varlist', id: 'categorical', label: 'dlg.logistic.categorical', filter: 'numeric', prefer: ['nominal'] },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'checkbox', id: 'ci', label: 'dlg.logistic.ci', default: true },
        { kind: 'number', id: 'ciLevel', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99, when: (v) => Boolean(v.ci) },
        { kind: 'number', id: 'cut', label: 'dlg.logistic.cut', default: 0.5, min: 0.01, max: 0.99, step: 0.05 },
        { kind: 'number', id: 'iterate', label: 'dlg.logistic.iterate', default: 20, min: 1, step: 1 },
        { kind: 'checkbox', id: 'noconst', label: 'dlg.logistic.noconst' },
      ],
    },
  ],
  errorFields: { 'dlg.errors.predictors': 'covariates' },
  validate: (v) => (vars(v, 'covariates').length + vars(v, 'categorical').length === 0 ? 'dlg.errors.predictors' : null),
  hints: (v, ctx) => {
    const d = vars(v, 'dependent')[0];
    const col = d ? ctx.column?.(d) : undefined;
    if (!col) return [];
    const distinct = new Set(col.filter((x) => x !== null && x !== '')).size;
    return distinct > 2 ? [{ level: 'warn', text: 'dlg.hints.notBinary', args: { name: d, count: distinct }, field: 'dependent' }] : [];
  },
  toSyntax: (v) => {
    const preds = [...vars(v, 'covariates'), ...vars(v, 'categorical')];
    const crit = [`CUT(${num(v, 'cut') ?? 0.5})`, `ITERATE(${Math.round(num(v, 'iterate') ?? 20)})`];
    return command('LOGISTIC REGRESSION', wrap([vars(v, 'dependent')[0] ?? '', 'WITH', ...preds]), [
      vars(v, 'categorical').length > 0 && `CATEGORICAL=${vars(v, 'categorical').join(' ')}`,
      bool(v, 'noconst') && 'NOCONST',
      bool(v, 'ci') && `PRINT=CI(${num(v, 'ciLevel') ?? 95})`,
      `CRITERIA=${crit.join(' ')}`,
    ]);
  },
};

export const glm: DialogSpec = {
  id: 'glm',
  kind: 'analysis',
  title: 'dlg.glm.title',
  icon: 'account_tree',
  command: 'GLM',
  fields: [
    { kind: 'varlist', id: 'dependent', label: 'dlg.common.dependent', filter: 'numeric', max: 1, min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'factors', label: 'dlg.glm.factors', min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'radio',
      id: 'design',
      label: 'dlg.glm.design',
      default: 'full',
      inline: true,
      options: [
        { value: 'full', label: 'dlg.glm.full' },
        { value: 'main', label: 'dlg.glm.main' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'select',
          id: 'sstype',
          label: 'dlg.glm.sstype',
          default: '3',
          options: [
            { value: '1', label: 'I', raw: true },
            { value: '2', label: 'II', raw: true },
            { value: '3', label: 'III', raw: true },
          ],
        },
        { kind: 'checkbox', id: 'intercept', label: 'dlg.glm.intercept', default: true },
      ],
    },
  ],
  toSyntax: (v) => {
    const f = vars(v, 'factors');
    return command('GLM', wrap([vars(v, 'dependent')[0] ?? '', 'BY', ...f]), [
      `METHOD=SSTYPE(${str(v, 'sstype') || '3'})`,
      `INTERCEPT=${bool(v, 'intercept') ? 'INCLUDE' : 'EXCLUDE'}`,
      v.design === 'main' && f.length > 1 && wrap([`DESIGN=${f.join(' ')}`]),
    ]);
  },
};
