/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { rows, str, vars, wrap } from '../syntaxUtil';
import { formatOld } from './recodeShared';
import { isValidVarName, quote } from '../../../lib/variables';

export const count: DialogSpec = {
  id: 'count',
  kind: 'transform',
  title: 'dlg.count.title',
  icon: 'pin',
  command: 'COUNT',
  size: 'wide',
  fields: [
    {
      kind: 'group',
      columns: 2,
      fields: [
        { kind: 'text', id: 'target', label: 'dlg.count.target', placeholder: 'n_yes' },
        { kind: 'text', id: 'label', label: 'dlg.count.label' },
      ],
    },
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', min: 1 },
    {
      kind: 'rows',
      id: 'values',
      label: 'dlg.count.values',
      hint: 'dlg.count.valuesHint',
      minRows: 1,
      default: [{ value: '' }],
      columns: [{ id: 'value', label: 'dlg.count.value', type: 'text', placeholder: '1  ·  1 THRU 3  ·  MISSING' }],
    },
  ],
  validate: (v, ctx) => {
    if (!isValidVarName(str(v, 'target'))) return 'dlg.errors.targetName';
    const types = new Set(vars(v, 'variables').map((n) => ctx.variables.find((x) => x.name === n)?.type));
    if (types.size > 1) return 'dlg.errors.mixedTypes';
    if (!rows(v, 'values').length) return 'dlg.errors.countValues';
    return null;
  },
  toSyntax: (v, ctx) => {
    const list = vars(v, 'variables');
    const isStr = ctx.variables.find((x) => x.name === list[0])?.type === 'string';
    const values = rows(v, 'values').map((r) => formatOld(r.value ?? '', isStr)).filter(Boolean);
    const target = str(v, 'target');
    const lines = [`${wrap(['COUNT', target, '=', ...list, `(${values.join(' ')})`])}.`];
    if (str(v, 'label')) lines.push(`VARIABLE LABELS ${target} ${quote(str(v, 'label'))}.`);
    lines.push('EXECUTE.');
    return lines.join('\n');
  },
};
