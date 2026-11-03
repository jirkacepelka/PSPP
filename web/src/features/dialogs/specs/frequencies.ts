/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { DialogSpec, Hint } from '../types';
import { bool, command, num, str, vars, wrap } from '../syntaxUtil';

const STATS = ['MEAN', 'SEMEAN', 'MEDIAN', 'MODE', 'STDDEV', 'VARIANCE', 'RANGE', 'MINIMUM', 'MAXIMUM', 'SUM', 'SKEWNESS', 'SESKEW', 'KURTOSIS', 'SEKURT'];
const DEFAULT_STATS = ['MEAN', 'STDDEV', 'MINIMUM', 'MAXIMUM'];

export const frequencies: DialogSpec = {
  id: 'frequencies',
  kind: 'analysis',
  title: 'dlg.frequencies.title',
  icon: 'bar_chart',
  command: 'FREQUENCIES',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.variables', min: 1 },
    { kind: 'checkbox', id: 'tables', label: 'dlg.frequencies.showTables', default: true },
    {
      kind: 'subdialog',
      id: 'statistics',
      label: 'dlg.common.statisticsBtn',
      icon: 'functions',
      fields: [
        {
          kind: 'group',
          label: 'dlg.common.centralTendency',
          fields: [
            { kind: 'checkbox', id: 'st_MEAN', label: 'stat.mean', default: true },
            { kind: 'checkbox', id: 'st_MEDIAN', label: 'stat.median' },
            { kind: 'checkbox', id: 'st_MODE', label: 'stat.mode' },
            { kind: 'checkbox', id: 'st_SUM', label: 'stat.sum' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.common.dispersion',
          fields: [
            { kind: 'checkbox', id: 'st_STDDEV', label: 'stat.stddev', default: true },
            { kind: 'checkbox', id: 'st_VARIANCE', label: 'stat.variance' },
            { kind: 'checkbox', id: 'st_RANGE', label: 'stat.range' },
            { kind: 'checkbox', id: 'st_MINIMUM', label: 'stat.minimum', default: true },
            { kind: 'checkbox', id: 'st_MAXIMUM', label: 'stat.maximum', default: true },
            { kind: 'checkbox', id: 'st_SEMEAN', label: 'stat.semean' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.common.distribution',
          fields: [
            { kind: 'checkbox', id: 'st_SKEWNESS', label: 'stat.skewness' },
            { kind: 'checkbox', id: 'st_SESKEW', label: 'stat.seskew' },
            { kind: 'checkbox', id: 'st_KURTOSIS', label: 'stat.kurtosis' },
            { kind: 'checkbox', id: 'st_SEKURT', label: 'stat.sekurt' },
          ],
        },
        {
          kind: 'group',
          label: 'dlg.frequencies.percentileValues',
          fields: [
            { kind: 'checkbox', id: 'quartiles', label: 'dlg.frequencies.quartiles' },
            { kind: 'number', id: 'ntiles', label: 'dlg.frequencies.ntiles', min: 2, max: 100, step: 1, default: null },
            { kind: 'text', id: 'percentiles', label: 'dlg.frequencies.percentiles', placeholder: '10 90', hint: 'dlg.frequencies.percentilesHint' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'charts',
      label: 'dlg.common.chartsBtn',
      icon: 'insert_chart',
      fields: [
        {
          kind: 'radio',
          id: 'chart',
          label: 'dlg.frequencies.chartType',
          default: 'none',
          options: [
            { value: 'none', label: 'dlg.frequencies.chartNone' },
            { value: 'bar', label: 'dlg.frequencies.chartBar' },
            { value: 'pie', label: 'dlg.frequencies.chartPie' },
            { value: 'histogram', label: 'dlg.frequencies.chartHistogram' },
          ],
        },
        { kind: 'checkbox', id: 'normal', label: 'dlg.frequencies.normalCurve', when: (v) => v.chart === 'histogram' },
        {
          kind: 'radio',
          id: 'chartValues',
          label: 'dlg.frequencies.chartValues',
          default: 'FREQ',
          inline: true,
          when: (v) => v.chart !== 'none',
          options: [
            { value: 'FREQ', label: 'dlg.frequencies.frequencies' },
            { value: 'PERCENT', label: 'dlg.frequencies.percentages' },
          ],
        },
      ],
    },
    {
      kind: 'subdialog',
      id: 'format',
      label: 'dlg.common.formatBtn',
      icon: 'tune',
      fields: [
        {
          kind: 'radio',
          id: 'order',
          label: 'dlg.frequencies.order',
          default: 'AVALUE',
          options: [
            { value: 'AVALUE', label: 'dlg.frequencies.avalue' },
            { value: 'DVALUE', label: 'dlg.frequencies.dvalue' },
            { value: 'AFREQ', label: 'dlg.frequencies.afreq' },
            { value: 'DFREQ', label: 'dlg.frequencies.dfreq' },
          ],
        },
        { kind: 'checkbox', id: 'includeMissing', label: 'dlg.common.includeUserMissing' },
      ],
    },
  ],
  hints: (v, ctx) => {
    const list = vars(v, 'variables').map((n) => ctx.variables.find((x) => x.name === n)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!list.length) return [];
    const out: Hint[] = [];
    const categorical = list.filter((x) => x.measure === 'nominal' || x.type === 'string');
    const moments = ['MEAN', 'STDDEV', 'VARIANCE', 'SKEWNESS', 'KURTOSIS', 'SUM', 'SEMEAN'].filter((s) => bool(v, `st_${s}`));
    if (categorical.length === list.length && moments.length)
      out.push({
        level: 'warn',
        text: 'dlg.hints.nominalStats',
        args: { names: categorical.map((x) => x.name).join(', ') },
        action: { label: 'dlg.hints.useMode', patch: Object.fromEntries([...STATS.map((s) => [`st_${s}`, false]), ['st_MODE', true]]) },
      });
    else if (list.every((x) => x.measure === 'ordinal') && !bool(v, 'st_MEDIAN'))
      out.push({ level: 'info', text: 'dlg.hints.ordinalMedian', action: { label: 'dlg.hints.addMedian', patch: { st_MEDIAN: true, quartiles: true } } });
    if (str(v, 'chart') === 'none' || !v.chart) {
      const allScale = list.every((x) => x.measure === 'scale');
      out.push({ level: 'info', text: allScale ? 'dlg.hints.suggestHistogram' : 'dlg.hints.suggestBar', action: { label: allScale ? 'dlg.hints.addHistogram' : 'dlg.hints.addBar', patch: { chart: allScale ? 'histogram' : 'bar', normal: allScale } } });
    }
    return out;
  },
  toSyntax: (v) => {
    const subs: string[] = [];
    subs.push(wrap([`VARIABLES=${vars(v, 'variables').join(' ')}`]));
    const tables = bool(v, 'tables');
    const order = str(v, 'order') || 'AVALUE';
    if (!tables || order !== 'AVALUE') subs.push(`FORMAT=${tables ? '' : 'NOTABLE '}${order}`);
    const stats = STATS.filter((s) => bool(v, `st_${s}`));
    if (stats.length === 0) subs.push('STATISTICS=NONE');
    else if (!(stats.length === DEFAULT_STATS.length && DEFAULT_STATS.every((s) => stats.includes(s)))) subs.push(wrap([`STATISTICS=${stats.join(' ')}`]));
    else subs.push('STATISTICS=DEFAULT');
    const pct = new Set<number>();
    if (bool(v, 'quartiles')) [25, 50, 75].forEach((p) => pct.add(p));
    str(v, 'percentiles')
      .split(/[\s,;]+/)
      .map(Number)
      .filter((p) => Number.isFinite(p) && p > 0 && p < 100)
      .forEach((p) => pct.add(p));
    if (pct.size) subs.push(`PERCENTILES=${[...pct].sort((a, b) => a - b).join(' ')}`);
    const nt = num(v, 'ntiles');
    if (nt && nt >= 2) subs.push(`NTILES=${Math.round(nt)}`);
    const chart = str(v, 'chart');
    const cv = str(v, 'chartValues') || 'FREQ';
    if (chart === 'bar') subs.push(`BARCHART=${cv}`);
    if (chart === 'pie') subs.push(`PIECHART=${cv}`);
    if (chart === 'histogram') subs.push(`HISTOGRAM=${bool(v, 'normal') ? 'NORMAL' : 'NONORMAL'} ${cv}`);
    if (bool(v, 'includeMissing')) subs.push('MISSING=INCLUDE');
    return command('FREQUENCIES', '', subs);
  },
};
