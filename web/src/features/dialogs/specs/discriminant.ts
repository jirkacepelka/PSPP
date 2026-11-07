/*
 * Discriminant analysis (DISCRIMINANT, computed in the browser by src/ext/commands/discriminant.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, Values } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

const STATS = ['MEAN', 'UNIVF', 'BOXM', 'COEFF', 'RAW', 'CORR', 'COV', 'GCOV', 'TCOV'] as const;
const check = (id: string) => ({ kind: 'checkbox' as const, id: `st_${id}`, label: `dlg.discriminant.st_${id}` });
const stepwise = (v: Values) => v.method === 'WILKS';
const useP = (v: Values) => v.criterion === 'P';
const crit = (v: Values) => {
  const p = useP(v);
  return { fin: num(v, p ? 'pin' : 'fin') ?? (p ? 0.05 : 3.84), fout: num(v, p ? 'pout' : 'fout') ?? (p ? 0.1 : 2.71) };
};

export const discriminant: DialogSpec = {
  id: 'discriminant',
  kind: 'analysis',
  title: 'dlg.discriminant.title',
  icon: 'scatter_plot',
  command: 'DISCRIMINANT',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'group', label: 'dlg.discriminant.grouping', filter: 'numeric', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'groupvalues', source: 'group', ids: ['lo', 'hi'], labels: ['dlg.discriminant.min', 'dlg.discriminant.max'], mode: 'range' },
    { kind: 'varlist', id: 'independents', label: 'dlg.discriminant.independents', filter: 'numeric', min: 1, prefer: ['scale'] },
    {
      kind: 'radio',
      id: 'method',
      label: 'dlg.discriminant.method',
      default: 'DIRECT',
      options: [
        { value: 'DIRECT', label: 'dlg.discriminant.enter' },
        { value: 'WILKS', label: 'dlg.discriminant.stepwise' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'statisticsTab',
      label: 'dlg.discriminant.statisticsBtn',
      icon: 'table_chart',
      fields: [
        { kind: 'group', label: 'dlg.discriminant.descriptives', fields: [check('MEAN'), check('UNIVF'), check('BOXM')] },
        { kind: 'group', label: 'dlg.discriminant.functionCoef', fields: [check('COEFF'), check('RAW')] },
        { kind: 'group', label: 'dlg.discriminant.matrices', fields: [check('CORR'), check('COV'), check('GCOV'), check('TCOV')] },
      ],
    },
    {
      kind: 'subdialog',
      id: 'methodTab',
      label: 'dlg.discriminant.methodBtn',
      icon: 'tune',
      when: stepwise,
      fields: [
        {
          kind: 'radio',
          id: 'criterion',
          label: 'dlg.discriminant.criteria',
          default: 'F',
          options: [
            { value: 'F', label: 'dlg.discriminant.useF' },
            { value: 'P', label: 'dlg.discriminant.useP' },
          ],
        },
        {
          kind: 'group',
          columns: 2,
          when: (v) => !useP(v),
          fields: [
            { kind: 'number', id: 'fin', label: 'dlg.discriminant.fin', default: 3.84, min: 0, step: 0.01 },
            { kind: 'number', id: 'fout', label: 'dlg.discriminant.fout', default: 2.71, min: 0, step: 0.01 },
          ],
        },
        {
          kind: 'group',
          columns: 2,
          when: useP,
          fields: [
            { kind: 'number', id: 'pin', label: 'dlg.discriminant.fin', default: 0.05, min: 0, max: 1, step: 0.01 },
            { kind: 'number', id: 'pout', label: 'dlg.discriminant.fout', default: 0.1, min: 0, max: 1, step: 0.01 },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'classifyTab',
      label: 'dlg.discriminant.classifyBtn',
      icon: 'category',
      fields: [
        {
          kind: 'radio',
          id: 'priors',
          label: 'dlg.discriminant.priors',
          default: 'EQUAL',
          options: [
            { value: 'EQUAL', label: 'dlg.discriminant.priorsEqual' },
            { value: 'SIZE', label: 'dlg.discriminant.priorsSize' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.discriminant.display',
          fields: [
            { kind: 'checkbox', id: 'casewise', label: 'dlg.discriminant.casewise' },
            { kind: 'checkbox', id: 'table', label: 'dlg.discriminant.table', default: true },
            { kind: 'checkbox', id: 'crossvalid', label: 'dlg.discriminant.crossvalid' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.discriminant.plots',
          fields: [
            { kind: 'checkbox', id: 'combined', label: 'dlg.discriminant.combined' },
            { kind: 'checkbox', id: 'separate', label: 'dlg.discriminant.separate' },
            { kind: 'info', label: 'dlg.discriminant.mapInfo' },
          ],
        },
        { kind: 'checkbox', id: 'meansub', label: 'dlg.discriminant.meansub' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'saveTab',
      label: 'dlg.discriminant.saveBtn',
      icon: 'save',
      fields: [
        { kind: 'checkbox', id: 'saveClass', label: 'dlg.discriminant.saveClass' },
        { kind: 'checkbox', id: 'saveScores', label: 'dlg.discriminant.saveScores' },
        { kind: 'checkbox', id: 'saveProbs', label: 'dlg.discriminant.saveProbs' },
      ],
    },
  ],
  errorFields: { 'dlg.errors.range': 'lo', 'dlg.discriminant.errFin': 'fin' },
  validate: (v) => {
    const lo = num(v, 'lo');
    const hi = num(v, 'hi');
    if (lo === null || hi === null || lo >= hi) return 'dlg.errors.range';
    if (stepwise(v)) {
      const c = crit(v);
      if (useP(v) ? !(c.fin < c.fout) : !(c.fout < c.fin)) return 'dlg.discriminant.errFin';
    }
    return null;
  },
  toSyntax: (v) => {
    const stats = [...STATS.filter((s) => bool(v, `st_${s}`)), ...(bool(v, 'st_MEAN') ? ['STDDEV'] : []), bool(v, 'table') && 'TABLE', bool(v, 'crossvalid') && 'CROSSVALID'].filter(Boolean) as string[];
    const order = ['MEAN', 'STDDEV', 'UNIVF', 'BOXM', 'COEFF', 'RAW', 'CORR', 'COV', 'GCOV', 'TCOV', 'TABLE', 'CROSSVALID'];
    stats.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const plots = [bool(v, 'combined') && 'COMBINED', bool(v, 'separate') && 'SEPARATE', bool(v, 'casewise') && 'CASES'].filter(Boolean);
    const save = [bool(v, 'saveClass') && 'CLASS', bool(v, 'saveScores') && 'SCORES', bool(v, 'saveProbs') && 'PROBS'].filter(Boolean);
    const sw = stepwise(v);
    const c = crit(v);
    return command('DISCRIMINANT', '', [
      `GROUPS=${vars(v, 'group')[0]}(${num(v, 'lo')} ${num(v, 'hi')})`,
      `VARIABLES=${wrap(vars(v, 'independents'))}`,
      `METHOD=${sw ? 'WILKS' : 'DIRECT'}`,
      sw && (useP(v) ? `PIN=${c.fin}\n  /POUT=${c.fout}` : `FIN=${c.fin}\n  /FOUT=${c.fout}`),
      `PRIORS=${str(v, 'priors') || 'EQUAL'}`,
      stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
      plots.length > 0 && `PLOT=${plots.join(' ')}`,
      save.length > 0 && `SAVE=${save.join(' ')}`,
      `CLASSIFY=NONMISSING POOLED${bool(v, 'meansub') ? ' MEANSUB' : ''}`,
    ]);
  },
};
