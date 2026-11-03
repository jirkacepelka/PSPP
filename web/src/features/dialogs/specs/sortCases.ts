/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { str, vars, wrap } from '../syntaxUtil';

export const sortCases: DialogSpec = {
  id: 'sortCases',
  title: 'dlg.sortCases.title',
  icon: 'sort',
  command: 'SORT CASES',
  fields: [
    { kind: 'varlist', id: 'by', label: 'dlg.sortCases.sortBy', min: 1 },
    {
      kind: 'radio',
      id: 'order',
      label: 'dlg.sortCases.order',
      default: 'A',
      inline: true,
      options: [
        { value: 'A', label: 'dlg.sortCases.ascending' },
        { value: 'D', label: 'dlg.sortCases.descending' },
      ],
    },
  ],
  toSyntax: (v) => {
    const o = str(v, 'order') === 'D' ? 'D' : 'A';
    return `${wrap(['SORT CASES BY', ...vars(v, 'by').map((n) => `${n} (${o})`)])}.`;
  },
};
