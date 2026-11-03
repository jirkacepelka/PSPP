/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { num, str } from '../syntaxUtil';
import { quote } from '../../../lib/variables';

export const selectCases: DialogSpec = {
  id: 'selectCases',
  kind: 'data',
  title: 'dlg.selectCases.title',
  icon: 'filter_alt',
  command: 'SELECT IF',
  size: 'wide',
  fields: [
    {
      kind: 'radio',
      id: 'mode',
      label: 'dlg.selectCases.select',
      default: 'if',
      options: [
        { value: 'all', label: 'dlg.selectCases.all' },
        { value: 'if', label: 'dlg.selectCases.ifCondition' },
        { value: 'range', label: 'dlg.selectCases.range' },
        { value: 'random', label: 'dlg.selectCases.random' },
      ],
    },
    { kind: 'text', id: 'condition', label: 'dlg.selectCases.condition', mono: true, expression: true, placeholder: 'gender = 1 AND age > 20', when: (v) => v.mode === 'if' },
    {
      kind: 'group',
      columns: 2,
      when: (v) => v.mode === 'range',
      fields: [
        { kind: 'number', id: 'first', label: 'dlg.selectCases.first', default: 1, min: 1 },
        { kind: 'number', id: 'last', label: 'dlg.selectCases.last', default: null, min: 1 },
      ],
    },
    {
      kind: 'group',
      when: (v) => v.mode === 'random',
      fields: [
        {
          kind: 'radio',
          id: 'sampleType',
          label: 'dlg.selectCases.sampleSize',
          default: 'approx',
          inline: true,
          options: [
            { value: 'approx', label: 'dlg.selectCases.approx' },
            { value: 'exact', label: 'dlg.selectCases.exact' },
          ],
        },
        { kind: 'number', id: 'percent', label: 'dlg.selectCases.percent', default: 10, min: 0.01, max: 100, when: (v) => v.sampleType !== 'exact' },
        {
          kind: 'group',
          columns: 2,
          when: (v) => v.sampleType === 'exact',
          fields: [
            { kind: 'number', id: 'n', label: 'dlg.selectCases.exactN', default: null, min: 1 },
            { kind: 'number', id: 'from', label: 'dlg.selectCases.fromFirst', default: null, min: 1 },
          ],
        },
      ],
    },
    {
      kind: 'radio',
      id: 'output',
      label: 'dlg.selectCases.output',
      default: 'filter',
      when: (v) => v.mode !== 'all',
      options: [
        { value: 'filter', label: 'dlg.selectCases.filter' },
        { value: 'delete', label: 'dlg.selectCases.delete' },
      ],
    },
  ],
  validate: (v) => {
    if (v.mode === 'if' && !str(v, 'condition')) return 'dlg.errors.condition';
    if (v.mode === 'range' && (num(v, 'first') === null || num(v, 'last') === null || num(v, 'first')! > num(v, 'last')!)) return 'dlg.errors.range';
    if (v.mode === 'random' && v.sampleType === 'exact' && (num(v, 'n') === null || num(v, 'from') === null || num(v, 'n')! > num(v, 'from')!)) return 'dlg.errors.sample';
    if (v.mode === 'random' && v.sampleType !== 'exact' && !num(v, 'percent')) return 'dlg.errors.sample';
    return null;
  },
  toSyntax: (v) => {
    const mode = str(v, 'mode');
    if (mode === 'all') return 'FILTER OFF.\nUSE ALL.\nEXECUTE.';
    const del = v.output === 'delete';
    let cond = '';
    let label = '';
    if (mode === 'if') {
      cond = str(v, 'condition').replace(/\s*\n\s*/g, ' ');
      label = cond;
    } else if (mode === 'range') {
      cond = `$CASENUM >= ${num(v, 'first')} AND $CASENUM <= ${num(v, 'last')}`;
      label = `$CASENUM ${num(v, 'first')}–${num(v, 'last')}`;
    } else if (mode === 'random') {
      if (v.sampleType === 'exact') {
        const n = Math.round(num(v, 'n')!);
        const from = Math.round(num(v, 'from')!);
        if (del) return `SAMPLE ${n} FROM ${from}.\nEXECUTE.`;
        return [
          'DO IF $CASENUM = 1.',
          `  COMPUTE #s_left = ${n}.`,
          `  COMPUTE #s_total = ${from}.`,
          'END IF.',
          'DO IF #s_total > 0.',
          '  COMPUTE filter_$ = UNIFORM(1) * #s_total < #s_left.',
          '  COMPUTE #s_left = #s_left - filter_$.',
          '  COMPUTE #s_total = #s_total - 1.',
          'ELSE.',
          '  COMPUTE filter_$ = 0.',
          'END IF.',
          `VARIABLE LABELS filter_$ ${quote(`Exactly ${n} cases from the first ${from} (SAMPLE)`)}.`,
          'FORMATS filter_$ (F1.0).',
          'FILTER BY filter_$.',
          'EXECUTE.',
        ].join('\n');
      }
      const p = num(v, 'percent')! / 100;
      if (del) return `SAMPLE ${Number(p.toFixed(6))}.\nEXECUTE.`;
      cond = `UNIFORM(1) <= ${Number(p.toFixed(6))}`;
      label = `Approximately ${num(v, 'percent')}% of cases (SAMPLE)`;
    }
    if (del) return `SELECT IF (${cond}).\nEXECUTE.`;
    return [
      `COMPUTE filter_$ = (${cond}).`,
      `VARIABLE LABELS filter_$ ${quote(`${label} (FILTER)`)}.`,
      "VALUE LABELS filter_$ 0 'Not selected' 1 'Selected'.",
      'FORMATS filter_$ (F1.0).',
      'FILTER BY filter_$.',
      'EXECUTE.',
    ].join('\n');
  },
};
