/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec } from '../types';
import { command, vars, wrap } from '../syntaxUtil';

export const transpose: DialogSpec = {
  id: 'transpose',
  title: 'dlg.transpose.title',
  icon: 'flip',
  command: 'FLIP',
  fields: [
    { kind: 'info', label: 'dlg.transpose.info' },
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', min: 1 },
    { kind: 'varlist', id: 'newnames', label: 'dlg.transpose.newNames', max: 1 },
  ],
  toSyntax: (v) => {
    const nn = vars(v, 'newnames')[0];
    return command('FLIP', '', [wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]), nn && `NEWNAMES=${nn}`]);
  },
};
