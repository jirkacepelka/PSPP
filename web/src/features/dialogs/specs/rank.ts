/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { bool, num, str, vars, wrap } from '../syntaxUtil';

const FUNCS = ['RANK', 'NTILES', 'PERCENT', 'RFRACTION', 'PROPORTION', 'N', 'NORMAL', 'SAVAGE'];

export const rank: DialogSpec = {
  id: 'rank',
  kind: 'transform',
  title: 'dlg.rank.title',
  icon: 'format_list_numbered',
  command: 'RANK',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', filter: 'numeric', min: 1 },
    { kind: 'varlist', id: 'by', label: 'dlg.rank.by' },
    {
      kind: 'radio',
      id: 'order',
      label: 'dlg.rank.assign1',
      default: 'A',
      inline: true,
      options: [
        { value: 'A', label: 'dlg.rank.smallest' },
        { value: 'D', label: 'dlg.rank.largest' },
      ],
    },
    { kind: 'checkbox', id: 'print', label: 'dlg.rank.print', default: true },
    {
      kind: 'subdialog',
      id: 'types',
      label: 'dlg.rank.typesBtn',
      icon: 'checklist',
      fields: [
        {
          kind: 'group',
          columns: 2,
          fields: [
            { kind: 'checkbox', id: 'f_RANK', label: 'dlg.rank.rank', default: true },
            { kind: 'checkbox', id: 'f_NTILES', label: 'dlg.rank.ntiles' },
            { kind: 'checkbox', id: 'f_PERCENT', label: 'dlg.rank.percent' },
            { kind: 'checkbox', id: 'f_RFRACTION', label: 'dlg.rank.rfraction' },
            { kind: 'checkbox', id: 'f_PROPORTION', label: 'dlg.rank.proportion' },
            { kind: 'checkbox', id: 'f_N', label: 'dlg.rank.n' },
            { kind: 'checkbox', id: 'f_NORMAL', label: 'dlg.rank.normal' },
            { kind: 'checkbox', id: 'f_SAVAGE', label: 'dlg.rank.savage' },
          ],
        },
        { kind: 'number', id: 'k', label: 'dlg.rank.k', default: 4, min: 2, max: 1000, when: (v) => Boolean(v.f_NTILES) },
        {
          kind: 'radio',
          id: 'fraction',
          label: 'dlg.rank.fraction',
          default: 'BLOM',
          inline: true,
          when: (v) => Boolean(v.f_PROPORTION || v.f_NORMAL),
          options: [
            { value: 'BLOM', label: 'Blom', },
            { value: 'TUKEY', label: 'Tukey' },
            { value: 'RANKIT', label: 'Rankit' },
            { value: 'VW', label: 'Van der Waerden' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'ties',
      label: 'dlg.rank.tiesBtn',
      icon: 'drag_handle',
      fields: [
        {
          kind: 'radio',
          id: 'ties',
          label: 'dlg.rank.ties',
          default: 'MEAN',
          options: [
            { value: 'MEAN', label: 'dlg.rank.tieMean' },
            { value: 'LOW', label: 'dlg.rank.tieLow' },
            { value: 'HIGH', label: 'dlg.rank.tieHigh' },
            { value: 'CONDENSE', label: 'dlg.rank.tieCondense' },
          ],
        },
      ],
    },
  ],
  validate: (v) => (FUNCS.some((f) => bool(v, `f_${f}`)) ? null : 'dlg.errors.rankFunction'),
  toSyntax: (v) => {
    const by = vars(v, 'by');
    const head = wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`, `(${str(v, 'order') || 'A'})`, ...(by.length ? ['BY', ...by] : [])]);
    const subs = FUNCS.filter((f) => bool(v, `f_${f}`)).map((f) => (f === 'NTILES' ? `NTILES(${Math.round(num(v, 'k') ?? 4)})` : f));
    const lines = [`RANK ${head}`, ...subs.map((s) => `  /${s}`)];
    lines.push(`  /TIES=${str(v, 'ties') || 'MEAN'}`);
    if (bool(v, 'f_PROPORTION') || bool(v, 'f_NORMAL')) lines.push(`  /FRACTION=${str(v, 'fraction') || 'BLOM'}`);
    lines.push(`  /PRINT=${bool(v, 'print') ? 'YES' : 'NO'}.`);
    return lines.join('\n');
  },
};
