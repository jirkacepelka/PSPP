/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

const POSTHOC = ['LSD', 'BONFERRONI', 'SCHEFFE', 'SIDAK', 'TUKEY', 'GH'];

export const oneway: DialogSpec = {
  id: 'oneway',
  kind: 'analysis',
  title: 'dlg.oneway.title',
  icon: 'stacked_bar_chart',
  command: 'ONEWAY',
  fields: [
    { kind: 'varlist', id: 'dependents', label: 'dlg.common.dependentList', filter: 'numeric', min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'factor', label: 'dlg.common.factor', filter: 'numeric', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'group',
      label: 'dlg.common.statistics',
      fields: [
        { kind: 'checkbox', id: 'descriptives', label: 'dlg.oneway.descriptives' },
        { kind: 'checkbox', id: 'homogeneity', label: 'dlg.oneway.homogeneity' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'posthoc',
      label: 'dlg.oneway.posthocBtn',
      icon: 'rule',
      fields: [
        {
          kind: 'group',
          label: 'dlg.oneway.equalVariances',
          columns: 2,
          fields: [
            { kind: 'checkbox', id: 'ph_LSD', label: 'dlg.oneway.lsd' },
            { kind: 'checkbox', id: 'ph_BONFERRONI', label: 'dlg.oneway.bonferroni' },
            { kind: 'checkbox', id: 'ph_SCHEFFE', label: 'dlg.oneway.scheffe' },
            { kind: 'checkbox', id: 'ph_SIDAK', label: 'dlg.oneway.sidak' },
            { kind: 'checkbox', id: 'ph_TUKEY', label: 'dlg.oneway.tukey' },
          ],
        },
        { kind: 'group', label: 'dlg.oneway.unequalVariances', fields: [{ kind: 'checkbox', id: 'ph_GH', label: 'dlg.oneway.gh' }] },
        { kind: 'number', id: 'alpha', label: 'dlg.oneway.alpha', default: 0.05, min: 0.0001, max: 0.5, step: 0.01 },
      ],
    },
    {
      kind: 'subdialog',
      id: 'contrasts',
      label: 'dlg.oneway.contrastsBtn',
      icon: 'linear_scale',
      fields: [
        { kind: 'info', label: 'dlg.oneway.contrastsInfo' },
        { kind: 'rows', id: 'contrasts', label: 'dlg.oneway.contrasts', columns: [{ id: 'coef', label: 'dlg.oneway.coefficients', type: 'text', placeholder: '-1 1 0' }] },
      ],
    },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'radio',
          id: 'missing',
          label: 'dlg.common.missingValues',
          default: 'ANALYSIS',
          options: [
            { value: 'ANALYSIS', label: 'dlg.common.excludeAnalysis' },
            { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
          ],
        },
      ],
    },
  ],
  toSyntax: (v) => {
    const stats = [bool(v, 'descriptives') && 'DESCRIPTIVES', bool(v, 'homogeneity') && 'HOMOGENEITY'].filter(Boolean);
    const ph = POSTHOC.filter((p) => bool(v, `ph_${p}`));
    const alpha = num(v, 'alpha');
    const contrasts = ((v.contrasts as { coef?: string }[]) ?? [])
      .map((c) => (c.coef ?? '').split(/[\s,;]+/).filter((x) => x !== '' && Number.isFinite(Number(x))))
      .filter((c) => c.length > 0);
    return command('ONEWAY', '', [
      wrap([`VARIABLES=${vars(v, 'dependents').join(' ')}`, 'BY', vars(v, 'factor')[0] ?? '']),
      stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
      ph.length > 0 && `POSTHOC=${ph.join(' ')}${alpha !== null && alpha !== 0.05 ? ` ALPHA(${alpha})` : ''}`,
      ...contrasts.map((c) => `CONTRAST=${c.join(' ')}`),
      `MISSING=${str(v, 'missing') || 'ANALYSIS'}`,
    ]);
  },
};
