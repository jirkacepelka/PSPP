/*
 * Runs the syntax of every dialog spec through the real PSPP engine (WebAssembly) on the
 * students sample and checks that PSPP reports no errors. Skipped when the engine build is absent.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIALOG_SPECS } from './specs';
import { defaultValues, type DialogContext, type Values } from './types';
import type { Dataset, OutputItem } from '../../engine/types';
import students from '../../samples/students.json';
import { runWithExtensions } from '../../ext/runner';

const ENGINE = path.resolve(__dirname, '../../../public/engine/pspp.js');
const WRAPPER = path.resolve(__dirname, '../../../../engine/js/engine.mjs');
const have = fs.existsSync(ENGINE) && fs.existsSync(WRAPPER);

const ds = students as unknown as Dataset;
const ctx: DialogContext = { variables: ds.variables };

// realistic values on the students sample (gender 1/2/3, faculty 1–5, job 0/1)
const FILLED: Record<string, Values> = {
  frequencies: { variables: ['faculty', 'satisf'], chart: 'bar' },
  descriptives: { variables: ['age', 'gpa'] },
  explore: { dependents: ['gpa'], factors: ['gender'] },
  crosstabs: { rows: ['gender'], cols: ['job'], st_CHISQ: true },
  ctables: { rows: ['faculty', 'gpa'], cols: ['gender'], colpct: true },
  means: { dependents: ['gpa'], layer1: ['gender'] },
  ttestOneSample: { variables: ['sleep'], testValue: 7 },
  ttestIndependent: { variables: ['gpa'], group: ['gender'], g1: '1', g2: '2' },
  ttestPaired: { pairs: [{ a: 'hours', b: 'sleep' }] },
  oneway: { dependents: ['stress'], factor: ['faculty'], ph_TUKEY: true },
  glm: { dependent: ['stress'], factors: ['faculty', 'gender'] },
  glmMultivariate: { dependents: ['sleep', 'stress', 'gpa'], factors: ['gender'], covariates: ['hours'], homogeneity: true, parameter: true, compare: true },
  glmRepeated: { measures: [{ v: 't1' }, { v: 't2' }, { v: 't3' }], between: ['gender'], homogeneity: true, compare: true },
  correlations: { variables: ['hours', 'gpa'] },
  partialCorr: { variables: ['hours', 'stress', 'gpa'], controls: ['sleep'], descriptives: true, zeroOrder: true },
  regressionLinear: { dependent: ['gpa'], independents: ['hours', 'sleep'] },
  logistic: { dependent: ['job'], covariates: ['gpa'], categorical: ['gender'] },
  plum: { dependent: ['satisf'], factors: ['faculty'], covariates: ['hours', 'gpa'], tparallel: true, link: 'PROBIT' },
  nomreg: { dependent: ['commute'], factors: ['job'], covariates: ['gpa'], fit: true, classtable: true },
  factor: { variables: ['hours', 'sleep', 'stress', 'gpa'] },
  reliability: { items: ['hours', 'sleep', 'stress'] },
  quickCluster: { variables: ['hours', 'gpa'], saveCluster: true },
  hierCluster: { variables: ['hours', 'sleep', 'gpa'], id: ['id'], method: 'WARD', memMode: 'range', saveMode: 'single', saveN: 3, proximity: true },
  discriminant: { group: ['faculty'], lo: 1, hi: 5, independents: ['hours', 'sleep', 'stress', 'gpa'], method: 'WILKS', st_MEAN: true, st_UNIVF: true, st_BOXM: true, st_COEFF: true, st_RAW: true, st_CORR: true, crossvalid: true, combined: true, saveClass: true, saveScores: true, saveProbs: true },
  chiSquare: { variables: ['faculty'] },
  binomial: { variables: ['job'] },
  ksNormal: { variables: ['gpa'] },
  mannWhitney: { variables: ['gpa'], group: ['gender'], g1: '1', g2: '2' },
  kruskalWallis: { variables: ['stress'], group: ['faculty'], lo: 1, hi: 5 },
  wilcoxon: { pairs: [{ a: 'hours', b: 'sleep' }], sign: true },
  friedman: { variables: ['hours', 'sleep', 'stress'], kendall: true },
  runs: { variables: ['gpa'], cut: 'MEDIAN' },
  mcnemar: { pairs: [{ a: 'job', b: 'good' }] },
  cochran: { variables: ['job', 'good'] },
  medianTest: { variables: ['stress'], group: ['faculty'], lo: 1, hi: 5 },
  jonckheere: { variables: ['stress'], group: ['year'], lo: 1, hi: 5 },
  roc: { variables: ['gpa'], state: ['job'], positive: '1', coordinates: true },
  km: { time: ['stime'], status: ['died'], factor: ['gender'], logrank: true, breslow: true, tarone: true, quartiles: true, plotHazard: true },
  coxreg: { time: ['stime'], status: ['died'], covariates: ['gpa'], categorical: ['gender'], strata: ['job'], plotSurvival: true, plotLml: true, baseline: true, corr: true },
  histogram: { variable: ['gpa'] },
  barChart: { category: ['faculty'], cluster: ['gender'], func: 'MEAN', variable: ['gpa'] },
  scatter: { y: ['gpa'], x: ['hours'], by: ['gender'] },
  boxplot: { variables: ['gpa'], factor: ['faculty'] },
  compute: { target: 'x', expression: 'hours * 2' },
  recodeSame: { variables: ['age'], map: [{ from: '1 thru 20', to: '1' }] },
  recodeDifferent: { pairs: [{ src: 'age', dst: 'agecat', label: '' }], map: [{ from: 'else', to: 'copy' }] },
  count: { target: 'n1', variables: ['satisf', 'year'], values: [{ value: '1' }] },
  rank: { variables: ['gpa'] },
  autorecode: { pairs: [{ src: 'faculty', dst: 'fac2' }] },
  sortCases: { by: ['age'] },
  selectCases: { condition: 'age > 20' },
  weightCases: { weight: ['hours'] },
  splitFile: { groups: ['gender'] },
  aggregate: { break: ['faculty'], functions: [{ target: 'm', func: 'MEAN', source: 'gpa', label: '' }] },
  transpose: { variables: ['age'] },
  variableProperties: { variables: ['gender'], measure: 'NOMINAL', role: 'INPUT', labels: [{ value: '9', label: 'N/A' }], missing: '9' },
};

/** Syntax run before a spec's own, e.g. to derive a second dichotomous variable. */
const PRELUDE: Record<string, string> = {
  glmRepeated: 'COMPUTE t1 = stress / 4.\nCOMPUTE t2 = hours / 3.\nCOMPUTE t3 = sleep.\n',
  mcnemar: 'COMPUTE good = gpa >= 3.\n',
  cochran: 'COMPUTE good = gpa >= 3.\n',
  km: 'COMPUTE stime = hours.\nCOMPUTE died = stress > 20.\n',
  coxreg: 'COMPUTE stime = hours.\nCOMPUTE died = stress > 20.\n',
};

const flat = (items: OutputItem[]): OutputItem[] => items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]));

describe.skipIf(!have)('dialog syntax runs in PSPP', () => {
  it('every spec produces error-free syntax', async () => {
    const { createEngine } = await import(/* @vite-ignore */ pathToFileURL(WRAPPER).href);
    const { default: createPspp } = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
    const engine = await createEngine(createPspp);
    await engine.init();
    const failures: string[] = [];
    for (const spec of DIALOG_SPECS) {
      const patch = FILLED[spec.id];
      expect(patch, `engine test data for ${spec.id}`).toBeDefined();
      const syntax = spec.toSyntax({ ...defaultValues(spec), ...patch }, ctx);
      const r = await runWithExtensions(engine, (PRELUDE[spec.id] ?? '') + syntax, structuredClone(ds), { lang: 'en', decimal: '.', t: (k) => k });
      const errs = flat(r.items).filter((i) => i.kind === 'message' && i.severity === 'error');
      if (process.env.SHOW) console.log(spec.id, flat(r.items).map((i) => i.kind === "message" ? "MSG:" + (i as { text: string }).text : i.kind).join(","));
      if (errs.length) failures.push(`${spec.id}: ${syntax}\n  → ${errs.map((e) => (e as { text: string }).text).join(' | ')}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 60000);
});
