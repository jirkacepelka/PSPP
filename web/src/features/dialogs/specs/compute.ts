/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { num, str } from '../syntaxUtil';
import { isValidVarName, quote } from '../../../lib/variables';

export const compute: DialogSpec = {
  id: 'compute',
  kind: 'transform',
  title: 'dlg.compute.title',
  icon: 'calculate',
  command: 'COMPUTE',
  size: 'wide',
  fields: [
    { kind: 'text', id: 'target', label: 'dlg.compute.target', placeholder: 'new_var' },
    { kind: 'text', id: 'expression', label: 'dlg.compute.expression', mono: true, multiline: true, expression: true, placeholder: 'MEAN(x1, x2) * 10' },
    { kind: 'text', id: 'condition', label: 'dlg.compute.condition', mono: true, expression: true, hint: 'dlg.compute.conditionHint', placeholder: 'age >= 18' },
    {
      kind: 'subdialog',
      id: 'typeLabel',
      label: 'dlg.compute.typeLabelBtn',
      icon: 'label',
      fields: [
        { kind: 'text', id: 'label', label: 'dlg.compute.label' },
        {
          kind: 'radio',
          id: 'type',
          label: 'dlg.compute.type',
          default: 'numeric',
          inline: true,
          options: [
            { value: 'numeric', label: 'varType.numeric' },
            { value: 'string', label: 'varType.string' },
          ],
        },
        { kind: 'number', id: 'width', label: 'dlg.compute.width', default: 8, min: 1, max: 32767, when: (v) => v.type === 'string' },
      ],
    },
  ],
  errorFields: { 'dlg.errors.targetName': 'target', 'dlg.errors.expression': 'expression' },
  validate: (v) => {
    if (!isValidVarName(str(v, 'target'))) return 'dlg.errors.targetName';
    if (!str(v, 'expression')) return 'dlg.errors.expression';
    return null;
  },
  toSyntax: (v, ctx) => {
    const target = str(v, 'target');
    const exists = ctx.variables.some((x) => x.name.toUpperCase() === target.toUpperCase());
    const lines: string[] = [];
    if (!exists && v.type === 'string') lines.push(`STRING ${target} (A${Math.max(1, Math.round(num(v, 'width') ?? 8))}).`);
    const expr = str(v, 'expression').replace(/\s*\n\s*/g, ' ');
    const cond = str(v, 'condition');
    lines.push(cond ? `IF (${cond}) ${target} = ${expr}.` : `COMPUTE ${target} = ${expr}.`);
    const label = str(v, 'label');
    if (label) lines.push(`VARIABLE LABELS ${target} ${quote(label)}.`);
    lines.push('EXECUTE.');
    return lines.join('\n');
  },
};
