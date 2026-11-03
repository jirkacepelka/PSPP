/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, num, vars, wrap } from '../syntaxUtil';

export const regressionLinear: DialogSpec = {
  id: 'regressionLinear',
  kind: 'analysis',
  title: 'dlg.regressionLinear.title',
  icon: 'trending_up',
  command: 'REGRESSION',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'dependent', label: 'dlg.common.dependent', filter: 'numeric', max: 1, min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'independents', label: 'dlg.common.independents', filter: 'numeric', min: 1 },
    {
      kind: 'subdialog',
      id: 'statistics',
      label: 'dlg.common.statisticsBtn',
      icon: 'functions',
      fields: [
        { kind: 'checkbox', id: 'coeff', label: 'dlg.regressionLinear.coeff', default: true },
        { kind: 'checkbox', id: 'r', label: 'dlg.regressionLinear.r', default: true },
        { kind: 'checkbox', id: 'anova', label: 'dlg.regressionLinear.anova', default: true },
        { kind: 'checkbox', id: 'bcov', label: 'dlg.regressionLinear.bcov' },
        { kind: 'checkbox', id: 'tol', label: 'dlg.regressionLinear.tol' },
        { kind: 'checkbox', id: 'ci', label: 'dlg.regressionLinear.ci' },
        { kind: 'number', id: 'ciLevel', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99, when: (v) => Boolean(v.ci) },
      ],
    },
    {
      kind: 'subdialog',
      id: 'save',
      label: 'dlg.common.saveBtn',
      icon: 'save_as',
      fields: [
        { kind: 'checkbox', id: 'pred', label: 'dlg.regressionLinear.savePred' },
        { kind: 'checkbox', id: 'resid', label: 'dlg.regressionLinear.saveResid' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [{ kind: 'checkbox', id: 'origin', label: 'dlg.regressionLinear.origin' }],
    },
  ],
  toSyntax: (v) => {
    const stats: string[] = [];
    if (bool(v, 'coeff')) stats.push('COEFF');
    if (bool(v, 'r')) stats.push('R');
    if (bool(v, 'anova')) stats.push('ANOVA');
    if (bool(v, 'bcov')) stats.push('BCOV');
    if (bool(v, 'tol')) stats.push('TOL');
    if (bool(v, 'ci')) stats.push(`CI(${num(v, 'ciLevel') ?? 95})`);
    const save = [bool(v, 'pred') && 'PRED', bool(v, 'resid') && 'RESID'].filter(Boolean);
    return command('REGRESSION', '', [
      wrap([`VARIABLES=${vars(v, 'independents').join(' ')}`]),
      `DEPENDENT=${vars(v, 'dependent').join(' ')}`,
      'METHOD=ENTER',
      `STATISTICS=${stats.length ? stats.join(' ') : 'DEFAULTS'}`,
      bool(v, 'origin') ? 'ORIGIN' : null,
      save.length > 0 && `SAVE=${save.join(' ')}`,
    ]);
  },
};
