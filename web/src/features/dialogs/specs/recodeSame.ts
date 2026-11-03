/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { rows, vars, wrap } from '../syntaxUtil';
import { formatMap, recodeMapField } from './recodeShared';

export const recodeSame: DialogSpec = {
  id: 'recodeSame',
  title: 'dlg.recodeSame.title',
  icon: 'swap_vert',
  command: 'RECODE',
  size: 'wide',
  fields: [{ kind: 'varlist', id: 'variables', label: 'dlg.common.variables', min: 1 }, recodeMapField],
  validate: (v, ctx) => {
    const sel = vars(v, 'variables').map((n) => ctx.variables.find((x) => x.name === n)?.type);
    if (new Set(sel).size > 1) return 'dlg.errors.mixedTypes';
    if (!rows(v, 'map').some((r) => r.from?.trim() && r.to?.trim())) return 'dlg.errors.recodeMap';
    return null;
  },
  toSyntax: (v, ctx) => {
    const list = vars(v, 'variables');
    const isStr = ctx.variables.find((x) => x.name === list[0])?.type === 'string';
    const map = formatMap(rows(v, 'map'), isStr, isStr);
    return `${wrap(['RECODE', ...list, ...map])}.\nEXECUTE.`;
  },
};
