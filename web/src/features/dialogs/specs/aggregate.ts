/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, rows, str, vars, wrap } from '../syntaxUtil';
import { isValidVarName, quote } from '../../../lib/variables';

const FUNCTIONS = ['MEAN', 'MEDIAN', 'SUM', 'SD', 'MIN', 'MAX', 'N', 'NU', 'NMISS', 'NUMISS', 'FIRST', 'LAST'];
const NO_ARG = ['N', 'NU'];

export const aggregate: DialogSpec = {
  id: 'aggregate',
  title: 'dlg.aggregate.title',
  icon: 'merge',
  command: 'AGGREGATE',
  size: 'xwide',
  fields: [
    { kind: 'varlist', id: 'break', label: 'dlg.aggregate.break' },
    {
      kind: 'rows',
      id: 'functions',
      label: 'dlg.aggregate.functions',
      minRows: 1,
      default: [{ target: '', func: 'MEAN', source: '', label: '' }],
      columns: [
        { id: 'target', label: 'dlg.aggregate.target', type: 'text', placeholder: 'mean_x' },
        { id: 'func', label: 'dlg.aggregate.function', type: 'select', options: FUNCTIONS.map((f) => ({ value: f, label: `agg.${f}` })) },
        { id: 'source', label: 'dlg.aggregate.source', type: 'variable' },
        { id: 'label', label: 'dlg.aggregate.label', type: 'text' },
      ],
    },
    {
      kind: 'radio',
      id: 'dest',
      label: 'dlg.aggregate.destination',
      default: 'add',
      options: [
        { value: 'add', label: 'dlg.aggregate.addVariables' },
        { value: 'replace', label: 'dlg.aggregate.replace' },
      ],
    },
    { kind: 'checkbox', id: 'nBreak', label: 'dlg.aggregate.nBreak' },
    { kind: 'text', id: 'nBreakName', label: 'dlg.aggregate.nBreakName', default: 'N_BREAK', when: (v) => Boolean(v.nBreak) },
    { kind: 'checkbox', id: 'presorted', label: 'dlg.aggregate.presorted' },
  ],
  validate: (v) => {
    const f = rows(v, 'functions');
    if (!f.length && !bool(v, 'nBreak')) return 'dlg.errors.aggregateFunctions';
    for (const r of f) {
      if (!isValidVarName((r.target ?? '').trim())) return 'dlg.errors.targetName';
      if (!NO_ARG.includes(r.func) && !r.source) return 'dlg.errors.aggregateSource';
    }
    if (bool(v, 'nBreak') && !isValidVarName(str(v, 'nBreakName'))) return 'dlg.errors.targetName';
    return null;
  },
  toSyntax: (v) => {
    const head = v.dest === 'replace' ? 'OUTFILE=*' : 'OUTFILE=* MODE=ADDVARIABLES';
    const subs: string[] = [];
    if (bool(v, 'presorted')) subs.push('PRESORTED');
    const b = vars(v, 'break');
    if (b.length) subs.push(wrap([`BREAK=${b.join(' ')}`]));
    for (const r of rows(v, 'functions')) {
      const label = r.label?.trim() ? ` ${quote(r.label.trim())}` : '';
      const fn = r.func || 'MEAN';
      const arg = r.source ? `(${r.source})` : '';
      subs.push(`${r.target.trim()}${label}=${fn}${NO_ARG.includes(fn) && !r.source ? '' : arg}`);
    }
    if (bool(v, 'nBreak')) subs.push(`${str(v, 'nBreakName') || 'N_BREAK'}=N`);
    return `AGGREGATE ${head}\n${subs.map((s) => `  /${s}`).join('\n')}.`;
  },
};
