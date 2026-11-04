/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, str, vars, wrap } from '../syntaxUtil';

/** Partial correlations (PARTIAL CORR, computed in the browser as an extension analysis). */
export const partialCorr: DialogSpec = {
  id: 'partialCorr',
  kind: 'analysis',
  title: 'dlg.partialCorr.title',
  icon: 'scatter_plot',
  command: 'PARTIAL CORR',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.partialCorr.variables', filter: 'numeric', min: 2, prefer: ['scale'] },
    { kind: 'varlist', id: 'controls', label: 'dlg.partialCorr.controls', filter: 'numeric', min: 1, prefer: ['scale'] },
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
    // SPSS "Display actual significance level"; unchecked → FORMAT=CONDENSED (flags with asterisks)
    { kind: 'checkbox', id: 'showSig', label: 'dlg.partialCorr.showSig', default: true },
    {
      kind: 'subdialog',
      id: 'options',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'checkbox', id: 'descriptives', label: 'dlg.partialCorr.descriptives' },
        { kind: 'checkbox', id: 'zeroOrder', label: 'dlg.partialCorr.zeroOrder' },
        {
          kind: 'radio',
          id: 'missing',
          label: 'dlg.common.missingValues',
          default: 'LISTWISE',
          options: [
            { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
            { value: 'ANALYSIS', label: 'dlg.common.excludePairwise' },
          ],
        },
      ],
    },
  ],
  validate: (v) => {
    const main = vars(v, 'variables');
    if (main.length < 2) return 'dlg.errors.twoVariables';
    return vars(v, 'controls').some((c) => main.includes(c)) ? 'dlg.partialCorr.errorOverlap' : null;
  },
  errorFields: { 'dlg.partialCorr.errorOverlap': 'controls' },
  toSyntax: (v) => {
    const stats = [bool(v, 'descriptives') && 'DESCRIPTIVES', bool(v, 'zeroOrder') && 'CORR'].filter(Boolean);
    return command('PARTIAL CORR', '', [
      wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`, 'BY', ...vars(v, 'controls')]),
      `SIGNIFICANCE=${str(v, 'tails') || 'TWOTAIL'}`,
      stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
      !bool(v, 'showSig') && 'FORMAT=CONDENSED',
      `MISSING=${str(v, 'missing') || 'LISTWISE'}`,
    ]);
  },
};
