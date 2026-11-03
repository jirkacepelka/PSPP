/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

export const explore: DialogSpec = {
  id: 'explore',
  title: 'dlg.explore.title',
  icon: 'query_stats',
  command: 'EXAMINE',
  fields: [
    { kind: 'varlist', id: 'dependents', label: 'dlg.common.dependentList', filter: 'numeric', min: 1 },
    { kind: 'varlist', id: 'factors', label: 'dlg.common.factorList' },
    { kind: 'varlist', id: 'id', label: 'dlg.explore.labelCases', max: 1 },
    {
      kind: 'radio',
      id: 'display',
      label: 'dlg.explore.display',
      default: 'both',
      inline: true,
      options: [
        { value: 'both', label: 'dlg.explore.both' },
        { value: 'stats', label: 'dlg.common.statistics' },
        { value: 'plots', label: 'dlg.explore.plots' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'statistics',
      label: 'dlg.common.statisticsBtn',
      icon: 'functions',
      fields: [
        { kind: 'checkbox', id: 'descriptives', label: 'dlg.explore.descriptives', default: true },
        { kind: 'number', id: 'ci', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99, step: 1, when: (v) => Boolean(v.descriptives) },
        { kind: 'checkbox', id: 'extremes', label: 'dlg.explore.extremes' },
        { kind: 'checkbox', id: 'percentiles', label: 'dlg.explore.percentiles' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'plots',
      label: 'dlg.explore.plotsBtn',
      icon: 'insert_chart',
      fields: [
        { kind: 'checkbox', id: 'boxplot', label: 'dlg.explore.boxplot', default: true },
        { kind: 'checkbox', id: 'histogram', label: 'dlg.explore.histogram' },
        { kind: 'checkbox', id: 'npplot', label: 'dlg.explore.npplot' },
        {
          kind: 'radio',
          id: 'compare',
          label: 'dlg.explore.compare',
          default: 'GROUPS',
          options: [
            { value: 'GROUPS', label: 'dlg.explore.compareGroups' },
            { value: 'VARIABLES', label: 'dlg.explore.compareVariables' },
          ],
        },
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
          default: 'LISTWISE',
          options: [
            { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
            { value: 'PAIRWISE', label: 'dlg.common.excludePairwise' },
            { value: 'REPORT', label: 'dlg.explore.reportValues' },
          ],
        },
      ],
    },
  ],
  toSyntax: (v) => {
    const factors = vars(v, 'factors');
    const head = wrap([`VARIABLES=${vars(v, 'dependents').join(' ')}`, ...(factors.length ? ['BY', factors.join(' BY ')] : [])]);
    const display = str(v, 'display');
    const stats: string[] = [];
    if (display !== 'plots') {
      if (bool(v, 'descriptives')) stats.push('DESCRIPTIVES');
      if (bool(v, 'extremes')) stats.push('EXTREME');
    }
    const plots: string[] = [];
    if (display !== 'stats') {
      if (bool(v, 'boxplot')) plots.push('BOXPLOT');
      if (bool(v, 'histogram')) plots.push('HISTOGRAM');
      if (bool(v, 'npplot')) plots.push('NPPLOT');
    }
    const id = vars(v, 'id')[0];
    const ci = num(v, 'ci');
    const missing = str(v, 'missing') || 'LISTWISE';
    return command('EXAMINE', head, [
      id && `ID=${id}`,
      `STATISTICS=${stats.length ? stats.join(' ') : 'NONE'}`,
      `PLOT=${plots.length ? plots.join(' ') : 'NONE'}`,
      plots.includes('BOXPLOT') && `COMPARE=${str(v, 'compare') || 'GROUPS'}`,
      display !== 'plots' && bool(v, 'percentiles') && 'PERCENTILES=HAVERAGE',
      stats.includes('DESCRIPTIVES') && ci !== null && ci !== 95 && `CINTERVAL ${ci}`,
      `MISSING=${missing === 'REPORT' ? 'LISTWISE REPORT' : missing}`,
    ]);
  },
};
