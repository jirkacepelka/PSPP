/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { command, rows, str, wrap } from '../syntaxUtil';
import { ciCriteria, ttestOptions } from './ttestOneSample';

export const ttestPaired: DialogSpec = {
  id: 'ttestPaired',
  title: 'dlg.ttestPaired.title',
  icon: 'swap_horiz',
  command: 'T-TEST',
  source: 'numeric',
  fields: [
    {
      kind: 'rows',
      id: 'pairs',
      label: 'dlg.ttestPaired.pairs',
      minRows: 1,
      default: [{ a: '', b: '' }],
      columns: [
        { id: 'a', label: 'dlg.ttestPaired.variable1', type: 'variable', filter: 'numeric' },
        { id: 'b', label: 'dlg.ttestPaired.variable2', type: 'variable', filter: 'numeric' },
      ],
    },
    ttestOptions,
  ],
  validate: (v) => {
    const p = rows(v, 'pairs');
    if (!p.length || p.some((r) => !r.a || !r.b)) return 'dlg.errors.pairs';
    if (p.some((r) => r.a === r.b)) return 'dlg.errors.pairSame';
    return null;
  },
  toSyntax: (v) => {
    const p = rows(v, 'pairs').filter((r) => r.a && r.b);
    return command('T-TEST', '', [
      wrap([`PAIRS=${p.map((r) => r.a).join(' ')}`, 'WITH', `${p.map((r) => r.b).join(' ')}`, '(PAIRED)']),
      `MISSING=${str(v, 'missing') || 'ANALYSIS'}`,
      ciCriteria(v),
    ]);
  },
};
