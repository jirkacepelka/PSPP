/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, str, vars, wrap } from '../syntaxUtil';

export const correlations: DialogSpec = {
  id: 'correlations',
  kind: 'analysis',
  title: 'dlg.correlations.title',
  icon: 'scatter_plot',
  command: 'CORRELATIONS',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 2, prefer: ['scale', 'ordinal'] },
    {
      kind: 'radio',
      id: 'method',
      label: 'dlg.correlations.method',
      default: 'PEARSON',
      inline: true,
      options: [
        { value: 'PEARSON', label: 'dlg.correlations.pearson' },
        { value: 'SPEARMAN', label: 'dlg.correlations.spearman' },
        { value: 'KENDALL', label: 'dlg.correlations.kendall' },
      ],
    },
    {
      kind: 'radio',
      id: 'tails',
      label: 'dlg.correlations.test',
      default: 'TWOTAIL',
      inline: true,
      options: [
        { value: 'TWOTAIL', label: 'dlg.correlations.twoTailed' },
        { value: 'ONETAIL', label: 'dlg.correlations.oneTailed' },
      ],
    },
    { kind: 'checkbox', id: 'flag', label: 'dlg.correlations.flag', default: true },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'checkbox', id: 'descriptives', label: 'dlg.correlations.descriptives' },
        { kind: 'checkbox', id: 'xprod', label: 'dlg.correlations.xprod' },
        {
          kind: 'radio',
          id: 'missing',
          label: 'dlg.common.missingValues',
          default: 'PAIRWISE',
          options: [
            { value: 'PAIRWISE', label: 'dlg.common.excludePairwise' },
            { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
          ],
        },
      ],
    },
  ],
  validate: (v) => (vars(v, 'variables').length < 2 ? 'dlg.errors.twoVariables' : null),
  hints: (v, ctx) => {
    const ord = vars(v, 'variables').filter((n) => ctx.variables.find((x) => x.name === n)?.measure === 'ordinal');
    return ord.length && (str(v, 'method') || 'PEARSON') === 'PEARSON'
      ? [{ level: 'info', text: 'dlg.hints.ordinalSpearman', args: { names: ord.join(', ') }, action: { label: 'dlg.hints.useSpearman', patch: { method: 'SPEARMAN' } } }]
      : [];
  },
  toSyntax: (v) => {
    const method = str(v, 'method') || 'PEARSON';
    if (method !== 'PEARSON')
      return command('NONPAR CORR', '', [
        wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]),
        `PRINT=${method} ${str(v, 'tails') || 'TWOTAIL'} ${bool(v, 'flag') ? 'SIG' : 'NOSIG'}`,
        `MISSING=${str(v, 'missing') || 'PAIRWISE'}`,
      ]);
    const stats = [bool(v, 'descriptives') && 'DESCRIPTIVES', bool(v, 'xprod') && 'XPROD'].filter(Boolean);
    return command('CORRELATIONS', '', [
      wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]),
      `PRINT=${str(v, 'tails') || 'TWOTAIL'} ${bool(v, 'flag') ? 'SIG' : 'NOSIG'}`,
      stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
      `MISSING=${str(v, 'missing') || 'PAIRWISE'}`,
    ]);
  },
};
