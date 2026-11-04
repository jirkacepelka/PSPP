/*
 * Kaplan–Meier survival analysis (KM, computed in the browser – src/ext/commands/km.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, Values } from '../types';
import { bool, command, num, str, vars } from '../syntaxUtil';

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** The event values inside STATUS=var(…), or null when they are not valid numbers. */
export function kmEventSpec(v: Values): string | null {
  const type = str(v, 'eventType') || 'single';
  if (type === 'range') {
    const lo = num(v, 'lo');
    const hi = num(v, 'hi');
    return lo === null || hi === null || lo > hi ? null : `${lo} THRU ${hi}`;
  }
  const raw = type === 'list' ? str(v, 'eventList') : str(v, 'eventValue');
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !NUM.test(p))) return null;
  if (type === 'single' && parts.length > 1) return null;
  return parts.join(' ');
}

export const km: DialogSpec = {
  id: 'km',
  kind: 'analysis',
  title: 'dlg.km.title',
  icon: 'monitor_heart',
  command: 'KM',
  fields: [
    { kind: 'varlist', id: 'time', label: 'dlg.km.time', filter: 'numeric', min: 1, max: 1, prefer: ['scale'] },
    { kind: 'varlist', id: 'status', label: 'dlg.km.status', filter: 'numeric', min: 1, max: 1, prefer: ['nominal'], groups: true },
    {
      kind: 'group',
      label: 'dlg.km.defineEvent',
      fields: [
        {
          kind: 'radio',
          id: 'eventType',
          label: 'dlg.km.eventType',
          default: 'single',
          inline: true,
          options: [
            { value: 'single', label: 'dlg.km.single' },
            { value: 'list', label: 'dlg.km.list' },
            { value: 'range', label: 'dlg.km.range' },
          ],
        },
        { kind: 'text', id: 'eventValue', label: 'dlg.km.eventValue', default: '1', when: (v) => (str(v, 'eventType') || 'single') === 'single' },
        { kind: 'text', id: 'eventList', label: 'dlg.km.eventList', placeholder: '1, 2', when: (v) => str(v, 'eventType') === 'list' },
        { kind: 'groupvalues', source: 'status', ids: ['lo', 'hi'], labels: ['dlg.km.rangeFrom', 'dlg.km.rangeTo'], mode: 'range', when: (v) => str(v, 'eventType') === 'range' },
      ],
    },
    { kind: 'varlist', id: 'factor', label: 'dlg.km.factor', max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'strata', label: 'dlg.km.strata', max: 1, prefer: ['nominal', 'ordinal'], groups: true },
    {
      kind: 'subdialog',
      id: 'compareTab',
      label: 'dlg.km.compareBtn',
      icon: 'compare_arrows',
      fields: [
        { kind: 'info', label: 'dlg.km.needFactor', when: (v) => vars(v, 'factor').length === 0 },
        {
          kind: 'group',
          label: 'dlg.km.tests',
          fields: [
            { kind: 'checkbox', id: 'logrank', label: 'dlg.km.logrank' },
            { kind: 'checkbox', id: 'breslow', label: 'dlg.km.breslow' },
            { kind: 'checkbox', id: 'tarone', label: 'dlg.km.tarone' },
          ],
        },
        {
          kind: 'radio',
          id: 'compare',
          label: 'dlg.km.compare',
          default: 'OVERALL',
          options: [
            { value: 'OVERALL', label: 'dlg.km.overall' },
            { value: 'PAIRWISE', label: 'dlg.km.pairwise' },
          ],
        },
        {
          kind: 'radio',
          id: 'pool',
          label: 'dlg.km.strataTests',
          default: 'POOLED',
          when: (v) => vars(v, 'strata').length > 0,
          options: [
            { value: 'POOLED', label: 'dlg.km.pooled' },
            { value: 'STRATA', label: 'dlg.km.perStratum' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'optionsTab',
      label: 'dlg.common.optionsBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'group',
          label: 'dlg.km.statistics',
          fields: [
            { kind: 'checkbox', id: 'table', label: 'dlg.km.table', default: true },
            { kind: 'checkbox', id: 'mean', label: 'dlg.km.mean', default: true },
            { kind: 'checkbox', id: 'quartiles', label: 'dlg.km.quartiles' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.km.plots',
          fields: [
            { kind: 'checkbox', id: 'plotSurvival', label: 'dlg.km.plotSurvival', default: true },
            { kind: 'checkbox', id: 'plotOms', label: 'dlg.km.plotOms' },
            { kind: 'checkbox', id: 'plotHazard', label: 'dlg.km.plotHazard' },
            { kind: 'checkbox', id: 'plotLogsurv', label: 'dlg.km.plotLogsurv' },
          ],
        },
      ],
    },
  ],
  validate: (v) => (kmEventSpec(v) === null ? 'dlg.errors.kmEvent' : null),
  errorFields: { 'dlg.errors.kmEvent': 'eventValue' },
  toSyntax: (v) => {
    const factor = vars(v, 'factor')[0];
    const strata = vars(v, 'strata')[0];
    const print = [bool(v, 'table') && 'TABLE', bool(v, 'mean') && 'MEAN'].filter(Boolean);
    const plots = [bool(v, 'plotSurvival') && 'SURVIVAL', bool(v, 'plotOms') && 'OMS', bool(v, 'plotHazard') && 'HAZARD', bool(v, 'plotLogsurv') && 'LOGSURV'].filter(Boolean);
    const tests = [bool(v, 'logrank') && 'LOGRANK', bool(v, 'breslow') && 'BRESLOW', bool(v, 'tarone') && 'TARONE'].filter(Boolean);
    const withTests = factor && tests.length > 0;
    return command('KM', `${vars(v, 'time')[0] ?? ''}${factor ? ` BY ${factor}` : ''}`, [
      strata && `STRATA=${strata}`,
      `STATUS=${vars(v, 'status')[0] ?? ''}(${kmEventSpec(v) ?? '1'})`,
      `PRINT=${print.length ? print.join(' ') : 'NONE'}`,
      bool(v, 'quartiles') && 'PERCENTILES',
      plots.length > 0 && `PLOT=${plots.join(' ')}`,
      withTests && `TEST=${tests.join(' ')}`,
      withTests && `COMPARE=${str(v, 'compare') || 'OVERALL'}${strata ? ` ${str(v, 'pool') || 'POOLED'}` : ''}`,
    ]);
  },
};
