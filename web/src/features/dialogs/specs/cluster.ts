/*
 * Hierarchical cluster analysis (CLUSTER, computed in the browser by src/ext/commands/cluster.ts).
 * Id 'hierCluster': 'cluster' is an alias the menu reserves for K-means (QUICK CLUSTER).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, Values } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

const int = (v: Values, id: string, d: number) => Math.max(1, Math.round(num(v, id) ?? d));

/** CLUSTER(n) or CLUSTER(min,max) for a none/single/range radio, '' for none. */
function solutions(v: Values, prefix: string): string {
  const mode = str(v, `${prefix}Mode`);
  if (mode === 'single') return `CLUSTER(${int(v, `${prefix}N`, 3)})`;
  if (mode === 'range') return `CLUSTER(${int(v, `${prefix}Min`, 2)},${int(v, `${prefix}Max`, 4)})`;
  return '';
}

function solutionFields(prefix: string, label: string) {
  return [
    {
      kind: 'radio' as const,
      id: `${prefix}Mode`,
      label,
      default: 'none',
      options: [
        { value: 'none', label: 'dlg.hierCluster.solNone' },
        { value: 'single', label: 'dlg.hierCluster.solSingle' },
        { value: 'range', label: 'dlg.hierCluster.solRange' },
      ],
    },
    { kind: 'number' as const, id: `${prefix}N`, label: 'dlg.hierCluster.nClusters', default: 3, min: 2, step: 1, when: (v: Values) => v[`${prefix}Mode`] === 'single' },
    {
      kind: 'group' as const,
      columns: 2 as const,
      when: (v: Values) => v[`${prefix}Mode`] === 'range',
      fields: [
        { kind: 'number' as const, id: `${prefix}Min`, label: 'dlg.hierCluster.minClusters', default: 2, min: 2, step: 1 },
        { kind: 'number' as const, id: `${prefix}Max`, label: 'dlg.hierCluster.maxClusters', default: 4, min: 2, step: 1 },
      ],
    },
  ];
}

export const hierCluster: DialogSpec = {
  id: 'hierCluster',
  kind: 'analysis',
  title: 'dlg.hierCluster.title',
  icon: 'account_tree',
  command: 'CLUSTER',
  source: 'any',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'id', label: 'dlg.hierCluster.labelBy', max: 1 },
    {
      kind: 'subdialog',
      id: 'statisticsTab',
      label: 'dlg.hierCluster.statisticsBtn',
      icon: 'table_chart',
      fields: [
        { kind: 'checkbox', id: 'schedule', label: 'dlg.hierCluster.schedule', default: true },
        { kind: 'checkbox', id: 'proximity', label: 'dlg.hierCluster.proximity' },
        ...solutionFields('mem', 'dlg.hierCluster.membership'),
      ],
    },
    {
      kind: 'subdialog',
      id: 'plotsTab',
      label: 'dlg.hierCluster.plotsBtn',
      icon: 'bar_chart',
      fields: [
        { kind: 'checkbox', id: 'dendrogram', label: 'dlg.hierCluster.dendrogram', default: true },
        { kind: 'info', label: 'dlg.hierCluster.icicleInfo' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'methodTab',
      label: 'dlg.hierCluster.methodBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'select',
          id: 'method',
          label: 'dlg.hierCluster.method',
          default: 'BAVERAGE',
          options: ['BAVERAGE', 'WAVERAGE', 'SINGLE', 'COMPLETE', 'CENTROID', 'MEDIAN', 'WARD'].map((m) => ({ value: m, label: `dlg.hierCluster.m_${m}` })),
        },
        {
          kind: 'select',
          id: 'measure',
          label: 'dlg.hierCluster.measure',
          default: 'SEUCLID',
          options: ['SEUCLID', 'EUCLID', 'COSINE', 'PEARSON', 'CHEBYCHEV', 'BLOCK', 'MINKOWSKI', 'POWER'].map((m) => ({ value: m, label: `dlg.hierCluster.d_${m}` })),
        },
        {
          kind: 'group',
          columns: 2,
          when: (v) => v.measure === 'MINKOWSKI' || v.measure === 'POWER',
          fields: [
            { kind: 'number', id: 'p', label: 'dlg.hierCluster.power', default: 2, min: 1, step: 1 },
            { kind: 'number', id: 'r', label: 'dlg.hierCluster.root', default: 2, min: 1, step: 1, when: (v) => v.measure === 'POWER' },
          ],
        },
        { kind: 'info', label: 'dlg.hierCluster.standardizeInfo' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'saveTab',
      label: 'dlg.hierCluster.saveBtn',
      icon: 'save',
      fields: solutionFields('save', 'dlg.hierCluster.saveMembership'),
    },
  ],
  validate: (v) => {
    for (const p of ['mem', 'save'])
      if (str(v, `${p}Mode`) === 'range' && int(v, `${p}Min`, 2) > int(v, `${p}Max`, 4)) return 'dlg.hierCluster.errRange';
    if (str(v, 'measure') === 'PEARSON' && vars(v, 'variables').length < 2) return 'dlg.hierCluster.errPearson';
    return null;
  },
  hints: (v) => {
    const m = str(v, 'method');
    return ['CENTROID', 'MEDIAN', 'WARD'].includes(m) && str(v, 'measure') !== 'SEUCLID'
      ? [{ level: 'info', text: 'dlg.hierCluster.hintSeuclid', field: 'measure', action: { label: 'dlg.hierCluster.useSeuclid', patch: { measure: 'SEUCLID' } } }]
      : [];
  },
  toSyntax: (v) => {
    const measure = str(v, 'measure') || 'SEUCLID';
    const p = Math.max(1, num(v, 'p') ?? 2);
    const r = Math.max(1, num(v, 'r') ?? 2);
    const measureText = measure === 'MINKOWSKI' ? `MINKOWSKI(${p})` : measure === 'POWER' ? `POWER(${p},${r})` : measure;
    const print = [bool(v, 'schedule') && 'SCHEDULE', solutions(v, 'mem'), bool(v, 'proximity') && 'DISTANCE'].filter(Boolean);
    const id = vars(v, 'id')[0];
    const save = solutions(v, 'save');
    return command('CLUSTER', wrap(vars(v, 'variables')), [
      `MEASURE=${measureText}`,
      `METHOD=${str(v, 'method') || 'BAVERAGE'}`,
      id && `ID=${id}`,
      `PRINT=${print.length ? print.join(' ') : 'NONE'}`,
      `PLOT=${bool(v, 'dendrogram') ? 'DENDROGRAM' : 'NONE'}`,
      save && `SAVE=${save}`,
    ]);
  },
};
