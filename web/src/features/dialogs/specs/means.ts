/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, vars, wrap } from '../syntaxUtil';

const CELLS = ['MEAN', 'COUNT', 'STDDEV', 'SEMEAN', 'SUM', 'MIN', 'MAX', 'RANGE', 'VARIANCE', 'KURT', 'SEKURT', 'SKEW', 'SESKEW', 'FIRST', 'LAST', 'HARMONIC', 'GEOMETRIC'];

export const means: DialogSpec = {
  id: 'means',
  kind: 'analysis',
  title: 'dlg.means.title',
  icon: 'calculate',
  command: 'MEANS',
  fields: [
    { kind: 'varlist', id: 'dependents', label: 'dlg.common.dependentList', filter: 'numeric', min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'layer1', label: 'dlg.means.independentList', prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'layer2', label: 'dlg.means.layer2', when: (v) => ((v.layer1 as string[]) ?? []).length > 0 },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'functions',
      fields: [
        {
          kind: 'group',
          label: 'dlg.means.cellStatistics',
          columns: 2,
          fields: [
            { kind: 'checkbox', id: 'c_MEAN', label: 'stat.mean', default: true },
            { kind: 'checkbox', id: 'c_COUNT', label: 'stat.count', default: true },
            { kind: 'checkbox', id: 'c_STDDEV', label: 'stat.stddev', default: true },
            { kind: 'checkbox', id: 'c_SEMEAN', label: 'stat.semean' },
            { kind: 'checkbox', id: 'c_SUM', label: 'stat.sum' },
            { kind: 'checkbox', id: 'c_MIN', label: 'stat.minimum' },
            { kind: 'checkbox', id: 'c_MAX', label: 'stat.maximum' },
            { kind: 'checkbox', id: 'c_RANGE', label: 'stat.range' },
            { kind: 'checkbox', id: 'c_VARIANCE', label: 'stat.variance' },
            { kind: 'checkbox', id: 'c_KURT', label: 'stat.kurtosis' },
            { kind: 'checkbox', id: 'c_SEKURT', label: 'stat.sekurt' },
            { kind: 'checkbox', id: 'c_SKEW', label: 'stat.skewness' },
            { kind: 'checkbox', id: 'c_SESKEW', label: 'stat.seskew' },
            { kind: 'checkbox', id: 'c_FIRST', label: 'stat.first' },
            { kind: 'checkbox', id: 'c_LAST', label: 'stat.last' },
            { kind: 'checkbox', id: 'c_HARMONIC', label: 'stat.harmonic' },
            { kind: 'checkbox', id: 'c_GEOMETRIC', label: 'stat.geometric' },
          ],
        },
      ],
    },
  ],
  toSyntax: (v) => {
    const l1 = vars(v, 'layer1');
    const l2 = l1.length ? vars(v, 'layer2') : [];
    const words = [`TABLES=${vars(v, 'dependents').join(' ')}`];
    if (l1.length) words.push('BY', l1.join(' '));
    if (l2.length) words.push('BY', l2.join(' '));
    const cells = CELLS.filter((c) => bool(v, `c_${c}`));
    return command('MEANS', wrap(words), [`CELLS=${cells.length ? cells.join(' ') : 'NONE'}`]);
  },
};
