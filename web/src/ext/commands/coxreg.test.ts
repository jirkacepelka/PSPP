/*
 * COXREG (Cox regression, Breslow ties) against statsmodels PHReg.
 *
 * Data: Gehan/Freireich leukaemia remission times (weeks, relapse, drug 1 = 6-MP, 2 = placebo),
 * a log-WBC-like covariate `lw`, a 3-level factor grp3 = case index mod 3 + 1 and strata
 * sex = (index·7 mod 5 < 2). statsmodels' `baseline_cumulative_hazard` is left-continuous
 * (cumsum(h0) − h0, i.e. H0(t−)), so the SPSS value H0(t_k) is statsmodels' entry k + 1; the
 * right-continuous values, survival at covariate values z and its delta-method SE (Tsiatis) come
 * from the numpy code below. Score and LR tests are computed from PHReg's score/hessian/loglike.
 *
 * ```python
 * import numpy as np
 * from statsmodels.duration.hazard_regression import PHReg
 * mp_t = [6,6,6,6,7,9,10,10,11,13,16,17,19,20,22,23,25,32,32,34,35]
 * mp_s = [1,1,1,0,1,0,1,0,0,1,1,0,0,0,1,1,0,0,0,0,0]
 * pl_t = [1,1,2,2,3,4,4,5,5,8,8,8,8,11,11,12,12,15,17,22,23]; pl_s = [1]*21
 * lw = [...LW below...]
 * t = np.array(mp_t+pl_t, float); s = np.array(mp_s+pl_s); drug = np.array([1]*21+[2]*21, float); lw = np.array(lw)
 * n = len(t); grp3 = np.arange(n) % 3 + 1; sex = (np.arange(n) * 7 % 5 < 2).astype(int)
 * def score_test(mod, k):
 *     g = mod.score(np.zeros(k)); H = mod.hessian(np.zeros(k)); return g @ np.linalg.solve(-H, g)
 * def report(X, strata=None, t=t, s=s):
 *     mod = PHReg(t, X, status=s, ties='breslow', strata=strata); r = mod.fit(tol=1e-14); k = X.shape[1]
 *     ll0 = mod.loglike(np.zeros(k))
 *     return r.params, r.bse, -2*r.llf, -2*ll0, score_test(mod, k), 2*(r.llf-ll0), r.baseline_cumulative_hazard
 * def at_z(r, X, t, s, w, z, strata=None):      # Breslow H(t|z), S, SE(S) by the delta method
 *     b = r.params; V = r.cov_params(); st = np.zeros(len(t)) if strata is None else strata; out = []
 *     for g in np.unique(st):
 *         m = st == g; tt, ss, XX, ww = t[m], s[m], X[m], w[m]; H = v1 = 0; h = np.zeros(len(b)); res = []
 *         for u in np.unique(tt[ss == 1]):
 *             R = tt >= u; d = ww[(tt == u) & (ss == 1)].sum(); e = ww[R] * np.exp(XX[R] @ b)
 *             S0 = e.sum(); S1 = e @ XX[R]; ez = np.exp(z @ b)
 *             H += d*ez/S0; v1 += d*ez**2/S0**2; h += d*ez*(z - S1/S0)/S0
 *             res.append((u, np.exp(-H), np.exp(-H)*np.sqrt(v1 + h @ V @ h), H))
 *         out.append(np.array(res))
 *     return out
 * X1 = np.column_stack([drug, lw]); report(X1); at_z(r, X1, t, s, np.ones(n), X1.mean(0)); at_z(..., np.array([1., 3.]))
 * D = np.column_stack([grp3==1, grp3==2, lw]).astype(float)              # INDICATOR, reference last
 * D1 = np.column_stack([grp3==2, grp3==3, lw]).astype(float)             # INDICATOR(1)
 * Dd = np.column_stack([np.where(grp3==3,-1,grp3==1), np.where(grp3==3,-1,grp3==2), lw]).astype(float)  # DEVIATION
 * Ds = np.column_stack([(grp3==1)-1/3, (grp3==2)-1/3, lw])                # SIMPLE
 * V = cov[:2,:2]; b = params[:2]; b @ solve(V, b)                         # overall Wald of grp3
 * report(X1, strata=sex); at_z(r, X1, t, s, np.ones(n), X1.mean(0), strata=sex)
 * w = np.arange(n) % 3 + 1; rep = np.repeat(np.arange(n), w); report(X1[rep], t=t[rep], s=s[rep])
 * keep = np.ones(n, bool); keep[[3, 30]] = False; report(X1[keep], t=t[keep], s=s[keep])
 * for g in (1, 2): m = drug == g; report(lw[m][:, None], t=t[m], s=s[m])
 * # students.json: time = hours, event = stress > 20, covariates gpa and gender (indicator, last)
 * ```
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Dataset, OutputItem, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { dataRows, type PivotTable } from '../../lib/pivot';
import { errorsOf, flatItems, haveEngine, runExt, runMixed, tables } from '../testing';
import students from '../../samples/students.json';
import { inspect, type CoxRaw } from './coxreg';
import cs from '../../i18n/fragments/ext-cox.cs.json';
import en from '../../i18n/fragments/ext-cox.en.json';

const MP_T = [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35];
const MP_S = [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];
const PL_T = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
const LW = [
  2.31, 4.06, 3.28, 4.43, 2.96, 2.88, 3.6, 2.32, 2.57, 3.2, 2.8, 2.7, 2.6, 2.16, 2.05, 2.01, 1.78, 2.2, 2.53, 1.47, 1.45, 2.8, 5.0, 4.91, 4.48, 4.01, 4.36, 2.42, 3.49, 3.97,
  3.52, 3.05, 2.32, 3.26, 3.49, 2.12, 1.5, 3.06, 2.3, 2.95, 2.73, 1.97,
];
const N = 42;
const idx = Array.from({ length: N }, (_, i) => i);

function dataset(cols: Record<string, (number | null)[]>, vars: Partial<Record<string, Partial<Variable>>> = {}, extra: Partial<Dataset> = {}): Dataset {
  const names = Object.keys(cols);
  return { name: 't', variables: names.map((n) => makeVariable(n, { print: { type: 'F', w: 8, d: 0 }, ...vars[n] })), columns: names.map((n) => cols[n]), ...extra };
}
const gehanCols = () => ({
  weeks: [...MP_T, ...PL_T] as (number | null)[],
  relapse: [...MP_S, ...new Array(21).fill(1)] as (number | null)[],
  drug: [...new Array(21).fill(1), ...new Array(21).fill(2)] as (number | null)[],
  lw: [...LW] as (number | null)[],
  grp3: idx.map((i) => (i % 3) + 1) as (number | null)[],
  sex: idx.map((i) => ((i * 7) % 5 < 2 ? 1 : 0)) as (number | null)[],
});
const VARS: Partial<Record<string, Partial<Variable>>> = {
  lw: { print: { type: 'F', w: 8, d: 2 } },
  weeks: { label: 'Weeks' },
  drug: { valueLabels: [{ value: 1, label: '6-MP' }, { value: 2, label: 'Placebo' }] },
};
const gehan = (extra: Partial<Dataset> = {}) => dataset(gehanCols(), VARS, extra);

/** Runs SYNTAX and returns the output plus the unrounded results per split group. */
function fit(syntax: string, ds: Dataset, lang: 'cs' | 'en' = 'en', decimal: '.' | ',' = '.'): { out: OutputItem[]; raw: CoxRaw[] } {
  inspect.sink = [];
  const out = runExt(syntax, ds, lang, decimal);
  return { out, raw: inspect.sink };
}
afterEach(() => {
  inspect.sink = null;
});

const close = (a: number[], b: number[], digits = 6) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits));
};
const byCaption = (items: OutputItem[], caption: string, n = 0): PivotTable => {
  const t = tables(items).filter((x) => x.caption === caption)[n];
  if (!t) throw new Error(`no table ${caption}: ${tables(items).map((x) => x.caption).join(', ')}`);
  return t;
};
const row = (t: PivotTable, ...labels: string[]) => {
  const r = dataRows(t).find((x) => labels.every((l) => x.some((c) => c.header && c.text === l)));
  if (!r) throw new Error(`no row ${labels.join('/')} in ${t.caption}`);
  return r.filter((c) => !c.header).map((c) => c.text);
};
const warnings = (items: OutputItem[]) => flatItems(items).flatMap((i) => (i.kind === 'message' && i.severity === 'warning' ? [i.text] : []));

describe('COXREG vs statsmodels PHReg (Breslow)', () => {
  it('two covariates: estimates, tests, baseline and survival at the means', () => {
    const { out, raw } = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw /PRINT=CI(95) BASELINE.', gehan());
    const r = raw[0];
    close(r.B, [1.1917680373, 1.5065448503]);
    close(r.SE, [0.4186191351, 0.3368062166]);
    expect(r.m2ll).toBeCloseTo(149.09683883, 6);
    expect(r.m2ll0).toBeCloseTo(187.97010096, 6);
    expect(r.score!).toBeCloseTo(38.906131943, 6);
    // statsmodels H0(t−) at the event times 1, 2, 3, …: our H0(t_k) = its entry k + 1
    const sm = [2.3376713129e-5, 5.4354846977e-5, 8.0937356198e-5, 1.4143328653e-4, 2.2168771322e-4, 3.8344691535e-4, 4.5549785845e-4, 7.4973551807e-4, 8.7080278037e-4, 1.1408942536e-3, 1.5490787968e-3, 1.8188929153e-3, 2.1221377373e-3, 2.4610150260e-3, 2.8276823070e-3, 4.2972431769e-3];
    const b = r.baseline[0];
    expect(b.map((x) => x.t)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 22, 23]);
    b.slice(0, -1).forEach((x, i) => expect(x.h0 / sm[i]).toBeCloseTo(1, 8));
    // at the covariate means (1.5, 2.930238): survival, SE, cumulative hazard
    const at = [
      [1, 0.98852230294, 0.0098224114415, 0.011544074223],
      [8, 0.69056833207, 0.081127216456, 0.37024035075],
      [16, 0.29661567706, 0.10285039501, 1.2153179948],
      [23, 0.024724342819, 0.035278492097, 3.6999669814],
    ];
    for (const [t, s, se, h] of at) {
      const x = b.find((y) => y.t === t)!;
      close([x.s, x.se, x.h], [s, se, h], 7);
    }
    close(r.means, [1.5, 2.9302380952]);
    // SPSS tables
    const om = byCaption(out, 'Omnibus Tests of Model Coefficients', 1);
    expect(dataRows(om)[0].map((c) => c.text)).toEqual(['149.097', '38.906', '2', '.000', '38.873', '2', '.000', '38.873', '2', '.000']);
    expect(dataRows(byCaption(out, 'Omnibus Tests of Model Coefficients', 0))[0].map((c) => c.text)).toEqual(['187.970']);
    const ve = byCaption(out, 'Variables in the Equation');
    expect(row(ve, 'drug')).toEqual(['1.192', '.419', '8.105', '1', '.004', '3.293', '1.449', '7.483']);
    expect(row(ve, 'lw')[2]).toBe('20.008');
    const cps = byCaption(out, 'Case Processing Summary');
    expect(row(cps, 'Cases available in analysis', 'Eventᵃ')).toEqual(['30', '71.4%']);
    expect(row(cps, 'Cases available in analysis', 'Censored')).toEqual(['12', '28.6%']);
    expect(cps.footnotes[0]).toContain('Weeks');
    const st = byCaption(out, 'Survival Table');
    expect(row(st, '23')).toEqual(['.004', '.025', '.035', '3.700']);
    expect(row(byCaption(out, 'Covariate Means'), 'lw')).toEqual(['2.930']);
    expect(warnings(out)).toEqual([]);
  });

  it('categorical covariate: indicator (last / first reference), deviation and simple coding', () => {
    const syn = (c: string) => `COXREG weeks /STATUS=relapse(1) /METHOD=ENTER grp3 lw /CATEGORICAL=grp3 ${c} /PRINT=CI(95).`;
    const last = fit(syn(''), gehan());
    close(last.raw[0].B, [-0.2917261146, -0.1251832797, 1.6581263714]);
    close(last.raw[0].SE, [0.4759140377, 0.4728607847, 0.3334313605]);
    expect(last.raw[0].m2ll).toBeCloseTo(157.59528008, 6);
    expect(last.raw[0].score!).toBeCloseTo(30.829012237, 6);
    expect(last.raw[0].labels).toEqual(['grp3(1)', 'grp3(2)', 'lw']);
    const ve = byCaption(last.out, 'Variables in the Equation');
    expect(row(ve, 'grp3')).toEqual(['', '', '.384', '2', '.825', '', '', '']); // overall Wald 0.38435397
    expect(row(ve, 'grp3(1)').slice(0, 2)).toEqual(['-.292', '.476']);
    const cod = byCaption(last.out, 'Categorical Variable Codings');
    expect(dataRows(cod).map((r) => r.filter((c) => !c.header).map((c) => c.text))).toEqual([
      ['14', '1', '0'],
      ['14', '0', '1'],
      ['14', '0', '0'],
    ]);
    expect(cod.footnotes[0]).toContain('grp3');

    const first = fit(syn('/CONTRAST(grp3)=INDICATOR(1)'), gehan());
    close(first.raw[0].B, [0.1665428348, 0.2917261146, 1.6581263714]);
    close(first.raw[0].SE.slice(0, 1), [0.4462664551]);
    const dev = fit(syn('/CONTRAST(grp3)=DEVIATION'), gehan());
    close(dev.raw[0].B, [-0.1527563165, 0.0137865184, 1.6581263714]);
    close(dev.raw[0].SE, [0.2640914233, 0.2622568652, 0.3334313605]);
    expect(dataRows(byCaption(dev.out, 'Categorical Variable Codings'))[2].filter((c) => !c.header).map((c) => c.text)).toEqual(['14', '-1', '-1']);
    const simple = fit(syn('/CONTRAST(grp3)=SIMPLE'), gehan());
    close(simple.raw[0].B, [-0.2917261146, -0.1251832797, 1.6581263714]);
    expect(dataRows(byCaption(simple.out, 'Categorical Variable Codings'))[0].filter((c) => !c.header).map((c) => c.text)).toEqual(['14', '.667', '-.333']);
    // categorical model at the means of the design columns
    const b = last.raw[0].baseline[0];
    close([b[0].s, b[0].se, b[0].h], [0.98619036367, 0.011694255559, 0.013905876409], 7);
    close([b.at(-1)!.s, b.at(-1)!.se], [0.026913711775, 0.034722208812], 7);
  });

  it('strata: stratified partial likelihood, per-stratum baseline', () => {
    const { out, raw } = fit('COXREG weeks /STATUS=relapse(1) /STRATA=sex /METHOD=ENTER drug lw.', gehan());
    const r = raw[0];
    close(r.B, [1.2453590676, 1.5069655466]);
    close(r.SE, [0.431865828, 0.3532605387]);
    expect(r.m2ll).toBeCloseTo(110.94260737, 6);
    expect(r.m2ll0).toBeCloseTo(149.1060169, 6);
    expect(r.score!).toBeCloseTo(37.5784234, 6);
    expect(r.baseline.map((s) => s.length)).toEqual([14, 10]);
    expect(r.baseline[1][0].h0 / 2.7387487466e-5).toBeCloseTo(1, 8); // stratum 1: H0(2) = statsmodels H0(3−)
    close([r.baseline[0][0].s, r.baseline[0][0].se], [0.9818304326, 0.015827278578], 7);
    close([r.baseline[1].at(-1)!.s, r.baseline[1].at(-1)!.se, r.baseline[1].at(-1)!.h], [0.020738180255, 0.047959802373, 3.8757788209], 7);
    const ss = byCaption(out, 'Stratum Status');
    expect(row(ss, '0')).toEqual(['0', '19', '6', '24.0%']);
    expect(row(ss, '1')).toEqual(['1', '11', '6', '35.3%']);
  });

  it('frequency weights equal replicated cases', () => {
    const w = idx.map((i) => (i % 3) + 1);
    const weighted = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw.', dataset({ ...gehanCols(), w }, VARS, { weight: 'w' }));
    close(weighted.raw[0].B, [1.1700546539, 1.8100648013]);
    close(weighted.raw[0].SE, [0.3094949185, 0.2550069353]);
    expect(weighted.raw[0].m2ll).toBeCloseTo(351.18652732, 6);
    expect(weighted.raw[0].m2ll0).toBeCloseTo(445.98446094, 6);
    expect(weighted.raw[0].score!).toBeCloseTo(96.959408551, 5);
    const c = gehanCols();
    const rep = Object.fromEntries(Object.entries(c).map(([k, col]) => [k, col.flatMap((x, i) => new Array(w[i]).fill(x))]));
    const replicated = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw /PRINT=BASELINE.', dataset(rep, VARS));
    close(weighted.raw[0].B, replicated.raw[0].B, 9);
    close(
      weighted.raw[0].baseline[0].map((x) => x.se),
      replicated.raw[0].baseline[0].map((x) => x.se),
      9,
    );
    expect(row(byCaption(weighted.out, 'Case Processing Summary'), 'Cases available in analysis', 'Total')[0]).toBe('84');
  });

  it('system- and user-missing values are excluded listwise (MISSING=INCLUDE keeps user-missing)', () => {
    const c = gehanCols();
    c.lw[3] = 9.99;
    c.lw[30] = null;
    const ds = dataset(c, { ...VARS, lw: { print: { type: 'F', w: 8, d: 2 }, missing: { values: [9.99] } } });
    const { out, raw } = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw.', ds);
    close(raw[0].B, [1.0628311333, 1.6429055457]);
    close(raw[0].SE, [0.4299176272, 0.3616571933]);
    expect(raw[0].m2ll).toBeCloseTo(139.76269838, 6);
    expect(raw[0].m2ll0).toBeCloseTo(179.67607161, 6);
    const cps = byCaption(out, 'Case Processing Summary');
    expect(row(cps, 'Cases dropped', 'Cases with missing values')).toEqual(['2', '4.8%']);
    expect(dataRows(cps).at(-1)!.filter((c) => !c.header).map((c) => c.text)).toEqual(['42', '100.0%']);
    const inc = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw /MISSING=INCLUDE.', ds);
    expect(row(byCaption(inc.out, 'Case Processing Summary'), 'Cases dropped', 'Cases with missing values')[0]).toBe('1');
  });

  it('negative times and censored cases before the earliest event are dropped without effect', () => {
    const c = gehanCols();
    const add = (t: number, s: number) => {
      c.weeks.push(t);
      c.relapse.push(s);
      c.drug.push(1);
      c.lw.push(3);
      c.grp3.push(1);
      c.sex.push(0);
    };
    add(-1, 1);
    add(0.5, 0);
    add(0.25, 0);
    const { out, raw } = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw.', dataset(c, VARS));
    close(raw[0].B, [1.1917680373, 1.5065448503]);
    const cps = byCaption(out, 'Case Processing Summary');
    expect(row(cps, 'Cases dropped', 'Cases with negative time')[0]).toBe('1');
    expect(row(cps, 'Cases dropped', 'Censored cases before the earliest event in a stratum')[0]).toBe('2');
    expect(row(cps, 'Cases dropped', 'Total')[0]).toBe('3');
  });

  it('SPLIT FILE and FILTER', () => {
    const split = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER lw.', gehan({ split: ['drug'] }));
    expect(split.raw).toHaveLength(2);
    close(split.raw[0].B, [1.5861539993]);
    close(split.raw[0].SE, [0.5797633057]);
    expect(split.raw[0].m2ll).toBeCloseTo(38.169979547, 6);
    expect(split.raw[0].score!).toBeCloseTo(9.147748003, 6);
    close(split.raw[1].B, [1.2807287399]);
    expect(split.raw[1].m2ll0).toBeCloseTo(92.989021466, 6);
    expect(flatItems(split.out).filter((i) => i.kind === 'text' && /drug =/.test(i.text)).map((i) => (i as { text: string }).text)).toEqual(['drug = 6-MP', 'drug = Placebo']);
    const f = idx.map((i) => (i >= 21 ? 1 : 0));
    const filtered = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER lw.', dataset({ ...gehanCols(), f }, VARS, { filter: 'f' }));
    close(filtered.raw[0].B, [1.2807287399]);
  });

  it('multiple blocks: change from previous block, SUMMARY prints the last block only', () => {
    const { out, raw } = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug /METHOD=ENTER lw /PRINT=SUMMARY.', gehan());
    close(raw[0].B, [1.1917680373, 1.5065448503]);
    const om = byCaption(out, 'Omnibus Tests of Model Coefficients', 2);
    const c = dataRows(om)[0].map((x) => x.text);
    expect(c.slice(0, 4)).toEqual(['149.097', '38.906', '2', '.000']);
    expect(c[5]).toBe('1'); // change df
    expect(tables(out).filter((t) => t.caption === 'Variables in the Equation')).toHaveLength(1);
    expect(flatItems(out).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['Block 0: Beginning Block', 'Block 1: Method = Enter', 'Block 2: Method = Enter']);
  });

  it('monotone likelihood is detected and reported', () => {
    // x = 1 exactly for the first cases to fail: statsmodels does not converge (B → ∞, SE ≈ 2.6e5)
    const ds = dataset({
      t: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      s: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1],
      x: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      z: [0.5, 1.2, 0.3, 0.8, 1.1, 0.2, 0.9, 0.4, 1.5, 0.7, 0.6, 1.0],
    });
    const { out, raw } = fit('COXREG t /STATUS=s(1) /METHOD=ENTER x z.', ds);
    expect(raw[0].B[0]).toBeGreaterThan(5);
    const w = warnings(out);
    expect(w.some((m) => /monotone in x\b/.test(m))).toBe(true);
    expect(w.some((m) => /monotone in .*z/.test(m))).toBe(false);
  });

  it('constant covariate is removed with a warning; no events gives a warning', () => {
    const c = gehanCols();
    const out = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw k.', dataset({ ...c, k: new Array(N).fill(4) }, VARS));
    expect(warnings(out.out).some((m) => /removed: k/.test(m))).toBe(true);
    close(out.raw[0].B, [1.1917680373, 1.5065448503]);
    const none = fit('COXREG weeks /STATUS=relapse(7) /METHOD=ENTER drug.', gehan());
    expect(warnings(none.out).some((m) => /no events/.test(m))).toBe(true);
    expect(none.raw).toEqual([]);
  });

  it('plots at the means and per pattern (survival, hazard, LML)', () => {
    const { out } = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw /PATTERN=drug(1) lw(3) /PLOT=SURVIVAL HAZARD LML.', gehan());
    type Chart = { chart: { type: string; kind: string; curves: { name: string; points: number[][]; end: number }[] } };
    const charts = flatItems(out).filter((i) => i.kind === 'chart') as unknown as Chart[];
    expect(charts.map((c) => [c.chart.type, c.chart.kind])).toEqual([
      ['survival', 'survival'],
      ['survival', 'hazard'],
      ['survival', 'lml'],
    ]);
    const s = charts[0].chart.curves[0];
    expect(s.points[0]).toEqual([0, 1]);
    expect(s.points[1][1]).toBeCloseTo(0.99295825209, 8); // S(1 | drug = 1, lw = 3)
    expect(s.points.find((p) => p[0] === 10)![1]).toBeCloseTo(0.76855809551, 8);
    expect(s.end).toBe(35);
    expect(charts[1].chart.curves[0].points.at(-1)![1]).toBeCloseTo(2.2649197218, 7);
    expect(charts[2].chart.curves[0].points[0]).toEqual([1, expect.closeTo(Math.log(0.0070666580294), 6)]);
    const mp = byCaption(out, 'Covariate Means and Pattern Values');
    expect(row(mp, 'lw')).toEqual(['2.930', '3.000']);
  });

  it('errors, warnings and Czech output', () => {
    expect(errorsOf(runExt('COXREG weeks /METHOD=ENTER drug.', gehan()))[0]).toMatch(/STATUS/);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /METHOD=FSTEP(LR) drug.', gehan()))[0]).toMatch(/FSTEP/);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug*lw.', gehan()))).toHaveLength(1);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug /CATEGORICAL=lw.', gehan()))[0]).toMatch(/lw/);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER grp3 /CONTRAST(grp3)=HELMERT.', gehan()))[0]).toMatch(/HELMERT/);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER grp3 /CONTRAST(grp3)=INDICATOR(4).', gehan()))).toHaveLength(1);
    expect(errorsOf(runExt('COXREG weeks /STATUS=relapse(1) /FOO.', gehan()))).toHaveLength(1);
    const w = fit('COXREG weeks WITH drug /STATUS=relapse(1) /SAVE=SURVIVAL.', gehan());
    expect(warnings(w.out).some((m) => /SAVE/.test(m))).toBe(true);
    close(w.raw[0].B, [1.5091914126]); // WITH list entered without METHOD
    const czech = fit('COXREG weeks /STATUS=relapse(1) /METHOD=ENTER drug lw.', gehan(), 'cs', ',');
    const ve = byCaption(czech.out, 'Proměnné v rovnici');
    expect(row(ve, 'drug')[0]).toBe('1,192');
    expect(tables(czech.out).map((t) => t.caption)).toContain('Omnibus testy koeficientů modelu');
  });

  // statsmodels PHReg on students.json: hours, event stress > 20, gpa + gender (indicator, last):
  //   params [-0.96139284, 0.35781784, 0.68941642], bse [0.31613926, 1.02831354, 1.03332233],
  //   −2LL 490.683988; 118 complete cases, 69 events
  it.skipIf(!haveEngine)('runs after PSPP transformations (real engine)', async () => {
    inspect.sink = [];
    const r = await runMixed('COMPUTE stime = hours.\nCOMPUTE died = stress > 20.\nCOXREG stime /STATUS=died(1) /CATEGORICAL=gender /METHOD=ENTER gpa gender.', students as unknown as Dataset);
    expect(errorsOf(r.items)).toEqual([]);
    const raw = inspect.sink;
    close(raw[0].B, [-0.96139284, 0.35781784, 0.68941642], 5);
    close(raw[0].SE, [0.31613926, 1.02831354, 1.03332233], 5);
    expect(raw[0].m2ll).toBeCloseTo(490.683988, 4);
    expect(row(byCaption(r.items, 'Case Processing Summary'), 'Cases available in analysis', 'Eventᵃ')[0]).toBe('69');
  }, 60000);

  it('fragments have identical keys', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
    expect(keys(cs)).toEqual(keys(en));
  });
});
