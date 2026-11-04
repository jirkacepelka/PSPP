/*
 * ROC curve (ROC): how well test variables separate a positive from a negative state.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogContext, DialogSpec, Values } from '../types';
import { bool, command, lit, num, str, vars, wrap } from '../syntaxUtil';

const stateLit = (v: Values, ctx: DialogContext) => {
  const s = vars(v, 'state')[0];
  return lit(str(v, 'positive'), ctx.variables.find((x) => x.name === s)?.type === 'string');
};

export const roc: DialogSpec = {
  id: 'roc',
  kind: 'analysis',
  title: 'dlg.roc.title',
  icon: 'show_chart',
  command: 'ROC',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.roc.testVariables', filter: 'numeric', min: 1, prefer: ['scale', 'ordinal'] },
    { kind: 'varlist', id: 'state', label: 'dlg.roc.stateVariable', max: 1, min: 1, prefer: ['nominal'], groups: true },
    { kind: 'groupvalues', source: 'state', ids: ['positive'], labels: ['dlg.roc.positive'], mode: 'pair' },
    {
      kind: 'group',
      label: 'dlg.roc.display',
      fields: [
        { kind: 'checkbox', id: 'curve', label: 'dlg.roc.curve', default: true },
        { kind: 'checkbox', id: 'reference', label: 'dlg.roc.reference', default: true, when: (v) => v.curve !== false },
        { kind: 'checkbox', id: 'se', label: 'dlg.roc.se', default: true },
        { kind: 'checkbox', id: 'coordinates', label: 'dlg.roc.coordinates' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'optionsTab',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'radio',
          id: 'testpos',
          label: 'dlg.roc.testpos',
          default: 'LARGE',
          options: [
            { value: 'LARGE', label: 'dlg.roc.large' },
            { value: 'SMALL', label: 'dlg.roc.small' },
          ],
        },
        {
          kind: 'radio',
          id: 'cutoff',
          label: 'dlg.roc.cutoff',
          default: 'INCLUDE',
          options: [
            { value: 'INCLUDE', label: 'dlg.roc.include' },
            { value: 'EXCLUDE', label: 'dlg.roc.exclude' },
          ],
        },
        {
          kind: 'radio',
          id: 'distribution',
          label: 'dlg.roc.distribution',
          default: 'FREE',
          options: [
            { value: 'FREE', label: 'dlg.roc.free' },
            { value: 'NEGEXPO', label: 'dlg.roc.negexpo' },
          ],
        },
        { kind: 'number', id: 'ci', label: 'dlg.common.ciLevel', default: 95, min: 50, max: 99.9, step: 1 },
        {
          kind: 'radio',
          id: 'missing',
          label: 'dlg.common.missingValues',
          default: 'EXCLUDE',
          options: [
            { value: 'EXCLUDE', label: 'dlg.roc.missingExclude' },
            { value: 'INCLUDE', label: 'dlg.roc.missingInclude' },
          ],
        },
      ],
    },
  ],
  validate: (v) => (str(v, 'positive') === '' ? 'dlg.errors.rocPositive' : null),
  errorFields: { 'dlg.errors.rocPositive': 'positive' },
  toSyntax: (v, ctx) => {
    const curve = v.curve !== false;
    const print = [bool(v, 'se') ? 'SE' : '', bool(v, 'coordinates') ? 'COORDINATES' : ''].filter(Boolean);
    return command('ROC', `${vars(v, 'variables').join(' ')} BY ${vars(v, 'state')[0]}(${stateLit(v, ctx)})`, [
      `PLOT=${curve ? `CURVE${v.reference !== false ? '(REFERENCE)' : ''}` : 'NONE'}`,
      print.length ? `PRINT=${print.join(' ')}` : '',
      wrap([`CRITERIA=CUTOFF(${str(v, 'cutoff') || 'INCLUDE'})`, `TESTPOS(${str(v, 'testpos') || 'LARGE'})`, `DISTRIBUTION(${str(v, 'distribution') || 'FREE'})`, `CI(${num(v, 'ci') ?? 95})`]),
      `MISSING=${str(v, 'missing') || 'EXCLUDE'}`,
    ].filter(Boolean));
  },
};
