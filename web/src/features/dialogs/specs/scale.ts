/*
 * Scale and multivariate procedures: reliability, factor analysis, k-means clustering.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';
import { quote } from '../../../lib/variables';

export const reliability: DialogSpec = {
  id: 'reliability',
  kind: 'analysis',
  title: 'dlg.reliability.title',
  icon: 'verified',
  command: 'RELIABILITY',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'items', label: 'dlg.reliability.items', filter: 'numeric', min: 2, prefer: ['ordinal', 'scale'] },
    {
      kind: 'radio',
      id: 'model',
      label: 'dlg.reliability.model',
      default: 'ALPHA',
      inline: true,
      options: [
        { value: 'ALPHA', label: 'dlg.reliability.alpha' },
        { value: 'SPLIT', label: 'dlg.reliability.split' },
      ],
    },
    { kind: 'text', id: 'scale', label: 'dlg.reliability.scaleName', default: '' },
    { kind: 'checkbox', id: 'total', label: 'dlg.reliability.itemTotal', default: true },
  ],
  hints: (v) => (vars(v, 'items').length === 2 ? [{ level: 'info', text: 'dlg.hints.fewItems', field: 'items' }] : []),
  toSyntax: (v) =>
    command('RELIABILITY', '', [
      wrap([`VARIABLES=${vars(v, 'items').join(' ')}`]),
      `SCALE(${quote(str(v, 'scale') || 'Scale')})=ALL`,
      `MODEL=${str(v, 'model') || 'ALPHA'}`,
      bool(v, 'total') && 'SUMMARY=TOTAL',
    ]),
};

export const factor: DialogSpec = {
  id: 'factor',
  kind: 'analysis',
  title: 'dlg.factor.title',
  icon: 'hub',
  command: 'FACTOR',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 2, prefer: ['scale', 'ordinal'] },
    {
      kind: 'subdialog',
      id: 'extractionTab',
      label: 'dlg.factor.extractionBtn',
      icon: 'filter_alt',
      fields: [
        {
          kind: 'radio',
          id: 'extraction',
          label: 'dlg.factor.method',
          default: 'PC',
          options: [
            { value: 'PC', label: 'dlg.factor.pc' },
            { value: 'PAF', label: 'dlg.factor.paf' },
          ],
        },
        {
          kind: 'radio',
          id: 'nfactors',
          label: 'dlg.factor.extract',
          default: 'eigen',
          options: [
            { value: 'eigen', label: 'dlg.factor.byEigen' },
            { value: 'fixed', label: 'dlg.factor.fixed' },
          ],
        },
        { kind: 'number', id: 'mineigen', label: 'dlg.factor.mineigen', default: 1, min: 0, step: 0.1, when: (v) => v.nfactors !== 'fixed' },
        { kind: 'number', id: 'factors', label: 'dlg.factor.factors', default: 2, min: 1, step: 1, when: (v) => v.nfactors === 'fixed' },
        { kind: 'checkbox', id: 'scree', label: 'dlg.factor.scree', default: true },
      ],
    },
    {
      kind: 'subdialog',
      id: 'rotationTab',
      label: 'dlg.factor.rotationBtn',
      icon: 'rotate_right',
      fields: [
        {
          kind: 'radio',
          id: 'rotation',
          label: 'dlg.factor.rotation',
          default: 'VARIMAX',
          options: [
            { value: 'NOROTATE', label: 'dlg.factor.none' },
            { value: 'VARIMAX', label: 'Varimax' },
            { value: 'QUARTIMAX', label: 'Quartimax' },
            { value: 'EQUAMAX', label: 'Equamax' },
            { value: 'PROMAX', label: 'Promax' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'optionsTab',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'checkbox', id: 'univariate', label: 'dlg.factor.univariate' },
        { kind: 'checkbox', id: 'correlation', label: 'dlg.factor.correlation' },
        { kind: 'checkbox', id: 'kmo', label: 'dlg.factor.kmo', default: true },
        { kind: 'checkbox', id: 'sort', label: 'dlg.factor.sort', default: true },
        { kind: 'number', id: 'blank', label: 'dlg.factor.blank', default: null, min: 0, max: 1, step: 0.05 },
        {
          kind: 'radio',
          id: 'missing',
          label: 'dlg.common.missingValues',
          default: 'LISTWISE',
          options: [
            { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
            { value: 'PAIRWISE', label: 'dlg.common.excludePairwise' },
          ],
        },
      ],
    },
  ],
  toSyntax: (v) => {
    const print = ['INITIAL', 'EXTRACTION', str(v, 'rotation') !== 'NOROTATE' && 'ROTATION', bool(v, 'univariate') && 'UNIVARIATE', bool(v, 'correlation') && 'CORRELATION', bool(v, 'kmo') && 'KMO'].filter(Boolean);
    const blank = num(v, 'blank');
    const fmt = [bool(v, 'sort') && 'SORT', blank !== null && blank > 0 && `BLANK(${blank})`].filter(Boolean);
    const crit = v.nfactors === 'fixed' ? `FACTORS(${Math.max(1, Math.round(num(v, 'factors') ?? 2))})` : `MINEIGEN(${num(v, 'mineigen') ?? 1})`;
    return command('FACTOR', wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]), [
      `EXTRACTION=${str(v, 'extraction') || 'PC'}`,
      `ROTATION=${str(v, 'rotation') || 'VARIMAX'}`,
      `CRITERIA=${crit}`,
      `PRINT=${print.join(' ')}`,
      bool(v, 'scree') && 'PLOT=EIGEN',
      fmt.length > 0 && `FORMAT=${fmt.join(' ')}`,
      `MISSING=${str(v, 'missing') || 'LISTWISE'}`,
    ]);
  },
};

export const quickCluster: DialogSpec = {
  id: 'quickCluster',
  kind: 'analysis',
  title: 'dlg.quickCluster.title',
  icon: 'bubble_chart',
  command: 'QUICK CLUSTER',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 1, prefer: ['scale'] },
    {
      kind: 'group',
      columns: 2,
      fields: [
        { kind: 'number', id: 'k', label: 'dlg.quickCluster.k', default: 3, min: 2, step: 1 },
        { kind: 'number', id: 'iter', label: 'dlg.quickCluster.iter', default: 10, min: 1, step: 1 },
      ],
    },
    {
      kind: 'group',
      label: 'dlg.quickCluster.output',
      fields: [
        { kind: 'checkbox', id: 'initial', label: 'dlg.quickCluster.initial' },
        { kind: 'checkbox', id: 'membership', label: 'dlg.quickCluster.membership' },
        { kind: 'checkbox', id: 'saveCluster', label: 'dlg.quickCluster.saveCluster' },
        { kind: 'checkbox', id: 'saveDistance', label: 'dlg.quickCluster.saveDistance' },
      ],
    },
  ],
  toSyntax: (v) => {
    const print = [bool(v, 'initial') && 'INITIAL', bool(v, 'membership') && 'CLUSTER'].filter(Boolean);
    const save = [bool(v, 'saveCluster') && 'CLUSTER', bool(v, 'saveDistance') && 'DISTANCE'].filter(Boolean);
    return command('QUICK CLUSTER', wrap([vars(v, 'variables').join(' ')]), [
      `CRITERIA=CLUSTERS(${Math.max(2, Math.round(num(v, 'k') ?? 3))}) MXITER(${Math.max(1, Math.round(num(v, 'iter') ?? 10))})`,
      print.length > 0 && `PRINT=${print.join(' ')}`,
      save.length > 0 && `SAVE=${save.join(' ')}`,
    ]);
  },
};
