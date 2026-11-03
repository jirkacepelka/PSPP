/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, vars, wrap } from '../syntaxUtil';

export const splitFile: DialogSpec = {
  id: 'splitFile',
  kind: 'data',
  title: 'dlg.splitFile.title',
  icon: 'call_split',
  command: 'SPLIT FILE',
  fields: [
    {
      kind: 'radio',
      id: 'mode',
      label: 'dlg.splitFile.mode',
      default: 'LAYERED',
      options: [
        { value: 'off', label: 'dlg.splitFile.off' },
        { value: 'LAYERED', label: 'dlg.splitFile.layered' },
        { value: 'SEPARATE', label: 'dlg.splitFile.separate' },
      ],
    },
    { kind: 'varlist', id: 'groups', label: 'dlg.splitFile.groups', min: 1, when: (v) => v.mode !== 'off' },
    { kind: 'checkbox', id: 'sort', label: 'dlg.splitFile.sort', default: true, when: (v) => v.mode !== 'off' },
  ],
  toSyntax: (v) => {
    if (v.mode === 'off') return 'SPLIT FILE OFF.';
    const g = vars(v, 'groups');
    const lines: string[] = [];
    if (bool(v, 'sort')) lines.push(`${wrap(['SORT CASES BY', ...g])}.`);
    lines.push(`${wrap([`SPLIT FILE ${v.mode === 'SEPARATE' ? 'SEPARATE' : 'LAYERED'} BY`, ...g])}.`);
    return lines.join('\n');
  },
};
