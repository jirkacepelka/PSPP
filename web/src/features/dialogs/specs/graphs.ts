/*
 * Charts: histogram, bar chart and scatterplot (GRAPH) and boxplot (EXAMINE).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { bool, command, str, vars, wrap } from '../syntaxUtil';

export const histogram: DialogSpec = {
  id: 'histogram',
  kind: 'graph',
  title: 'dlg.histogram.title',
  icon: 'equalizer',
  command: 'GRAPH',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variable', label: 'dlg.common.variable', filter: 'numeric', min: 1, max: 1, prefer: ['scale'] },
    { kind: 'checkbox', id: 'normal', label: 'dlg.frequencies.normalCurve', default: true },
  ],
  toSyntax: (v) => command('GRAPH', '', [`HISTOGRAM${bool(v, 'normal') ? '(NORMAL)' : ''}=${vars(v, 'variable')[0]}`]),
};

export const barChart: DialogSpec = {
  id: 'barChart',
  kind: 'graph',
  title: 'dlg.barChart.title',
  icon: 'bar_chart',
  command: 'GRAPH',
  fields: [
    { kind: 'varlist', id: 'category', label: 'dlg.barChart.category', min: 1, max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'cluster', label: 'dlg.barChart.cluster', max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'select',
      id: 'func',
      label: 'dlg.barChart.bars',
      default: 'COUNT',
      options: [
        { value: 'COUNT', label: 'dlg.barChart.count' },
        { value: 'PCT', label: 'dlg.barChart.pct' },
        { value: 'CUFREQ', label: 'dlg.barChart.cufreq' },
        { value: 'CUPCT', label: 'dlg.barChart.cupct' },
        { value: 'MEAN', label: 'dlg.barChart.mean' },
        { value: 'SUM', label: 'dlg.barChart.sum' },
        { value: 'MINIMUM', label: 'dlg.barChart.min' },
        { value: 'MAXIMUM', label: 'dlg.barChart.max' },
      ],
    },
    { kind: 'varlist', id: 'variable', label: 'dlg.barChart.variable', filter: 'numeric', max: 1, min: 1, prefer: ['scale'], when: (v) => ['MEAN', 'SUM', 'MINIMUM', 'MAXIMUM'].includes(String(v.func)) },
  ],
  toSyntax: (v) => {
    const f = str(v, 'func') || 'COUNT';
    const summary = ['MEAN', 'SUM', 'MINIMUM', 'MAXIMUM'].includes(f) ? `${f}(${vars(v, 'variable')[0]})` : f;
    const cl = vars(v, 'cluster')[0];
    return command('GRAPH', '', [`BAR=${summary} BY ${vars(v, 'category')[0]}${cl ? ` BY ${cl}` : ''}`]);
  },
};

export const scatter: DialogSpec = {
  id: 'scatter',
  kind: 'graph',
  title: 'dlg.scatter.title',
  icon: 'scatter_plot',
  command: 'GRAPH',
  fields: [
    { kind: 'varlist', id: 'y', label: 'dlg.scatter.y', filter: 'numeric', min: 1, max: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'x', label: 'dlg.scatter.x', filter: 'numeric', min: 1, max: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'by', label: 'dlg.scatter.by', max: 1, prefer: ['nominal', 'ordinal'] },
  ],
  toSyntax: (v) => {
    const by = vars(v, 'by')[0];
    return command('GRAPH', '', [`SCATTERPLOT(BIVARIATE)=${vars(v, 'x')[0]} WITH ${vars(v, 'y')[0]}${by ? ` BY ${by}` : ''}`]);
  },
};

export const boxplot: DialogSpec = {
  id: 'boxplot',
  kind: 'graph',
  title: 'dlg.boxplot.title',
  icon: 'candlestick_chart',
  command: 'EXAMINE',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'factor', label: 'dlg.boxplot.factor', max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'id', label: 'dlg.explore.labelCases', max: 1 },
    {
      kind: 'radio',
      id: 'compare',
      label: 'dlg.boxplot.compare',
      default: 'GROUPS',
      inline: true,
      when: (v) => vars(v, 'variables').length > 1,
      options: [
        { value: 'GROUPS', label: 'dlg.boxplot.byGroups' },
        { value: 'VARIABLES', label: 'dlg.boxplot.byVariables' },
      ],
    },
  ],
  toSyntax: (v) => {
    const f = vars(v, 'factor')[0];
    return command('EXAMINE', wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`, ...(f ? ['BY', f] : [])]), [
      vars(v, 'id')[0] && `ID=${vars(v, 'id')[0]}`,
      'PLOT=BOXPLOT',
      'STATISTICS=NONE',
      `COMPARE=${str(v, 'compare') || 'GROUPS'}`,
    ]);
  },
};
