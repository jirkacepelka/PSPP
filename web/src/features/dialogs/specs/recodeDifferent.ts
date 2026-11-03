/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, num, rows, wrap } from '../syntaxUtil';
import { formatMap, recodeMapField } from './recodeShared';
import { isValidVarName, quote } from '../../../lib/variables';

export const recodeDifferent: DialogSpec = {
  id: 'recodeDifferent',
  title: 'dlg.recodeDifferent.title',
  icon: 'alt_route',
  command: 'RECODE',
  size: 'wide',
  fields: [
    {
      kind: 'rows',
      id: 'pairs',
      label: 'dlg.recodeDifferent.pairs',
      minRows: 1,
      default: [{ src: '', dst: '', label: '' }],
      columns: [
        { id: 'src', label: 'dlg.recodeDifferent.input', type: 'variable' },
        { id: 'dst', label: 'dlg.recodeDifferent.output', type: 'text', placeholder: 'new_var' },
        { id: 'label', label: 'dlg.recodeDifferent.label', type: 'text' },
      ],
    },
    recodeMapField,
    { kind: 'checkbox', id: 'asString', label: 'dlg.recodeDifferent.asString' },
    { kind: 'number', id: 'width', label: 'dlg.compute.width', default: 8, min: 1, max: 32767, when: (v) => Boolean(v.asString) },
  ],
  validate: (v, ctx) => {
    const p = rows(v, 'pairs');
    if (!p.length || p.some((r) => !r.src || !r.dst)) return 'dlg.errors.recodePairs';
    if (p.some((r) => !isValidVarName(r.dst.trim()))) return 'dlg.errors.targetName';
    const types = new Set(p.map((r) => ctx.variables.find((x) => x.name === r.src)?.type));
    if (types.size > 1) return 'dlg.errors.mixedTypes';
    if (!rows(v, 'map').some((r) => r.from?.trim() && r.to?.trim())) return 'dlg.errors.recodeMap';
    return null;
  },
  toSyntax: (v, ctx) => {
    const p = rows(v, 'pairs').filter((r) => r.src && r.dst);
    const srcStr = ctx.variables.find((x) => x.name === p[0]?.src)?.type === 'string';
    const dstStr = bool(v, 'asString');
    const lines: string[] = [];
    const newTargets = p.map((r) => r.dst.trim()).filter((d) => !ctx.variables.some((x) => x.name.toUpperCase() === d.toUpperCase()));
    if (dstStr && newTargets.length) lines.push(`STRING ${newTargets.join(' ')} (A${Math.max(1, Math.round(num(v, 'width') ?? 8))}).`);
    const map = formatMap(rows(v, 'map'), srcStr, dstStr);
    lines.push(`${wrap(['RECODE', ...p.map((r) => r.src), ...map, 'INTO', ...p.map((r) => r.dst.trim())])}.`);
    const labels = p.filter((r) => r.label?.trim());
    if (labels.length) lines.push(`VARIABLE LABELS ${labels.map((r) => `${r.dst.trim()} ${quote(r.label.trim())}`).join('\n  /')}.`);
    lines.push('EXECUTE.');
    return lines.join('\n');
  },
};
