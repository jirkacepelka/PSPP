/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { vars } from '../syntaxUtil';

export const weightCases: DialogSpec = {
  id: 'weightCases',
  title: 'dlg.weightCases.title',
  icon: 'scale',
  command: 'WEIGHT',
  source: 'numeric',
  fields: [
    {
      kind: 'radio',
      id: 'mode',
      label: 'dlg.weightCases.mode',
      default: 'by',
      options: [
        { value: 'off', label: 'dlg.weightCases.off' },
        { value: 'by', label: 'dlg.weightCases.by' },
      ],
    },
    { kind: 'varlist', id: 'weight', label: 'dlg.weightCases.variable', filter: 'numeric', max: 1, min: 1, when: (v) => v.mode === 'by' },
  ],
  toSyntax: (v) => (v.mode === 'off' ? 'WEIGHT OFF.' : `WEIGHT BY ${vars(v, 'weight')[0]}.`),
};
