/*
 * Custom tables (CTABLES, basic) and define variable properties.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { bool, rows, str, vars, wrap, lit } from '../syntaxUtil';
import { quote } from '../../../lib/variables';

export const ctables: DialogSpec = {
  id: 'ctables',
  kind: 'analysis',
  title: 'dlg.ctables.title',
  icon: 'table_chart',
  command: 'CTABLES',
  fields: [
    { kind: 'varlist', id: 'rows', label: 'dlg.ctables.rows', min: 1 },
    { kind: 'varlist', id: 'cols', label: 'dlg.ctables.cols', prefer: ['nominal', 'ordinal'] },
    {
      kind: 'group',
      label: 'dlg.ctables.catStats',
      columns: 2,
      fields: [
        { kind: 'checkbox', id: 'count', label: 'dlg.ctables.count', default: true },
        { kind: 'checkbox', id: 'colpct', label: 'dlg.ctables.colpct' },
        { kind: 'checkbox', id: 'rowpct', label: 'dlg.ctables.rowpct' },
        { kind: 'checkbox', id: 'totalpct', label: 'dlg.ctables.totalpct' },
      ],
    },
    {
      kind: 'group',
      label: 'dlg.ctables.scaleStats',
      columns: 2,
      fields: [
        { kind: 'checkbox', id: 'mean', label: 'stat.mean', default: true },
        { kind: 'checkbox', id: 'sd', label: 'stat.stddev', default: true },
        { kind: 'checkbox', id: 'median', label: 'stat.median' },
        { kind: 'checkbox', id: 'n', label: 'dlg.ctables.n' },
      ],
    },
    { kind: 'checkbox', id: 'totals', label: 'dlg.ctables.totals', default: true },
  ],
  toSyntax: (v, ctx) => {
    const isScale = (n: string) => ctx.variables.find((x) => x.name === n)?.measure === 'scale';
    const cat = [bool(v, 'count') && 'COUNT', bool(v, 'colpct') && 'COLPCT', bool(v, 'rowpct') && 'ROWPCT', bool(v, 'totalpct') && 'TABLEPCT'].filter(Boolean);
    const sc = [bool(v, 'mean') && 'MEAN', bool(v, 'sd') && 'STDDEV', bool(v, 'median') && 'MEDIAN', bool(v, 'n') && 'COUNT'].filter(Boolean);
    const term = (n: string) => {
      const s = isScale(n) ? (sc.length ? sc : ['MEAN']) : cat.length ? cat : ['COUNT'];
      return `${n}${isScale(n) ? ' [S]' : ' [C]'} [${s.join(', ')}]`;
    };
    const cols = vars(v, 'cols');
    const lines = [`CTABLES`, `  /TABLE=${wrap([vars(v, 'rows').map(term).join(' + '), ...(cols.length ? ['BY', cols.map((c) => `${c} [C]`).join(' + ')] : [])])}`];
    const catVars = [...vars(v, 'rows').filter((n) => !isScale(n)), ...cols];
    if (bool(v, 'totals') && catVars.length) lines.push(`  /CATEGORIES VARIABLES=${catVars.join(' ')} TOTAL=YES`);
    return `${lines.join('\n')}.`;
  },
};

export const variableProperties: DialogSpec = {
  id: 'variableProperties',
  kind: 'data',
  title: 'dlg.variableProperties.title',
  icon: 'tune',
  command: 'VARIABLE LEVEL',
  size: 'wide',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', min: 1 },
    {
      kind: 'group',
      columns: 2,
      fields: [
        {
          kind: 'select',
          id: 'measure',
          label: 'dlg.variableProperties.measure',
          default: '',
          options: [
            { value: '', label: 'dlg.variableProperties.keep' },
            { value: 'NOMINAL', label: 'measure.nominal' },
            { value: 'ORDINAL', label: 'measure.ordinal' },
            { value: 'SCALE', label: 'measure.scale' },
          ],
        },
        {
          kind: 'select',
          id: 'role',
          label: 'dlg.variableProperties.role',
          default: '',
          options: [
            { value: '', label: 'dlg.variableProperties.keep' },
            { value: 'INPUT', label: 'role.input' },
            { value: 'TARGET', label: 'role.target' },
            { value: 'BOTH', label: 'role.both' },
            { value: 'NONE', label: 'role.none' },
            { value: 'PARTITION', label: 'role.partition' },
            { value: 'SPLIT', label: 'role.split' },
          ],
        },
      ],
    },
    { kind: 'text', id: 'label', label: 'dlg.variableProperties.label', hint: 'dlg.variableProperties.labelHint', when: (v) => vars(v, 'variables').length === 1 },
    {
      kind: 'rows',
      id: 'labels',
      label: 'dlg.variableProperties.valueLabels',
      columns: [
        { id: 'value', label: 'dlg.variableProperties.value', type: 'text', width: '120px' },
        { id: 'label', label: 'dlg.variableProperties.valueLabel', type: 'text' },
      ],
    },
    { kind: 'checkbox', id: 'replace', label: 'dlg.variableProperties.replace' },
    { kind: 'text', id: 'missing', label: 'dlg.variableProperties.missing', hint: 'dlg.variableProperties.missingHint' },
  ],
  errorFields: { 'dlg.errors.mixedTypes': 'variables' },
  validate: (v, ctx) => {
    const types = new Set(vars(v, 'variables').map((n) => ctx.variables.find((x) => x.name === n)?.type));
    if (types.size > 1 && (rows(v, 'labels').length || str(v, 'missing'))) return 'dlg.errors.mixedTypes';
    const any = str(v, 'measure') || str(v, 'role') || str(v, 'label') || rows(v, 'labels').length || bool(v, 'replace') || str(v, 'missing');
    return any ? null : 'dlg.errors.nothingToDo';
  },
  toSyntax: (v, ctx) => {
    const list = vars(v, 'variables');
    const names = list.join(' ');
    const isStr = ctx.variables.find((x) => x.name === list[0])?.type === 'string';
    const out: string[] = [];
    if (str(v, 'measure')) out.push(`VARIABLE LEVEL ${names} (${str(v, 'measure')}).`);
    if (str(v, 'role')) out.push(`VARIABLE ROLE /${str(v, 'role')} ${names}.`);
    if (list.length === 1 && str(v, 'label')) out.push(`VARIABLE LABELS ${names} ${quote(str(v, 'label'))}.`);
    const labels = rows(v, 'labels').filter((r) => String(r.value ?? '').trim() !== '');
    if (labels.length || bool(v, 'replace')) {
      const pairs = labels.map((r) => `${lit(String(r.value), isStr)} ${quote(String(r.label ?? ''))}`).join(' ');
      if (bool(v, 'replace')) out.push(`VALUE LABELS ${names}${pairs ? ` ${pairs}` : ''}.`);
      else if (pairs) out.push(`ADD VALUE LABELS ${names} ${pairs}.`);
    }
    const miss = str(v, 'missing');
    if (miss) {
      if (/^none$/i.test(miss)) out.push(`MISSING VALUES ${names} ().`);
      else {
        const toks = miss.split(/[\s;]+|,\s*(?=\S)/).filter(Boolean);
        const parts: string[] = [];
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i];
          if (/^thru$/i.test(t) && parts.length && i + 1 < toks.length) {
            const hi = toks[++i];
            parts[parts.length - 1] += ` THRU ${/^(hi|highest)$/i.test(hi) ? 'HIGHEST' : lit(hi, isStr)}`;
          } else parts.push(/^(lo|lowest)$/i.test(t) ? 'LOWEST' : lit(t, isStr));
        }
        out.push(`MISSING VALUES ${names} (${parts.join(', ')}).`);
      }
    }
    return out.join('\n');
  },
};
