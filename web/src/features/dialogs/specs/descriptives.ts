/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, vars, wrap } from '../syntaxUtil';

const STATS = ['MEAN', 'SUM', 'STDDEV', 'VARIANCE', 'RANGE', 'MIN', 'MAX', 'SEMEAN', 'KURTOSIS', 'SKEWNESS'];

export const descriptives: DialogSpec = {
  id: 'descriptives',
  title: 'dlg.descriptives.title',
  icon: 'functions',
  command: 'DESCRIPTIVES',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 1 },
    { kind: 'checkbox', id: 'save', label: 'dlg.descriptives.saveZ' },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'group',
          label: 'dlg.common.statistics',
          columns: 2,
          fields: [
            { kind: 'checkbox', id: 'st_MEAN', label: 'stat.mean', default: true },
            { kind: 'checkbox', id: 'st_SUM', label: 'stat.sum' },
            { kind: 'checkbox', id: 'st_STDDEV', label: 'stat.stddev', default: true },
            { kind: 'checkbox', id: 'st_VARIANCE', label: 'stat.variance' },
            { kind: 'checkbox', id: 'st_RANGE', label: 'stat.range' },
            { kind: 'checkbox', id: 'st_MIN', label: 'stat.minimum', default: true },
            { kind: 'checkbox', id: 'st_MAX', label: 'stat.maximum', default: true },
            { kind: 'checkbox', id: 'st_SEMEAN', label: 'stat.semean' },
            { kind: 'checkbox', id: 'st_KURTOSIS', label: 'stat.kurtosis' },
            { kind: 'checkbox', id: 'st_SKEWNESS', label: 'stat.skewness' },
          ],
        },
        { kind: 'checkbox', id: 'listwise', label: 'dlg.common.excludeListwise' },
        { kind: 'checkbox', id: 'includeMissing', label: 'dlg.common.includeUserMissing' },
      ],
    },
  ],
  toSyntax: (v) => {
    const stats = STATS.filter((s) => bool(v, `st_${s}`));
    const missing = [bool(v, 'listwise') ? 'LISTWISE' : '', bool(v, 'includeMissing') ? 'INCLUDE' : ''].filter(Boolean).join(' ');
    return command('DESCRIPTIVES', '', [
      wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]),
      bool(v, 'save') && 'SAVE',
      `STATISTICS=${stats.length ? stats.join(' ') : 'NONE'}`,
      missing && `MISSING=${missing}`,
    ]);
  },
};
