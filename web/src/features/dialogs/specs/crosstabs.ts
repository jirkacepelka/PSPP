/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, command, vars, wrap } from '../syntaxUtil';

const STATS = ['CHISQ', 'PHI', 'CC', 'LAMBDA', 'UC', 'BTAU', 'CTAU', 'GAMMA', 'D', 'KAPPA', 'ETA', 'CORR', 'RISK'];
const CELLS = ['COUNT', 'EXPECTED', 'ROW', 'COLUMN', 'TOTAL', 'RESIDUAL', 'SRESIDUAL', 'ASRESIDUAL'];

export const crosstabs: DialogSpec = {
  id: 'crosstabs',
  title: 'dlg.crosstabs.title',
  icon: 'grid_on',
  command: 'CROSSTABS',
  size: 'wide',
  fields: [
    { kind: 'varlist', id: 'rows', label: 'dlg.crosstabs.rows', min: 1 },
    { kind: 'varlist', id: 'cols', label: 'dlg.crosstabs.columns', min: 1 },
    { kind: 'varlist', id: 'layers', label: 'dlg.crosstabs.layers' },
    { kind: 'checkbox', id: 'barchart', label: 'dlg.crosstabs.barchart' },
    { kind: 'checkbox', id: 'notables', label: 'dlg.crosstabs.suppressTables' },
    {
      kind: 'subdialog',
      id: 'statistics',
      label: 'dlg.common.statisticsBtn',
      icon: 'functions',
      fields: [
        { kind: 'checkbox', id: 'st_CHISQ', label: 'dlg.crosstabs.chisq' },
        { kind: 'checkbox', id: 'st_CORR', label: 'dlg.crosstabs.corr' },
        {
          kind: 'group',
          label: 'dlg.crosstabs.nominal',
          fields: [
            { kind: 'checkbox', id: 'st_CC', label: 'dlg.crosstabs.cc' },
            { kind: 'checkbox', id: 'st_PHI', label: 'dlg.crosstabs.phi' },
            { kind: 'checkbox', id: 'st_LAMBDA', label: 'dlg.crosstabs.lambda' },
            { kind: 'checkbox', id: 'st_UC', label: 'dlg.crosstabs.uc' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.crosstabs.ordinal',
          fields: [
            { kind: 'checkbox', id: 'st_GAMMA', label: 'dlg.crosstabs.gamma' },
            { kind: 'checkbox', id: 'st_D', label: 'dlg.crosstabs.d' },
            { kind: 'checkbox', id: 'st_BTAU', label: 'dlg.crosstabs.btau' },
            { kind: 'checkbox', id: 'st_CTAU', label: 'dlg.crosstabs.ctau' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.crosstabs.other',
          fields: [
            { kind: 'checkbox', id: 'st_ETA', label: 'dlg.crosstabs.eta' },
            { kind: 'checkbox', id: 'st_KAPPA', label: 'dlg.crosstabs.kappa' },
            { kind: 'checkbox', id: 'st_RISK', label: 'dlg.crosstabs.risk' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'cells',
      label: 'dlg.crosstabs.cellsBtn',
      icon: 'table',
      fields: [
        {
          kind: 'group',
          label: 'dlg.crosstabs.counts',
          fields: [
            { kind: 'checkbox', id: 'c_COUNT', label: 'dlg.crosstabs.observed', default: true },
            { kind: 'checkbox', id: 'c_EXPECTED', label: 'dlg.crosstabs.expected' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.crosstabs.percentages',
          fields: [
            { kind: 'checkbox', id: 'c_ROW', label: 'dlg.crosstabs.row' },
            { kind: 'checkbox', id: 'c_COLUMN', label: 'dlg.crosstabs.column' },
            { kind: 'checkbox', id: 'c_TOTAL', label: 'dlg.crosstabs.total' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.crosstabs.residuals',
          fields: [
            { kind: 'checkbox', id: 'c_RESIDUAL', label: 'dlg.crosstabs.residual' },
            { kind: 'checkbox', id: 'c_SRESIDUAL', label: 'dlg.crosstabs.sresidual' },
            { kind: 'checkbox', id: 'c_ASRESIDUAL', label: 'dlg.crosstabs.asresidual' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'format',
      label: 'dlg.common.formatBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'radio',
          id: 'order',
          label: 'dlg.crosstabs.rowOrder',
          default: 'AVALUE',
          options: [
            { value: 'AVALUE', label: 'dlg.crosstabs.ascending' },
            { value: 'DVALUE', label: 'dlg.crosstabs.descending' },
          ],
        },
      ],
    },
  ],
  toSyntax: (v) => {
    const layers = vars(v, 'layers');
    const tables = [vars(v, 'rows').join(' '), 'BY', vars(v, 'cols').join(' '), ...(layers.length ? ['BY', layers.join(' ')] : [])];
    const stats = STATS.filter((s) => bool(v, `st_${s}`));
    const cells = CELLS.filter((c) => bool(v, `c_${c}`));
    return command('CROSSTABS', '', [
      wrap([`TABLES=${tables.join(' ')}`]),
      `FORMAT=${v.order === 'DVALUE' ? 'DVALUE' : 'AVALUE'} ${bool(v, 'notables') ? 'NOTABLES' : 'TABLES'}`,
      stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
      `CELLS=${cells.length ? cells.join(' ') : 'NONE'}`,
      bool(v, 'barchart') && 'BARCHART',
    ]);
  },
};
