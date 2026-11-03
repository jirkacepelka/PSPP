/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, rows, str, wrap } from '../syntaxUtil';
import { isValidVarName } from '../../../lib/variables';

export const autorecode: DialogSpec = {
  id: 'autorecode',
  title: 'dlg.autorecode.title',
  icon: 'auto_fix_high',
  command: 'AUTORECODE',
  size: 'wide',
  fields: [
    {
      kind: 'rows',
      id: 'pairs',
      label: 'dlg.autorecode.pairs',
      minRows: 1,
      default: [{ src: '', dst: '' }],
      columns: [
        { id: 'src', label: 'dlg.recodeDifferent.input', type: 'variable' },
        { id: 'dst', label: 'dlg.autorecode.newName', type: 'text', placeholder: 'new_var' },
      ],
    },
    {
      kind: 'radio',
      id: 'order',
      label: 'dlg.autorecode.recodeStarting',
      default: 'asc',
      inline: true,
      options: [
        { value: 'asc', label: 'dlg.autorecode.lowest' },
        { value: 'desc', label: 'dlg.autorecode.highest' },
      ],
    },
    { kind: 'checkbox', id: 'group', label: 'dlg.autorecode.group' },
    { kind: 'checkbox', id: 'blankMissing', label: 'dlg.autorecode.blankMissing' },
    { kind: 'checkbox', id: 'print', label: 'dlg.autorecode.print' },
  ],
  validate: (v, ctx) => {
    const p = rows(v, 'pairs');
    if (!p.length || p.some((r) => !r.src || !r.dst)) return 'dlg.errors.recodePairs';
    if (p.some((r) => !isValidVarName(r.dst.trim()) || ctx.variables.some((x) => x.name.toUpperCase() === r.dst.trim().toUpperCase()))) return 'dlg.errors.newTargetName';
    return null;
  },
  toSyntax: (v) => {
    const p = rows(v, 'pairs').filter((r) => r.src && r.dst);
    const lines = [`AUTORECODE ${wrap([`VARIABLES=${p.map((r) => r.src).join(' ')}`, 'INTO', ...p.map((r) => r.dst.trim())])}`];
    if (str(v, 'order') === 'desc') lines.push('  /DESCENDING');
    if (bool(v, 'group')) lines.push('  /GROUP');
    if (bool(v, 'blankMissing')) lines.push('  /BLANK=MISSING');
    if (bool(v, 'print')) lines.push('  /PRINT');
    return `${lines.join('\n')}.`;
  },
};
