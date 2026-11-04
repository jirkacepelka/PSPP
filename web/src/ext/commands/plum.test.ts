/*
 * PLUM against statsmodels' OrderedModel (thresholds and slopes in SPSS's θj − β·x
 * parameterisation, standard errors from the observed information in (θ, β) space), with the
 * full multinomial log-likelihood, Pearson/deviance over subpopulations, pseudo R² and the
 * general (non-parallel) model for the test of parallel lines computed in the script below.
 *
 * Reference script (python3 -W ignore ref_plum.py; statsmodels 0.15, scipy):
 *
 * import json, numpy as np, pandas as pd
 * from scipy import optimize, stats
 * from scipy.special import gammaln
 * from statsmodels.miscmodels.ordinal_model import OrderedModel
 * from statsmodels.tools.numdiff import approx_hess3
 * d = json.load(open('/home/user/PSPP/web/src/samples/students.json'))
 * df = pd.DataFrame({v['name']: c for v, c in zip(d['variables'], d['columns'])})
 *
 * # cloglog: F(u) = 1 - exp(-exp(u)) (Gumbel minimum); nloglog: exp(-exp(-u)) (Gumbel maximum)
 * DISTR = {'logit': 'logit', 'probit': 'probit', 'cloglog': stats.gumbel_l, 'nloglog': stats.gumbel_r, 'cauchit': stats.cauchy}
 *
 * def prep(df, dep, factors, covs, w=None):
 *     x = df[[dep] + factors + covs].copy()
 *     x['_w'] = 1.0 if w is None else df[w].astype(float)
 *     x = x[(x[dep] != 9) & x.notna().all(axis=1) & (x['_w'] > 0)]   # satisf 9 = user-missing
 *     cols, names = [], []
 *     for c in covs: cols.append(x[c].astype(float).values); names.append(c)
 *     for f in factors:
 *         lv = sorted(x[f].unique())
 *         for l in lv[:-1]: cols.append((x[f] == l).astype(float).values); names.append(f'[{f}={l}]')
 *     X = np.column_stack(cols)
 *     return x, X, names
 *
 * def fit(df, dep, factors, covs, distr='logit', w=None):
 *     x, X, names = prep(df, dep, factors, covs, w)
 *     rep = x['_w'].astype(int).values                      # integer frequency weights -> replicate
 *     Xr = np.repeat(X, rep, axis=0); yr = np.repeat(x[dep].values, rep)
 *     cats = sorted(np.unique(yr)); J = len(cats)
 *     y = pd.Series(pd.Categorical(yr, categories=cats, ordered=True))
 *     mod = OrderedModel(y, pd.DataFrame(Xr, columns=names), distr=DISTR[distr])
 *     res = mod.fit(method='bfgs', maxiter=20000, gtol=1e-11, disp=False)
 *     res = mod.fit(start_params=res.params, method='newton', maxiter=200, tol=1e-14, disp=False)
 *     p = len(names); a = res.params.values
 *     theta = mod.transform_threshold_params(a)[1:-1]
 *     # observed information in (θ, β) space (statsmodels parameterises θ2.. as log increments)
 *     def llz(z):
 *         t = z[:J - 1]
 *         return mod.loglike(np.r_[z[J - 1:], t[0], np.log(np.diff(t))])
 *     est = np.r_[theta, a[:p]]
 *     se = np.sqrt(np.diag(np.linalg.inv(-approx_hess3(est, llz, epsilon=1e-4))))
 *     ll1 = res.llf
 *     n = np.bincount(pd.Categorical(yr, categories=cats).codes, minlength=J); N = n.sum()
 *     ll0 = (n * np.log(n / N)).sum()
 *     # subpopulations
 *     key = pd.DataFrame(Xr).astype(str).agg('|'.join, axis=1)
 *     g = pd.crosstab(key, pd.Categorical(yr, categories=cats))
 *     Xs = pd.DataFrame(Xr).groupby(key.values).first().loc[g.index].values
 *     F = {'logit': stats.logistic.cdf, 'probit': stats.norm.cdf}.get(distr) or DISTR[distr].cdf
 *     eta = Xs @ a[:p]
 *     cum = np.column_stack([np.zeros(len(eta))] + [F(t - eta) for t in theta] + [np.ones(len(eta))])
 *     pi = np.diff(cum, axis=1)
 *     Y = g.values.astype(float); ni = Y.sum(1, keepdims=True); E = ni * pi
 *     pearson = ((Y - E) ** 2 / E).sum()
 *     dev = 2 * np.where(Y > 0, Y * np.log(np.where(Y > 0, Y, 1) / E), 0).sum()
 *     const = (gammaln(ni[:, 0] + 1) - gammaln(Y + 1).sum(1)).sum()
 *     s = len(Y); df_gof = s * (J - 1) - (J - 1 + p)
 *     cs = 1 - np.exp(2 * (ll0 - ll1) / N)
 *     out = dict(est=est.tolist(), se=se.tolist(), names=names, m2ll0=-2 * (ll0 + const), m2ll1=-2 * (ll1 + const),
 *                chi=2 * (ll1 - ll0), df=p, pearson=pearson, deviance=dev, dfgof=df_gof,
 *                coxSnell=cs, nagelkerke=cs / (1 - np.exp(2 * ll0 / N)), mcfadden=1 - ll1 / ll0, N=int(N))
 *     # general (non-parallel) model for the test of parallel lines
 *     def nll(b):
 *         th = b[:J - 1]; B = b[J - 1:].reshape(J - 1, p)
 *         cum = np.column_stack([np.zeros(len(Xs))] + [F(th[k] - Xs @ B[k]) for k in range(J - 1)] + [np.ones(len(Xs))])
 *         pi = np.diff(cum, axis=1)
 *         if (pi[Y > 0] <= 0).any(): return 1e10
 *         return -(Y[Y > 0] * np.log(pi[Y > 0])).sum()
 *     b0 = np.r_[theta, np.tile(a[:p], J - 1)]
 *     r = optimize.minimize(nll, b0, method='BFGS', options=dict(gtol=1e-9, maxiter=100000))
 *     r = optimize.minimize(nll, r.x, method='Nelder-Mead', options=dict(xatol=1e-10, fatol=1e-12, maxiter=200000, maxfev=200000))
 *     llg = -r.fun
 *     out.update(m2llGeneral=-2 * (llg + const), chiParallel=2 * (llg - ll1), dfParallel=(J - 2) * p)
 *     return out
 *
 * R = {
 *   'logit': fit(df, 'satisf', ['faculty'], ['hours', 'gpa']),
 *   'probit': fit(df, 'satisf', ['faculty'], ['hours', 'gpa'], 'probit'),
 *   'parallel': fit(df, 'satisf', [], ['hours', 'gpa']),
 *   'weighted': fit(df, 'satisf', [], ['hours', 'gpa'], w='year'),
 *   'female': fit(df[df.gender == 1], 'satisf', [], ['hours', 'gpa']),
 *   'half1': fit(df.iloc[:60], 'satisf', [], ['hours', 'gpa']),
 *   'half2': fit(df.iloc[60:], 'satisf', [], ['hours', 'gpa']),
 *   'cloglog': fit(df, 'satisf', [], ['hours', 'gpa'], 'cloglog'),
 *   'nloglog': fit(df, 'satisf', [], ['hours', 'gpa'], 'nloglog'),
 *   'cauchit': fit(df, 'satisf', [], ['hours', 'gpa'], 'cauchit'),
 * }
 * def r(o): return {k: (np.round(v, 7).tolist() if isinstance(v, (list, np.ndarray)) and not isinstance(v[0], str) else (round(float(v), 7) if isinstance(v, (float, np.floating)) else v)) for k, v in o.items()}
 * print(json.dumps({k: r(v) for k, v in R.items()}, indent=None))
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import students from '../../samples/students.json';
import type { Dataset, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { errorsOf, flatItems, runExt, tables } from '../testing';
import { inspect, type PlumRaw } from './plum';

const REF = {
  logit: {"est": [-4.4412712, -1.7002236, 0.4061574, 2.4413972, -0.0021147, 0.021823, -0.7243122, -1.2633433, -0.4666113, -1.0521672], "se": [1.3693291, 1.2561021, 1.2422299, 1.2965241, 0.0240232, 0.4231769, 0.5804532, 0.6313009, 0.6200065, 0.6787964], "names": ["hours", "gpa", "[faculty=1]", "[faculty=2]", "[faculty=3]", "[faculty=4]"], "m2ll0": 292.7181677, "m2ll1": 287.5706714, "chi": 5.1474963, "df": 6, "pearson": 501.7943298, "deviance": 287.5706714, "dfgof": 454, "coxSnell": 0.0434048, "nagelkerke": 0.0471886, "mcfadden": 0.0175852, "N": 116, "m2llGeneral": 266.5938975, "chiParallel": 20.976774, "dfParallel": 18},
  probit: {"est": [-2.3382925, -0.9472984, 0.3321847, 1.3851421, -0.0018761, 0.0356345, -0.3904932, -0.6698284, -0.3093814, -0.5749154], "se": [0.7741581, 0.7453147, 0.7397547, 0.7548274, 0.0137873, 0.2450481, 0.3466122, 0.3780959, 0.3652242, 0.3970747], "names": ["hours", "gpa", "[faculty=1]", "[faculty=2]", "[faculty=3]", "[faculty=4]"], "m2ll0": 292.7181677, "m2ll1": 288.7065111, "chi": 4.0116566, "df": 6, "pearson": 503.226929, "deviance": 288.7065111, "dfgof": 454, "coxSnell": 0.0339921, "nagelkerke": 0.0369553, "mcfadden": 0.0137048, "N": 116, "m2llGeneral": 266.3323403, "chiParallel": 22.3741707, "dfParallel": 18},
  parallel: {"est": [-3.6629007, -0.95883, 1.0631844, 3.0688488, -0.0085272, 0.0614952], "se": [1.2364102, 1.1108792, 1.1109227, 1.1793818, 0.022851, 0.4132347], "names": ["hours", "gpa"], "m2ll0": 292.7181677, "m2ll1": 292.5781866, "chi": 0.1399811, "df": 2, "pearson": 462.8764144, "deviance": 292.5781866, "dfgof": 458, "coxSnell": 0.001206, "nagelkerke": 0.0013111, "mcfadden": 0.0004782, "N": 116, "m2llGeneral": 286.8112409, "chiParallel": 5.7669456, "dfParallel": 6},
  weighted: {"est": [-3.1375388, -0.6346126, 1.3744246, 3.0415361, -0.0116734, 0.1821656], "se": [0.7616768, 0.7041543, 0.7084064, 0.738843, 0.0136069, 0.2631596], "names": ["hours", "gpa"], "m2ll0": 775.3828732, "m2ll1": 774.4558282, "chi": 0.927045, "df": 2, "pearson": 1185.0632782, "deviance": 774.4558282, "dfgof": 458, "coxSnell": 0.0030957, "nagelkerke": 0.0033459, "mcfadden": 0.0011956, "N": 299, "m2llGeneral": 756.1272233, "chiParallel": 18.3286049, "dfParallel": 6},
  female: {"est": [-3.1677009, 0.1998415, 2.2405459, 4.0707005, 0.0220313, 0.1753483], "se": [1.723548, 1.4316357, 1.4652083, 1.5621159, 0.0279471, 0.537403], "names": ["hours", "gpa"], "m2ll0": 160.4803877, "m2ll1": 159.4801101, "chi": 1.0002775, "df": 2, "pearson": 252.325586, "deviance": 159.4801101, "dfgof": 254, "coxSnell": 0.0152711, "nagelkerke": 0.0166838, "mcfadden": 0.006233, "N": 65, "m2llGeneral": 146.8551806, "chiParallel": 12.6249295, "dfParallel": 6},
  half1: {"est": [-2.1098807, -0.2380481, 1.5193491, 4.1683207, -0.0294225, 0.5448453], "se": [1.7685454, 1.7129091, 1.7293392, 1.8480788, 0.031678, 0.6324236], "names": ["hours", "gpa"], "m2ll0": 151.3438349, "m2ll1": 150.0535113, "chi": 1.2903235, "df": 2, "pearson": 235.6922738, "deviance": 150.0535113, "dfgof": 222, "coxSnell": 0.022383, "nagelkerke": 0.0240751, "mcfadden": 0.0085258, "N": 57, "m2llGeneral": 143.5898361, "chiParallel": 6.4636752, "dfParallel": 6},
  half2: {"est": [-1.5597682, 0.8950691, 2.2334338, 0.0265391, -0.4985984], "se": [1.5263658, 1.5149097, 1.5887802, 0.0343535, 0.5734553], "names": ["hours", "gpa"], "m2ll0": 130.3544126, "m2ll1": 129.3557725, "chi": 0.9986401, "df": 2, "pearson": 190.1344181, "deviance": 129.3557725, "dfgof": 172, "coxSnell": 0.0167837, "nagelkerke": 0.0188531, "mcfadden": 0.007661, "N": 59, "m2llGeneral": 113.2446807, "chiParallel": 16.1110917, "dfParallel": 4},
  cloglog: {"est": [-3.6159506, -1.0698723, 0.3614856, 1.2122867, -0.0185929, 0.1723867], "se": [0.885637, 0.6947543, 0.6813028, 0.689108, 0.0140184, 0.259928], "names": ["hours", "gpa"], "m2ll0": 292.7181677, "m2ll1": 290.9010711, "chi": 1.8170965, "df": 2, "pearson": 455.8709379, "deviance": 290.9010711, "dfgof": 458, "coxSnell": 0.0155426, "nagelkerke": 0.0168975, "mcfadden": 0.0062077, "N": 116, "m2llGeneral": 286.0618183, "chiParallel": 4.8392529, "dfParallel": 6},
  nloglog: {"est": [-1.2636231, -0.1936272, 1.2819458, 3.1575538, 0.0031617, -0.0143988], "se": [0.6618618, 0.6550219, 0.6718195, 0.7845057, 0.01146, 0.2322228], "names": ["hours", "gpa"], "m2ll0": 292.7181677, "m2ll1": 292.6420402, "chi": 0.0761275, "df": 2, "pearson": 465.8360677, "deviance": 292.6420402, "dfgof": 458, "coxSnell": 0.0006561, "nagelkerke": 0.0007132, "mcfadden": 0.0002601, "N": 116, "m2llGeneral": 286.9679579, "chiParallel": 5.6740823, "dfParallel": 6},
  cauchit: {"est": [-12.3425127, -0.8920128, 0.9126848, 7.2753073, 0.0016825, -0.0473549], "se": [7.1799846, 1.1628015, 1.1699211, 3.5470005, 0.0287973, 0.4286338], "names": ["hours", "gpa"], "m2ll0": 292.7181677, "m2ll1": 292.7056527, "chi": 0.012515, "df": 2, "pearson": 464.2726156, "deviance": 292.7056527, "dfgof": 458, "coxSnell": 0.0001079, "nagelkerke": 0.0001173, "mcfadden": 4.28e-05, "N": 116, "m2llGeneral": 282.9695369, "chiParallel": 9.7361159, "dfParallel": 6},
};

type Ref = (typeof REF)[keyof typeof REF];
const base = students as unknown as Dataset;

/** Copy of the students sample with an extra numeric variable. */
function withVar(name: string, values: (number | null)[], ds: Dataset = structuredClone(base)): Dataset {
  const v: Variable = makeVariable(name, { print: { type: 'F', w: 2, d: 0 }, write: { type: 'F', w: 2, d: 0 } });
  ds.variables.push(v);
  ds.columns.push(values);
  return ds;
}
const col = (name: string) => base.columns[base.variables.findIndex((v) => v.name === name)] as (number | string | null)[];

let sink: PlumRaw[] = [];
beforeEach(() => {
  sink = [];
  inspect.sink = sink;
});
afterEach(() => {
  inspect.sink = null;
});

function run(syntax: string, ds: Dataset = base, lang: 'cs' | 'en' = 'en', decimal: '.' | ',' = '.') {
  const out = runExt(syntax, ds, lang, decimal);
  expect(errorsOf(out)).toEqual([]);
  return out;
}
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const warnings = (out: ReturnType<typeof runExt>) => flatItems(out).flatMap((i) => (i.kind === 'message' && i.severity === 'warning' ? [i.text] : []));

function checkRaw(r: PlumRaw, ref: Ref, seTol = 2e-5) {
  expect(r.params.length).toBe(ref.est.length);
  ref.est.forEach((e, i) => close(r.params[i], e, 1e-5));
  ref.se.forEach((s, i) => close(r.se[i], s, seTol));
  close(-2 * (r.ll + r.logConst), ref.m2ll1, 1e-7);
  close(-2 * (r.ll0 + r.logConst), ref.m2ll0, 1e-7);
  close(r.pearson, ref.pearson, 1e-6);
  close(r.deviance, ref.deviance, 1e-6);
}

/** Numeric cell of the row whose stub ends with LABEL (COL counts the value cells). */
function cell(out: ReturnType<typeof runExt>, caption: string, label: string, colIdx: number): number | null {
  const t = tables(out).find((x) => x.caption.startsWith(caption));
  if (!t) throw new Error(`no table ${caption}`);
  const row = t.rows.find((r) => r.some((c) => c.header && c.text === label));
  if (!row) throw new Error(`no row ${label} in ${caption}`);
  return row.filter((c) => !c.header)[colIdx].num;
}

describe('PLUM logit: satisf BY faculty WITH hours gpa', () => {
  const syntax = 'PLUM satisf BY faculty WITH hours gpa /PRINT=FIT PARAMETER SUMMARY TPARALLEL.';
  it('estimates, standard errors, likelihoods and fit statistics match statsmodels', () => {
    run(syntax);
    expect(sink).toHaveLength(1);
    checkRaw(sink[0], REF.logit);
    close(-2 * (sink[0].llGeneral! + sink[0].logConst), REF.logit.m2llGeneral, 1e-6);
  });
  it('tables have SPSS layout and values', () => {
    const out = run(syntax);
    const caps = tables(out).map((t) => t.caption);
    expect(caps).toEqual(['Case Processing Summary', 'Model Fitting Information', 'Goodness-of-Fit', 'Pseudo R-Square', 'Parameter Estimates', 'Test of Parallel Linesᵃ']);
    expect(cell(out, 'Case Processing Summary', 'Valid', 0)).toBe(116);
    expect(cell(out, 'Case Processing Summary', 'Missing', 0)).toBe(4);
    expect(cell(out, 'Case Processing Summary', 'Neutral', 0)).toBe(54);
    const r = REF.logit;
    close(cell(out, 'Model Fitting Information', 'Intercept Only', 0)!, r.m2ll0, 2e-6);
    close(cell(out, 'Model Fitting Information', 'Final', 0)!, r.m2ll1, 2e-6);
    close(cell(out, 'Model Fitting Information', 'Final', 1)!, r.chi, 1e-3);
    expect(cell(out, 'Model Fitting Information', 'Final', 2)).toBe(r.df);
    close(cell(out, 'Goodness-of-Fit', 'Pearson', 0)!, r.pearson, 1e-3);
    expect(cell(out, 'Goodness-of-Fit', 'Deviance', 1)).toBe(r.dfgof);
    close(cell(out, 'Pseudo R-Square', 'Cox and Snell', 0)!, r.coxSnell, 6e-4);
    close(cell(out, 'Pseudo R-Square', 'Nagelkerke', 0)!, r.nagelkerke, 6e-4);
    close(cell(out, 'Pseudo R-Square', 'McFadden', 0)!, r.mcfadden, 6e-4);
    close(cell(out, 'Parameter Estimates', '[satisf = 1]', 0)!, r.est[0], 6e-4);
    close(cell(out, 'Parameter Estimates', '[faculty=2]', 0)!, r.est[7], 6e-4);
    close(cell(out, 'Parameter Estimates', 'gpa', 1)!, r.se[5], 6e-4);
    const pe = tables(out).find((t) => t.caption === 'Parameter Estimates')!;
    const red = pe.rows.find((x) => x.some((c) => c.text === '[faculty=5]'))!.filter((c) => !c.header);
    expect(red.map((c) => c.text)).toEqual(['0ᵇ', '', '', '0', '', '', '']);
    expect(pe.rows.filter((x) => x[0].text === 'Threshold')).toHaveLength(4);
    expect(pe.footnotes).toEqual(['Link function: Logit.', 'This parameter is set to zero because it is redundant.']);
    // CI = estimate ± 1.96 SE
    close(cell(out, 'Parameter Estimates', 'hours', 5)!, r.est[4] - 1.959964 * r.se[4], 6e-4);
    close(cell(out, 'Test of Parallel Lines', 'General', 1)!, r.chiParallel, 1e-3);
    expect(cell(out, 'Test of Parallel Lines', 'General', 2)).toBe(r.dfParallel);
  });
  it('LOCATION with the main effects equals the default model; Czech output uses a decimal comma', () => {
    run('PLUM satisf BY faculty WITH hours gpa /LOCATION=hours gpa faculty.');
    const out = run(syntax, base, 'cs', ',');
    expect(sink[1].params).toEqual(sink[0].params);
    const pe = tables(out).find((t) => t.caption === 'Odhady parametrů')!;
    expect(pe.rows.some((x) => x[0].text === 'Práh' && x.some((c) => c.text === '-4,441'))).toBe(true);
    expect(tables(out).map((t) => t.caption)).toContain('Test paralelních přímek' + 'ᵃ');
  });
});

describe('PLUM links', () => {
  it('PROBIT', () => {
    run('PLUM satisf BY faculty WITH hours gpa /LINK=PROBIT /PRINT=TPARALLEL.');
    checkRaw(sink[0], REF.probit);
    close(-2 * (sink[0].llGeneral! + sink[0].logConst), REF.probit.m2llGeneral, 1e-6);
  });
  it('CLOGLOG, NLOGLOG, CAUCHIT', () => {
    run('PLUM satisf WITH hours gpa /LINK=CLOGLOG.');
    checkRaw(sink[0], REF.cloglog);
    run('PLUM satisf WITH hours gpa /LINK=NLOGLOG.');
    checkRaw(sink[1], REF.nloglog);
    run('PLUM satisf WITH hours gpa /LINK=CAUCHIT.');
    checkRaw(sink[2], REF.cauchit, 2e-4);
  });
  it('names the link in the footnotes', () => {
    const out = run('PLUM satisf WITH hours gpa /LINK=CLOGLOG.');
    expect(tables(out).find((t) => t.caption === 'Model Fitting Information')!.footnotes).toEqual(['Link function: Complementary Log-log.']);
  });
});

describe('PLUM data handling', () => {
  it('test of parallel lines on covariates only', () => {
    const out = run('PLUM satisf WITH hours gpa /PRINT=TPARALLEL.');
    checkRaw(sink[0], REF.parallel);
    close(-2 * (sink[0].llGeneral! + sink[0].logConst), REF.parallel.m2llGeneral, 1e-6);
    expect(cell(out, 'Test of Parallel Lines', 'General', 2)).toBe(6);
    expect(tables(out).map((t) => t.caption)).toEqual(['Case Processing Summary', 'Model Fitting Information', 'Test of Parallel Linesᵃ']);
  });
  it('frequency weights enter the likelihood (WEIGHT BY year = replicated cases)', () => {
    const ds = structuredClone(base);
    ds.weight = 'year';
    const out = run('PLUM satisf WITH hours gpa /PRINT=FIT SUMMARY PARAMETER.', ds);
    checkRaw(sink[0], REF.weighted);
    expect(cell(out, 'Case Processing Summary', 'Valid', 0)).toBe(REF.weighted.N);
    close(cell(out, 'Pseudo R-Square', 'Nagelkerke', 0)!, REF.weighted.nagelkerke, 6e-4);
  });
  it('PRINT=KERNEL shows the kernel of −2LL (differs from the full one by the multinomial constant)', () => {
    // python: x = students[satisf != 9]; t = crosstab(faculty, satisf); Σ lnΓ(n_i+1) − Σ lnΓ(y_ij+1)
    const full = run('PLUM satisf BY faculty.');
    const kern = run('PLUM satisf BY faculty /PRINT=KERNEL.');
    close(sink[0].logConst, 117.13628101705172, 1e-10);
    close(cell(kern, 'Model Fitting Information', 'Final', 0)!, -2 * sink[0].ll, 1e-5);
    close(cell(full, 'Model Fitting Information', 'Final', 0)!, -2 * (sink[0].ll + 117.13628101705172), 1e-5);
    expect(cell(full, 'Model Fitting Information', 'Final', 1)).toBe(cell(kern, 'Model Fitting Information', 'Final', 1));
  });
  it('FILTER', () => {
    const ds = withVar('female', col('gender').map((g) => (g === 1 ? 1 : 0)));
    ds.filter = 'female';
    run('PLUM satisf WITH hours gpa.', ds);
    checkRaw(sink[0], REF.female);
  });
  it('SPLIT FILE: one model per group; a category absent from a group is dropped', () => {
    const ds = withVar('half', col('id').map((_, i) => (i < 60 ? 1 : 2)));
    ds.split = ['half'];
    const out = run('PLUM satisf WITH hours gpa.', ds);
    expect(sink).toHaveLength(2);
    checkRaw(sink[0], REF.half1);
    checkRaw(sink[1], REF.half2);
    expect(flatItems(out).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['half = 1', 'half = 2']);
    const pe = tables(out).filter((t) => t.caption === 'Parameter Estimates');
    expect(pe[1].rows.filter((r) => r[0].text === 'Threshold')).toHaveLength(3);
  });
  it('user-missing values are excluded listwise; MISSING=INCLUDE keeps them', () => {
    let out = run('PLUM satisf WITH gpa.');
    expect(cell(out, 'Case Processing Summary', 'Missing', 0)).toBe(4);
    out = run('PLUM satisf WITH gpa /MISSING=INCLUDE.');
    expect(cell(out, 'Case Processing Summary', 'No answer', 0)).toBe(2);
    expect(sink[1].params).toHaveLength(5 + 1);
  });
  it('string dependent and string factor', () => {
    const out = run('PLUM commute BY gender WITH gpa.');
    const pe = tables(out).find((t) => t.caption === 'Parameter Estimates')!;
    expect(pe.rows.map((r) => r.find((c) => c.header && c.text.startsWith('['))?.text).filter(Boolean)).toEqual([
      '[commute = bike]', '[commute = car]', '[commute = transit]', '[gender=1]', '[gender=2]', '[gender=3]',
    ]);
    run('PLUM satisf BY commute.');
  });
  it('interactions on LOCATION', () => {
    const out = run('PLUM satisf BY faculty job WITH hours /LOCATION=hours faculty job faculty*job.');
    const pe = tables(out).find((t) => t.caption === 'Parameter Estimates')!;
    const loc = pe.rows.filter((r) => r.some((c) => c.header && /\[faculty=\d\] \* \[job=\d\]/.test(c.text)));
    expect(loc).toHaveLength(10);
    // with both main effects, cells where either factor is at its last level are redundant
    const redundant = loc.filter((r) => r.some((c) => c.text === '0ᵇ')).map((r) => r.find((c) => c.header && c.text.includes('*'))!.text);
    expect(redundant).toEqual(['[faculty=1] * [job=1]', '[faculty=2] * [job=1]', '[faculty=3] * [job=1]', '[faculty=4] * [job=1]', '[faculty=5] * [job=0]', '[faculty=5] * [job=1]']);
    expect(sink[0].params).toHaveLength(4 + 1 + 4 + 1 + 4);
  });
});

describe('PLUM warnings and errors', () => {
  const synth = (y: number[], x: number[], g?: number[]): Dataset => {
    const ds = structuredClone(base);
    ds.variables = [makeVariable('y'), makeVariable('x'), makeVariable('g')];
    ds.columns = [y, x, g ?? x.map(() => 1)];
    ds.weight = null;
    ds.filter = null;
    ds.split = [];
    return ds;
  };
  it('complete separation', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const out = run('PLUM y WITH x.', synth(x.map((v) => Math.ceil(v / 4)), x));
    const w = warnings(out);
    expect(w.some((m) => m.includes('complete separation'))).toBe(true);
    expect(w.some((m) => m.includes('continues despite'))).toBe(true);
  });
  it('quasi-complete separation (a factor level with all cases in the top category)', () => {
    const y = [3, 3, 3, 3, 1, 2, 3, 1, 2, 2, 1, 3];
    const g = [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2];
    const out = run('PLUM y BY g.', synth(y, y.map((_, i) => i), g));
    expect(warnings(out).some((m) => m.includes('quasi-complete separation'))).toBe(true);
  });
  it('one observed category', () => {
    const ds = withVar('three', col('satisf').map((s) => (s === 3 ? 1 : 0)));
    ds.filter = 'three';
    const out = run('PLUM satisf WITH gpa.', ds);
    expect(warnings(out).some((m) => m.includes('only one observed category'))).toBe(true);
  });
  it('no valid cases', () => {
    const ds = withVar('none', col('id').map(() => 0));
    ds.filter = 'none';
    expect(warnings(run('PLUM satisf WITH gpa.', ds))).toEqual(['There are no valid cases for the analysis.']);
  });
  it('iteration history and criteria', () => {
    const out = run('PLUM satisf WITH hours gpa /CRITERIA=MXITER(2) /PRINT=HISTORY(1).');
    const h = tables(out).find((t) => t.caption === 'Iteration History')!;
    expect(h.rows.filter((r) => r[0].num !== null && !r[0].span).map((r) => r[0].num)).toEqual([0, 1, 2]);
    expect(warnings(out).some((m) => m.includes('maximum number of iterations (2)'))).toBe(true);
  });
  it('syntax errors', () => {
    const err = (s: string) => errorsOf(runExt(s, base))[0] ?? '';
    expect(err('PLUM satisf WITH gpa /LINK=FOO.')).toMatch(/LINK must be/);
    expect(err('PLUM satisf WITH gpa /SCALE=gpa.')).toMatch(/SCALE/);
    expect(err('PLUM satisf BY faculty gender /LOCATION=faculty(gender).')).toMatch(/Nested/);
    expect(err('PLUM satisf WITH gpa /LOCATION=hours.')).toMatch(/not a factor or covariate/);
    expect(err('PLUM satisf WITH satisf.')).toMatch(/only once/);
    expect(err('PLUM satisf WITH gpa /CRITERIA=CIN(150).')).toMatch(/CIN/);
    expect(err('PLUM satisf WITH commute.')).toMatch(/string/);
  });
});
