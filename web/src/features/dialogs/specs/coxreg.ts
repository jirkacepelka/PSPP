/*
 * Cox proportional hazards regression (COXREG, computed in the browser – src/ext/commands/coxreg.ts).
 * The time, status and event fields are those of the Kaplan–Meier dialog.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, Field } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';
import { km, kmEventSpec } from './km';

const kmField = (pred: (f: Field) => boolean): Field => {
  const f = km.fields.find(pred);
  if (!f) throw new Error('KM dialog field missing');
  return f;
};

export const coxreg: DialogSpec = {
  id: 'coxreg',
  kind: 'analysis',
  title: 'dlg.coxreg.title',
  icon: 'trending_down',
  command: 'COXREG',
  fields: [
    kmField((f) => f.kind === 'varlist' && f.id === 'time'),
    kmField((f) => f.kind === 'varlist' && f.id === 'status'),
    kmField((f) => f.kind === 'group' && f.label === 'dlg.km.defineEvent'),
    { kind: 'varlist', id: 'covariates', label: 'dlg.coxreg.covariates', filter: 'numeric', prefer: ['scale'] },
    { kind: 'varlist', id: 'categorical', label: 'dlg.coxreg.categorical', prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'radio',
      id: 'refCat',
      label: 'dlg.coxreg.refCat',
      default: 'LAST',
      inline: true,
      when: (v) => vars(v, 'categorical').length > 0,
      options: [
        { value: 'LAST', label: 'dlg.coxreg.last' },
        { value: 'FIRST', label: 'dlg.coxreg.first' },
      ],
    },
    { kind: 'varlist', id: 'strata', label: 'dlg.coxreg.strata', max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'subdialog',
      id: 'plotsTab',
      label: 'dlg.coxreg.plotsBtn',
      icon: 'show_chart',
      fields: [
        { kind: 'checkbox', id: 'plotSurvival', label: 'dlg.coxreg.plotSurvival' },
        { kind: 'checkbox', id: 'plotHazard', label: 'dlg.coxreg.plotHazard' },
        { kind: 'checkbox', id: 'plotLml', label: 'dlg.coxreg.plotLml' },
        { kind: 'checkbox', id: 'plotOms', label: 'dlg.coxreg.plotOms' },
      ],
    },
    {
      kind: 'subdialog',
      id: 'optionsTab',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        { kind: 'checkbox', id: 'ci', label: 'dlg.coxreg.ci', default: true },
        { kind: 'number', id: 'ciLevel', label: 'dlg.common.ciLevel', default: 95, min: 1, max: 99.99, when: (v) => bool(v, 'ci') },
        { kind: 'checkbox', id: 'baseline', label: 'dlg.coxreg.baseline' },
        { kind: 'checkbox', id: 'corr', label: 'dlg.coxreg.corr' },
        {
          kind: 'radio',
          id: 'display',
          label: 'dlg.coxreg.display',
          default: 'EACH',
          options: [
            { value: 'EACH', label: 'dlg.coxreg.eachStep' },
            { value: 'LAST', label: 'dlg.coxreg.lastStep' },
          ],
        },
        { kind: 'number', id: 'iterate', label: 'dlg.coxreg.iterate', default: 20, min: 1, step: 1 },
      ],
    },
  ],
  errorFields: { 'dlg.errors.kmEvent': 'eventValue', 'dlg.errors.predictors': 'covariates' },
  validate: (v) => {
    if (kmEventSpec(v) === null) return 'dlg.errors.kmEvent';
    return vars(v, 'covariates').length + vars(v, 'categorical').length === 0 ? 'dlg.errors.predictors' : null;
  },
  toSyntax: (v) => {
    const cat = vars(v, 'categorical');
    const preds = [...vars(v, 'covariates'), ...cat.filter((c) => !vars(v, 'covariates').includes(c))];
    const strata = vars(v, 'strata')[0];
    const plots = [bool(v, 'plotSurvival') && 'SURVIVAL', bool(v, 'plotHazard') && 'HAZARD', bool(v, 'plotLml') && 'LML', bool(v, 'plotOms') && 'OMS'].filter(Boolean);
    const print = [str(v, 'display') === 'LAST' ? 'SUMMARY' : 'DEFAULT', bool(v, 'ci') && `CI(${num(v, 'ciLevel') ?? 95})`, bool(v, 'baseline') && 'BASELINE', bool(v, 'corr') && 'CORR'].filter(Boolean);
    return command('COXREG', vars(v, 'time')[0] ?? '', [
      `STATUS=${vars(v, 'status')[0] ?? ''}(${kmEventSpec(v) ?? '1'})`,
      strata && `STRATA=${strata}`,
      cat.length > 0 && `CATEGORICAL=${cat.join(' ')}`,
      ...cat.map((c) => `CONTRAST(${c})=INDICATOR${str(v, 'refCat') === 'FIRST' ? '(1)' : ''}`),
      wrap(['METHOD=ENTER', ...preds]),
      plots.length > 0 && `PLOT=${plots.join(' ')}`,
      `PRINT=${print.join(' ')}`,
      `CRITERIA=ITERATE(${Math.round(num(v, 'iterate') ?? 20)})`,
    ]);
  },
};
