/*
 * General linear model – repeated measures (GLM … /WSFACTOR) and multivariate (several dependent
 * variables). Both run as the GLM extension analysis (src/ext/commands/glm.ts); a univariate GLM
 * without within-subjects factors keeps going to PSPP (dialog `glm` in models.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogContext, DialogSpec, Field, Hint, Values } from '../types';
import { bool, command, num, rows, str, vars, wrap } from '../syntaxUtil';

/** Options sub-dialog shared by the multivariate and repeated measures dialogs. */
export const glmOptions: Field = {
  kind: 'subdialog',
  id: 'options',
  label: 'dlg.common.optionsBtn',
  icon: 'tune',
  fields: [
    { kind: 'checkbox', id: 'descriptive', label: 'dlg.glmOptions.descriptive', default: true },
    { kind: 'checkbox', id: 'etasq', label: 'dlg.glmOptions.etasq', default: true },
    { kind: 'checkbox', id: 'homogeneity', label: 'dlg.glmOptions.homogeneity' },
    { kind: 'checkbox', id: 'parameter', label: 'dlg.glmOptions.parameter' },
    { kind: 'checkbox', id: 'compare', label: 'dlg.glmOptions.compare' },
    {
      kind: 'select',
      id: 'adj',
      label: 'dlg.glmOptions.adj',
      default: 'BONFERRONI',
      when: (v) => Boolean(v.compare),
      options: [
        { value: 'LSD', label: 'dlg.glmOptions.lsd' },
        { value: 'BONFERRONI', label: 'dlg.glmOptions.bonferroni' },
        { value: 'SIDAK', label: 'dlg.glmOptions.sidak' },
      ],
    },
    { kind: 'number', id: 'alpha', label: 'dlg.glmOptions.alpha', default: 0.05, min: 0.0001, max: 0.5, step: 0.01 },
  ],
};

/** /PRINT, /EMMEANS (one per factor in COMPARE), /CRITERIA subcommands from the options. */
export function glmOptionSubs(v: Values, factors: string[]): string[] {
  const print = [bool(v, 'descriptive') && 'DESCRIPTIVE', bool(v, 'etasq') && 'ETASQ', bool(v, 'homogeneity') && 'HOMOGENEITY', bool(v, 'parameter') && 'PARAMETER'].filter(Boolean);
  const adj = str(v, 'adj') || 'BONFERRONI';
  return [
    print.length > 0 && `PRINT=${print.join(' ')}`,
    ...(bool(v, 'compare') ? factors.map((f) => `EMMEANS=TABLES(${f}) COMPARE ADJ(${adj})`) : []),
    `CRITERIA=ALPHA(${num(v, 'alpha') ?? 0.05})`,
  ].filter((s): s is string => Boolean(s));
}

const CONTRASTS = [
  { value: 'POLYNOMIAL', label: 'dlg.glmOptions.polynomial' },
  { value: 'SIMPLE', label: 'dlg.glmOptions.simple' },
  { value: 'REPEATED', label: 'dlg.glmOptions.repeated' },
  { value: 'DIFFERENCE', label: 'dlg.glmOptions.difference' },
  { value: 'HELMERT', label: 'dlg.glmOptions.helmert' },
  { value: 'DEVIATION', label: 'dlg.glmOptions.deviation' },
];

const NAME_RE = /^[A-Za-z@#$_À-ɏ][A-Za-z0-9@#$_.À-ɏ]*$/;

function levels(v: Values): { f1: string; l1: number; f2: string; l2: number; k: number } {
  const f1 = str(v, 'factor1');
  const f2 = str(v, 'factor2');
  const l1 = Math.max(2, Math.round(num(v, 'levels1') ?? 3));
  const l2 = f2 ? Math.max(2, Math.round(num(v, 'levels2') ?? 2)) : 1;
  return { f1, l1, f2, l2, k: l1 * l2 };
}

const badName = (n: string, ctx: DialogContext) => !NAME_RE.test(n) || ctx.variables.some((x) => x.name.toUpperCase() === n.toUpperCase());

export const glmRepeated: DialogSpec = {
  id: 'glmRepeated',
  kind: 'analysis',
  title: 'dlg.glmRepeated.title',
  icon: 'timeline',
  command: 'GLM',
  source: 'numeric',
  size: 'wide',
  fields: [
    {
      kind: 'group',
      columns: 3,
      fields: [
        { kind: 'text', id: 'factor1', label: 'dlg.glmRepeated.factor1', default: 'time' },
        { kind: 'number', id: 'levels1', label: 'dlg.glmRepeated.levels1', default: 3, min: 2, step: 1 },
        { kind: 'select', id: 'contrast1', label: 'dlg.glmRepeated.contrast', default: 'POLYNOMIAL', options: CONTRASTS },
        { kind: 'text', id: 'factor2', label: 'dlg.glmRepeated.factor2', default: '' },
        { kind: 'number', id: 'levels2', label: 'dlg.glmRepeated.levels2', default: 2, min: 2, step: 1, when: (v) => str(v, 'factor2') !== '' },
        { kind: 'select', id: 'contrast2', label: 'dlg.glmRepeated.contrast', default: 'POLYNOMIAL', options: CONTRASTS, when: (v) => str(v, 'factor2') !== '' },
      ],
    },
    { kind: 'text', id: 'measure', label: 'dlg.glmRepeated.measure', default: '' },
    {
      kind: 'rows',
      id: 'measures',
      label: 'dlg.glmRepeated.measures',
      hint: 'dlg.glmRepeated.measuresHint',
      minRows: 2,
      default: [{ v: '' }, { v: '' }, { v: '' }],
      columns: [{ id: 'v', label: 'dlg.glmRepeated.variable', type: 'variable', filter: 'numeric' }],
    },
    { kind: 'varlist', id: 'between', label: 'dlg.glmRepeated.between', prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'covariates', label: 'dlg.glmRepeated.covariates', filter: 'numeric', prefer: ['scale'] },
    glmOptions,
  ],
  errorFields: {
    'dlg.glmRepeated.needName': 'factor1',
    'dlg.glmRepeated.badName': 'factor1',
    'dlg.glmRepeated.rowCount': 'measures',
    'dlg.glmRepeated.fillAll': 'measures',
  },
  validate: (v, ctx) => {
    const { f1, f2, k } = levels(v);
    if (!f1) return 'dlg.glmRepeated.needName';
    if (badName(f1, ctx) || (f2 && (badName(f2, ctx) || f2.toUpperCase() === f1.toUpperCase()))) return 'dlg.glmRepeated.badName';
    if (str(v, 'measure') && badName(str(v, 'measure'), ctx)) return 'dlg.glmRepeated.badName';
    const list = ((v.measures as Record<string, string>[] | undefined) ?? []).map((r) => r.v ?? '');
    if (list.length !== k) return 'dlg.glmRepeated.rowCount';
    if (list.some((x) => !x) || new Set(list).size !== list.length) return 'dlg.glmRepeated.fillAll';
    return null;
  },
  hints: (v) => {
    const { k } = levels(v);
    const list = (v.measures as Record<string, string>[] | undefined) ?? [];
    if (list.length === k) return [];
    const resized = Array.from({ length: k }, (_, i) => ({ v: list[i]?.v ?? '' }));
    const h: Hint = { level: 'warn', text: 'dlg.glmRepeated.rowsHint', args: { count: k }, field: 'measures', action: { label: 'dlg.glmRepeated.fixRows', args: { count: k }, patch: { measures: resized } } };
    return [h];
  },
  toSyntax: (v) => {
    const { f1, l1, f2, l2 } = levels(v);
    const m = rows(v, 'measures').map((r) => r.v).filter(Boolean);
    const b = vars(v, 'between');
    const c = vars(v, 'covariates');
    const ws = [`${f1} ${l1} ${str(v, 'contrast1') || 'POLYNOMIAL'}`, ...(f2 ? [`${f2} ${l2} ${str(v, 'contrast2') || 'POLYNOMIAL'}`] : [])];
    const within = f2 ? [f1, f2, `${f1}*${f2}`] : [f1];
    return command('GLM', wrap([...m, ...(b.length ? ['BY', ...b] : []), ...(c.length ? ['WITH', ...c] : [])]), [
      `WSFACTOR=${ws.join(' ')}`,
      str(v, 'measure') && `MEASURE=${str(v, 'measure')}`,
      'METHOD=SSTYPE(3)',
      ...glmOptionSubs(v, [...(f2 ? [f1, f2] : [f1]), ...b]),
      `WSDESIGN=${within.join(' ')}`,
    ]);
  },
};
