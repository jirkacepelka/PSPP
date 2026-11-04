/*
 * Nonparametric tests (NPAR TESTS): Mann-Whitney, Kruskal-Wallis, Wilcoxon, Friedman,
 * one-sample chi-square, binomial and Kolmogorov-Smirnov normality.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec, DialogContext, Field, Values } from '../types';
import { bool, command, lit, num, rows, str, vars, wrap } from '../syntaxUtil';

const options: Field = {
  kind: 'subdialog',
  id: 'options',
  label: 'dlg.common.optionsBtn',
  icon: 'tune',
  fields: [
    { kind: 'checkbox', id: 'descriptives', label: 'dlg.npar.descriptives' },
    { kind: 'checkbox', id: 'exact', label: 'dlg.npar.exact' },
    {
      kind: 'radio',
      id: 'missing',
      label: 'dlg.common.missingValues',
      default: 'ANALYSIS',
      options: [
        { value: 'ANALYSIS', label: 'dlg.common.excludeAnalysis' },
        { value: 'LISTWISE', label: 'dlg.common.excludeListwise' },
      ],
    },
  ],
};

function tail(v: Values): string[] {
  return [bool(v, 'descriptives') ? 'STATISTICS=DESCRIPTIVES' : '', str(v, 'missing') === 'LISTWISE' ? 'MISSING=LISTWISE' : '', bool(v, 'exact') ? 'METHOD=EXACT' : ''].filter(Boolean);
}

const groupLit = (v: Values, ctx: DialogContext, id: string) => {
  const g = vars(v, 'group')[0];
  const isStr = ctx.variables.find((x) => x.name === g)?.type === 'string';
  return lit(str(v, id), isStr);
};

export const mannWhitney: DialogSpec = {
  id: 'mannWhitney',
  kind: 'analysis',
  title: 'dlg.mannWhitney.title',
  icon: 'compare_arrows',
  command: 'NPAR TESTS',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['scale', 'ordinal'] },
    { kind: 'varlist', id: 'group', label: 'dlg.ttestIndependent.groupingVariable', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'groupvalues', source: 'group', ids: ['g1', 'g2'], labels: ['dlg.ttestIndependent.group1', 'dlg.ttestIndependent.group2'], mode: 'pair' },
    options,
  ],
  errorFields: { 'dlg.errors.groups': 'g1' },
  validate: (v) => (!str(v, 'g1') || !str(v, 'g2') ? 'dlg.errors.groups' : null),
  toSyntax: (v, ctx) =>
    command('NPAR TESTS', '', [wrap([`M-W=${vars(v, 'variables').join(' ')}`, 'BY', `${vars(v, 'group')[0]}(${groupLit(v, ctx, 'g1')}, ${groupLit(v, ctx, 'g2')})`]), ...tail(v)]),
};

export const kruskalWallis: DialogSpec = {
  id: 'kruskalWallis',
  kind: 'analysis',
  title: 'dlg.kruskalWallis.title',
  icon: 'stacked_bar_chart',
  command: 'NPAR TESTS',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['scale', 'ordinal'] },
    { kind: 'varlist', id: 'group', label: 'dlg.ttestIndependent.groupingVariable', filter: 'numeric', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'groupvalues', source: 'group', ids: ['lo', 'hi'], labels: ['dlg.kruskalWallis.min', 'dlg.kruskalWallis.max'], mode: 'range' },
    options,
  ],
  errorFields: { 'dlg.errors.range': 'lo' },
  validate: (v) => {
    const lo = num(v, 'lo');
    const hi = num(v, 'hi');
    return lo === null || hi === null || lo >= hi ? 'dlg.errors.range' : null;
  },
  toSyntax: (v) => command('NPAR TESTS', '', [wrap([`K-W=${vars(v, 'variables').join(' ')}`, 'BY', `${vars(v, 'group')[0]}(${num(v, 'lo')}, ${num(v, 'hi')})`]), ...tail(v)]),
};

const pairsField: Field = {
  kind: 'rows',
  id: 'pairs',
  label: 'dlg.ttestPaired.pairs',
  minRows: 1,
  columns: [
    { id: 'a', label: 'dlg.ttestPaired.variable1', type: 'variable', filter: 'numeric' },
    { id: 'b', label: 'dlg.ttestPaired.variable2', type: 'variable', filter: 'numeric' },
  ],
};

export const wilcoxon: DialogSpec = {
  id: 'wilcoxon',
  kind: 'analysis',
  title: 'dlg.wilcoxon.title',
  icon: 'swap_vert',
  command: 'NPAR TESTS',
  source: 'numeric',
  size: 'normal',
  fields: [pairsField, { kind: 'checkbox', id: 'sign', label: 'dlg.wilcoxon.sign' }, options],
  validate: (v) => {
    const p = rows(v, 'pairs');
    if (!p.length || p.some((r) => !r.a || !r.b)) return 'dlg.errors.pairs';
    if (p.some((r) => r.a === r.b)) return 'dlg.errors.pairSame';
    return null;
  },
  toSyntax: (v) => {
    const p = rows(v, 'pairs');
    const spec = `${p.map((r) => r.a).join(' ')} WITH ${p.map((r) => r.b).join(' ')} (PAIRED)`;
    return command('NPAR TESTS', '', [wrap([`WILCOXON=${spec}`]), bool(v, 'sign') && wrap([`SIGN=${spec}`]), ...tail(v)]);
  },
};

export const friedman: DialogSpec = {
  id: 'friedman',
  kind: 'analysis',
  title: 'dlg.friedman.title',
  icon: 'timeline',
  command: 'NPAR TESTS',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.friedman.measures', filter: 'numeric', min: 2, prefer: ['scale', 'ordinal'] },
    { kind: 'checkbox', id: 'kendall', label: 'dlg.friedman.kendall' },
    options,
  ],
  toSyntax: (v) => {
    const list = vars(v, 'variables').join(' ');
    return command('NPAR TESTS', '', [wrap([`FRIEDMAN=${list}`]), bool(v, 'kendall') && wrap([`KENDALL=${list}`]), ...tail(v)]);
  },
};

export const chiSquare: DialogSpec = {
  id: 'chiSquare',
  kind: 'analysis',
  title: 'dlg.chiSquare.title',
  icon: 'pie_chart',
  command: 'NPAR TESTS',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['nominal', 'ordinal'] },
    {
      kind: 'radio',
      id: 'expected',
      label: 'dlg.chiSquare.expected',
      default: 'equal',
      inline: true,
      options: [
        { value: 'equal', label: 'dlg.chiSquare.equal' },
        { value: 'values', label: 'dlg.chiSquare.values' },
      ],
    },
    { kind: 'text', id: 'freqs', label: 'dlg.chiSquare.freqs', hint: 'dlg.chiSquare.freqsHint', when: (v) => v.expected === 'values' },
    options,
  ],
  errorFields: { 'dlg.errors.expected': 'freqs' },
  validate: (v) => (v.expected === 'values' && !/\d/.test(str(v, 'freqs')) ? 'dlg.errors.expected' : null),
  toSyntax: (v) => {
    const f = str(v, 'freqs').split(/[\s;]+|,(?=\s)/).map((x) => x.replace(',', '.')).filter((x) => x && Number.isFinite(Number(x)));
    return command('NPAR TESTS', '', [wrap([`CHISQUARE=${vars(v, 'variables').join(' ')}`]), v.expected === 'values' && f.length ? `EXPECTED=${f.join(', ')}` : 'EXPECTED=EQUAL', ...tail(v)]);
  },
};

export const binomial: DialogSpec = {
  id: 'binomial',
  kind: 'analysis',
  title: 'dlg.binomial.title',
  icon: 'toll',
  command: 'NPAR TESTS',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['nominal'] },
    { kind: 'number', id: 'p', label: 'dlg.binomial.p', default: 0.5, min: 0.001, max: 0.999, step: 0.05 },
    {
      kind: 'radio',
      id: 'define',
      label: 'dlg.binomial.define',
      default: 'data',
      inline: true,
      options: [
        { value: 'data', label: 'dlg.binomial.fromData' },
        { value: 'cut', label: 'dlg.binomial.cut' },
      ],
    },
    { kind: 'number', id: 'cut', label: 'dlg.binomial.cutValue', default: null, when: (v) => v.define === 'cut' },
    options,
  ],
  errorFields: { 'dlg.errors.cutPoint': 'cut' },
  validate: (v) => (v.define === 'cut' && num(v, 'cut') === null ? 'dlg.errors.cutPoint' : null),
  toSyntax: (v) => {
    const p = num(v, 'p') ?? 0.5;
    const list = vars(v, 'variables').join(' ');
    return command('NPAR TESTS', '', [wrap([`BINOMIAL(${p})=${list}${v.define === 'cut' ? `(${num(v, 'cut')})` : ''}`]), ...tail(v)]);
  },
};

export const ksNormal: DialogSpec = {
  id: 'ksNormal',
  kind: 'analysis',
  title: 'dlg.ksNormal.title',
  icon: 'ssid_chart',
  command: 'NPAR TESTS',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['scale'] },
    {
      kind: 'radio',
      id: 'dist',
      label: 'dlg.ksNormal.distribution',
      default: 'NORMAL',
      inline: true,
      options: [
        { value: 'NORMAL', label: 'dlg.ksNormal.normal' },
        { value: 'UNIFORM', label: 'dlg.ksNormal.uniform' },
        { value: 'POISSON', label: 'dlg.ksNormal.poisson' },
        { value: 'EXPONENTIAL', label: 'dlg.ksNormal.exponential' },
      ],
    },
    { kind: 'info', label: 'dlg.ksNormal.info' },
    options,
  ],
  toSyntax: (v) => command('NPAR TESTS', '', [wrap([`KOLMOGOROV-SMIRNOV(${str(v, 'dist') || 'NORMAL'})=${vars(v, 'variables').join(' ')}`]), ...tail(v)]),
};

export const runs: DialogSpec = {
  id: 'runs',
  kind: 'analysis',
  title: 'dlg.runs.title',
  icon: 'swap_horiz',
  command: 'NPAR TESTS',
  source: 'numeric',
  fields: [
    { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1 },
    {
      kind: 'radio',
      id: 'cut',
      label: 'dlg.runs.cutPoint',
      default: 'MEDIAN',
      options: [
        { value: 'MEDIAN', label: 'dlg.runs.median' },
        { value: 'MEAN', label: 'dlg.runs.mean' },
        { value: 'MODE', label: 'dlg.runs.mode' },
        { value: 'custom', label: 'dlg.runs.custom' },
      ],
    },
    { kind: 'number', id: 'value', label: 'dlg.runs.value', default: null, when: (v) => v.cut === 'custom' },
    options,
  ],
  validate: (v) => (v.cut === 'custom' && num(v, 'value') === null ? 'dlg.errors.runsValue' : null),
  errorFields: { 'dlg.errors.runsValue': 'value' },
  toSyntax: (v) => {
    const cut = v.cut === 'custom' ? String(num(v, 'value')) : str(v, 'cut') || 'MEDIAN';
    return command('NPAR TESTS', '', [wrap([`RUNS(${cut})=${vars(v, 'variables').join(' ')}`]), ...tail(v)]);
  },
};

export const mcnemar: DialogSpec = {
  id: 'mcnemar',
  kind: 'analysis',
  title: 'dlg.mcnemar.title',
  icon: 'compare_arrows',
  command: 'NPAR TESTS',
  source: 'numeric',
  size: 'normal',
  fields: [pairsField, options],
  validate: (v) => {
    const p = rows(v, 'pairs');
    if (!p.length || p.some((r) => !r.a || !r.b)) return 'dlg.errors.pairs';
    if (p.some((r) => r.a === r.b)) return 'dlg.errors.pairSame';
    return null;
  },
  toSyntax: (v) => {
    const p = rows(v, 'pairs');
    return command('NPAR TESTS', '', [wrap([`MCNEMAR=${p.map((r) => r.a).join(' ')} WITH ${p.map((r) => r.b).join(' ')} (PAIRED)`]), ...tail(v)]);
  },
};

export const cochran: DialogSpec = {
  id: 'cochran',
  kind: 'analysis',
  title: 'dlg.cochran.title',
  icon: 'checklist',
  command: 'NPAR TESTS',
  source: 'numeric',
  fields: [{ kind: 'varlist', id: 'variables', label: 'dlg.cochran.variables', hint: 'dlg.cochran.hint', filter: 'numeric', min: 2, prefer: ['nominal'] }, options],
  toSyntax: (v) => command('NPAR TESTS', '', [wrap([`COCHRAN=${vars(v, 'variables').join(' ')}`]), ...tail(v)]),
};

const kGroupFields: Field[] = [
  { kind: 'varlist', id: 'variables', label: 'dlg.common.testVariables', filter: 'numeric', min: 1, prefer: ['scale', 'ordinal'] },
  { kind: 'varlist', id: 'group', label: 'dlg.ttestIndependent.groupingVariable', filter: 'numeric', max: 1, min: 1, prefer: ['nominal', 'ordinal'], groups: true },
  { kind: 'groupvalues', source: 'group', ids: ['lo', 'hi'], labels: ['dlg.kruskalWallis.min', 'dlg.kruskalWallis.max'], mode: 'range' },
];
const rangeValid = (v: Values) => {
  const lo = num(v, 'lo');
  const hi = num(v, 'hi');
  return lo === null || hi === null || lo >= hi ? 'dlg.errors.range' : null;
};

export const medianTest: DialogSpec = {
  id: 'medianTest',
  kind: 'analysis',
  title: 'dlg.medianTest.title',
  icon: 'align_vertical_center',
  command: 'NPAR TESTS',
  fields: [
    ...kGroupFields,
    { kind: 'number', id: 'median', label: 'dlg.medianTest.value', hint: 'dlg.medianTest.valueHint', default: null },
    options,
  ],
  errorFields: { 'dlg.errors.range': 'lo' },
  validate: rangeValid,
  toSyntax: (v) => {
    const m = num(v, 'median');
    return command('NPAR TESTS', '', [wrap([`MEDIAN${m === null ? '' : `(${m})`}=${vars(v, 'variables').join(' ')}`, 'BY', `${vars(v, 'group')[0]}(${num(v, 'lo')}, ${num(v, 'hi')})`]), ...tail(v)]);
  },
};

export const jonckheere: DialogSpec = {
  id: 'jonckheere',
  kind: 'analysis',
  title: 'dlg.jonckheere.title',
  icon: 'stairs',
  command: 'NPAR TESTS',
  fields: [...kGroupFields, options],
  errorFields: { 'dlg.errors.range': 'lo' },
  validate: rangeValid,
  toSyntax: (v) => command('NPAR TESTS', '', [wrap([`J-T=${vars(v, 'variables').join(' ')}`, 'BY', `${vars(v, 'group')[0]}(${num(v, 'lo')}, ${num(v, 'hi')})`]), ...tail(v)]),
};
