/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec, Field } from '../types';
import { command, num, str, vars, wrap } from '../syntaxUtil';

export const ttestOptions: Field = {
  kind: 'subdialog',
  id: 'options',
  label: 'dlg.common.optionsBtn',
  icon: 'tune',
  fields: [
    { kind: 'number', id: 'ci', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99, step: 1 },
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
};

export function ciCriteria(v: Record<string, unknown>): string {
  const ci = num(v, 'ci') ?? 95;
  return `CRITERIA=CI(${Number((ci / 100).toFixed(4))})`;
}

export const ttestOneSample: DialogSpec = {
  id: 'ttestOneSample',
  title: 'dlg.ttestOneSample.title',
  icon: 'straighten',
  command: 'T-TEST',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1 },
    { kind: 'number', id: 'testValue', label: 'dlg.ttestOneSample.testValue', default: 0, step: 0.1 },
    ttestOptions,
  ],
  validate: (v) => (num(v, 'testValue') === null ? 'dlg.errors.testValue' : null),
  toSyntax: (v) =>
    command('T-TEST', '', [
      `TESTVAL=${num(v, 'testValue') ?? 0}`,
      wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]),
      `MISSING=${str(v, 'missing') || 'ANALYSIS'}`,
      ciCriteria(v),
    ]),
};
