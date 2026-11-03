/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { command, lit, num, str, vars, wrap } from '../syntaxUtil';
import { ciCriteria, ttestOptions } from './ttestOneSample';

export const ttestIndependent: DialogSpec = {
  id: 'ttestIndependent',
  title: 'dlg.ttestIndependent.title',
  icon: 'compare_arrows',
  command: 'T-TEST',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1 },
    { kind: 'varlist', id: 'group', label: 'dlg.ttestIndependent.groupingVariable', max: 1, min: 1 },
    {
      kind: 'radio',
      id: 'define',
      label: 'dlg.ttestIndependent.defineGroups',
      default: 'values',
      inline: true,
      options: [
        { value: 'values', label: 'dlg.ttestIndependent.useValues' },
        { value: 'cut', label: 'dlg.ttestIndependent.cutPoint' },
      ],
    },
    {
      kind: 'group',
      columns: 2,
      when: (v) => v.define !== 'cut',
      fields: [
        { kind: 'text', id: 'g1', label: 'dlg.ttestIndependent.group1', default: '1' },
        { kind: 'text', id: 'g2', label: 'dlg.ttestIndependent.group2', default: '2' },
      ],
    },
    { kind: 'number', id: 'cut', label: 'dlg.ttestIndependent.cutPointValue', when: (v) => v.define === 'cut', default: null },
    ttestOptions,
  ],
  validate: (v, ctx) => {
    if (v.define === 'cut') return num(v, 'cut') === null ? 'dlg.errors.cutPoint' : null;
    if (!str(v, 'g1') || !str(v, 'g2')) return 'dlg.errors.groups';
    void ctx;
    return null;
  },
  toSyntax: (v, ctx) => {
    const g = vars(v, 'group')[0] ?? '';
    const gv = ctx.variables.find((x) => x.name === g);
    const isStr = gv?.type === 'string';
    const groups = v.define === 'cut' ? `${num(v, 'cut')}` : `${lit(str(v, 'g1'), isStr)}, ${lit(str(v, 'g2'), isStr)}`;
    return command('T-TEST', '', [`GROUPS=${g}(${groups})`, wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]), `MISSING=${str(v, 'missing') || 'ANALYSIS'}`, ciCriteria(v)]);
  },
};
