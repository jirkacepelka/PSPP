/*
 * NOMREG against statsmodels' MNLogit (which uses the category coded 0 as the base: the script
 * codes the SPSS reference category as 0, so its parameters compare directly), with the full
 * multinomial log-likelihood, Pearson/deviance over subpopulations, pseudo R², likelihood-ratio
 * tests of each effect and the classification table computed in the script below. Frequency
 * weights are checked against replicated cases.
 *
 * Reference script (python3 -W ignore ref_nomreg.py; statsmodels 0.15):
 *
 * import json, numpy as np, pandas as pd
 * from scipy import stats
 * from scipy.special import gammaln
 * from statsmodels.discrete.discrete_model import MNLogit
 * d = json.load(open('/home/user/PSPP/web/src/samples/students.json'))
 * df = pd.DataFrame({v['name']: c for v, c in zip(d['variables'], d['columns'])})
 *
 * def design(x, factors, covs, effects=None):
 *     cols, names = [np.ones(len(x))], ['Intercept']
 *     eff = [[c] for c in covs] + [[f] for f in factors] if effects is None else effects
 *     for e in eff:
 *         if e[0] in covs: cols.append(x[e[0]].astype(float).values); names.append(e[0])
 *         else:
 *             lv = sorted(x[e[0]].unique())
 *             for l in lv[:-1]: cols.append((x[e[0]] == l).astype(float).values); names.append(f'[{e[0]}={l}]')
 *     return np.column_stack(cols), names
 *
 * def fit(df, dep, factors, covs, base='last', w=None, missing9=False):
 *     x = df[[dep] + factors + covs].copy()
 *     x['_w'] = 1.0 if w is None else df[w].astype(float)
 *     if missing9: x = x[x[dep] != 9]
 *     x = x[x.notna().all(axis=1) & (x['_w'] > 0)]
 *     cats = sorted(x[dep].unique()); K = len(cats)
 *     ref = cats[-1] if base == 'last' else cats[0] if base == 'first' else base
 *     others = [c for c in cats if c != ref]
 *     code = {ref: 0, **{c: i + 1 for i, c in enumerate(others)}}   # MNLogit base = code 0
 *     rep = x['_w'].astype(int).values
 *     xr = x.loc[x.index.repeat(rep)].reset_index(drop=True)
 *     y = xr[dep].map(code).values
 *     def mfit(effects=None, const=True):
 *         X, names = design(xr, factors, covs, effects)
 *         if not const: X, names = X[:, 1:], names[1:]
 *         res = MNLogit(y, X).fit(method='newton', maxiter=200, tol=1e-14, disp=False)
 *         return res, X, names
 *     res, X, names = mfit()
 *     N = len(y); n = np.bincount(y, minlength=K)
 *     ll0 = (n * np.log(n / N)).sum(); ll1 = res.llf
 *     key = pd.DataFrame(X).astype(str).agg('|'.join, axis=1)
 *     g = pd.crosstab(key, pd.Categorical(y, categories=range(K)))
 *     Xs = pd.DataFrame(X).groupby(key.values).first().loc[g.index].values
 *     eta = np.column_stack([np.zeros(len(Xs)), Xs @ res.params])
 *     pi = np.exp(eta) / np.exp(eta).sum(1, keepdims=True)
 *     Y = g.values.astype(float); ni = Y.sum(1, keepdims=True); E = ni * pi
 *     const = (gammaln(ni[:, 0] + 1) - gammaln(Y + 1).sum(1)).sum()
 *     q = X.shape[1]; s = len(Y)
 *     cs = 1 - np.exp(2 * (ll0 - ll1) / N)
 *     # LR tests: drop each effect (intercept: equivalent model when a factor is present)
 *     lrt = {}
 *     for e in [[c] for c in covs] + [[f] for f in factors]:
 *         eff = [ee for ee in [[c] for c in covs] + [[f] for f in factors] if ee != e]
 *         r2, X2, _ = mfit(eff)
 *         lrt[e[0]] = dict(m2ll=-2 * (r2.llf + const), chi=2 * (ll1 - r2.llf), df=(K - 1) * (q - X2.shape[1]))
 *     if not factors:
 *         r2, X2, _ = mfit(None, const=False)
 *         lrt['Intercept'] = dict(m2ll=-2 * (r2.llf + const), chi=2 * (ll1 - r2.llf), df=(K - 1))
 *     # classification (argmax of fitted probabilities), rows observed, cols predicted, by code order
 *     P = res.predict(X); pred = P.argmax(1)
 *     ct = np.zeros((K, K))
 *     for a, b in zip(y, pred): ct[a, b] += 1
 *     # parameters per non-reference category in category order, rows = names
 *     B = res.params.T.tolist(); SE = np.asarray(res.bse).T.tolist()
 *     return dict(cats=[str(c) for c in cats], ref=str(ref), others=[str(o) for o in others], names=names, B=B, SE=SE,
 *                 m2ll0=-2 * (ll0 + const), m2ll1=-2 * (ll1 + const), chi=2 * (ll1 - ll0), df=(K - 1) * (q - 1),
 *                 pearson=((Y - E) ** 2 / E).sum(), deviance=2 * np.where(Y > 0, Y * np.log(np.where(Y > 0, Y, 1) / E), 0).sum(),
 *                 dfgof=s * (K - 1) - (K - 1) * q, subpop=s, coxSnell=cs, nagelkerke=cs / (1 - np.exp(2 * ll0 / N)), mcfadden=1 - ll1 / ll0,
 *                 lrt=lrt, classCodes=ct.tolist(), N=N)
 *
 * R = {
 *   'main': fit(df, 'commute', ['job'], ['gpa', 'hours']),
 *   'first': fit(df, 'commute', ['job'], ['gpa', 'hours'], base='first'),
 *   'covs': fit(df, 'satisf', [], ['gpa', 'hours'], missing9=True),
 *   'weighted': fit(df, 'commute', ['job'], ['gpa'], w='year'),
 *   'car': fit(df, 'commute', [], ['gpa'], base='car'),
 *   'female': fit(df[df.gender == 1], 'commute', [], ['gpa']),
 * }
 * def rnd(v):
 *     if isinstance(v, dict): return {k: rnd(x) for k, x in v.items()}
 *     if isinstance(v, list): return [rnd(x) for x in v]
 *     if isinstance(v, (float, np.floating)): return round(float(v), 7)
 *     if isinstance(v, np.integer): return int(v)
 *     return v
 * print(json.dumps(rnd(R)))
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import students from '../../samples/students.json';
import type { Dataset, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { errorsOf, flatItems, runExt, tables } from '../testing';
import { inspect, type NomregRaw } from './nomreg';

const REF = {
  main: {"cats": ["bike", "car", "transit", "walk"], "ref": "walk", "others": ["bike", "car", "transit"], "names": ["Intercept", "gpa", "hours", "[job=0]"], "B": [[-1.4768604, -0.1473656, 0.0555734, 0.5027183], [-2.0758086, 0.4656967, -0.0080355, 0.4366618], [1.3428575, -0.339297, -0.0157356, 0.907358]], "SE": [[1.9573263, 0.7001888, 0.0363583, 0.5877658], [2.2726975, 0.7976909, 0.0415297, 0.6760192], [1.5812945, 0.5706949, 0.03082, 0.4938472]], "m2ll0": 300.3008368, "m2ll1": 290.1326473, "chi": 10.1681895, "df": 9, "pearson": 358.1527153, "deviance": 290.1326473, "dfgof": 342, "subpop": 118, "coxSnell": 0.0825628, "nagelkerke": 0.089594, "mcfadden": 0.03386, "lrt": {"gpa": {"m2ll": 291.4535092, "chi": 1.3208619, "df": 3}, "hours": {"m2ll": 295.116184, "chi": 4.9835367, "df": 3}, "job": {"m2ll": 293.5728953, "chi": 3.440248, "df": 3}}, "classCodes": [[2.0, 2.0, 0.0, 24.0], [3.0, 4.0, 0.0, 16.0], [2.0, 1.0, 0.0, 11.0], [3.0, 2.0, 0.0, 48.0]], "N": 118},
  first: {"cats": ["bike", "car", "transit", "walk"], "ref": "bike", "others": ["car", "transit", "walk"], "names": ["Intercept", "gpa", "hours", "[job=0]"], "B": [[-0.5989482, 0.6130623, -0.0636089, -0.0660565], [2.819718, -0.1919314, -0.071309, 0.4046397], [1.4768604, 0.1473656, -0.0555734, -0.5027183]], "SE": [[2.3995554, 0.8398567, 0.043781, 0.7185439], [1.7638528, 0.6246915, 0.0336084, 0.5548436], [1.9573263, 0.7001888, 0.0363583, 0.5877658]], "m2ll0": 300.3008368, "m2ll1": 290.1326473, "chi": 10.1681895, "df": 9, "pearson": 358.1527153, "deviance": 290.1326473, "dfgof": 342, "subpop": 118, "coxSnell": 0.0825628, "nagelkerke": 0.089594, "mcfadden": 0.03386, "lrt": {"gpa": {"m2ll": 291.4535092, "chi": 1.3208619, "df": 3}, "hours": {"m2ll": 295.116184, "chi": 4.9835367, "df": 3}, "job": {"m2ll": 293.5728953, "chi": 3.440248, "df": 3}}, "classCodes": [[4.0, 0.0, 16.0, 3.0], [1.0, 0.0, 11.0, 2.0], [2.0, 0.0, 48.0, 3.0], [2.0, 0.0, 24.0, 2.0]], "N": 118},
  covs: {"cats": ["1", "2", "3", "4", "5"], "ref": "5", "others": ["1", "2", "3", "4"], "names": ["Intercept", "gpa", "hours"], "B": [[0.1310977, -0.583891, 0.0497854], [3.0721732, -1.0237197, 0.0758547], [2.9730951, -1.0638375, 0.1093218], [3.2202801, -1.1320917, 0.0724897]], "SE": [[5.0210936, 1.7873949, 0.0970734], [3.4133701, 1.2036985, 0.0655777], [3.3353787, 1.1748478, 0.0642742], [3.4611495, 1.2236873, 0.0667144]], "m2ll0": 292.7181677, "m2ll1": 287.6230514, "chi": 5.0951163, "df": 8, "pearson": 458.0099652, "deviance": 287.6230514, "dfgof": 452, "subpop": 116, "coxSnell": 0.0429728, "nagelkerke": 0.0467189, "mcfadden": 0.0174062, "lrt": {"gpa": {"m2ll": 288.6459118, "chi": 1.0228604, "df": 4}, "hours": {"m2ll": 292.092458, "chi": 4.4694066, "df": 4}, "Intercept": {"m2ll": 289.1248832, "chi": 1.5018318, "df": 4}}, "classCodes": [[0.0, 0.0, 0.0, 5.0, 0.0], [0.0, 0.0, 0.0, 3.0, 0.0], [0.0, 0.0, 1.0, 29.0, 0.0], [0.0, 0.0, 0.0, 54.0, 0.0], [0.0, 0.0, 1.0, 23.0, 0.0]], "N": 116},
  weighted: {"cats": ["bike", "car", "transit", "walk"], "ref": "walk", "others": ["bike", "car", "transit"], "names": ["Intercept", "gpa", "[job=0]"], "B": [[-0.1014091, -0.0688176, -0.1017761], [-1.521952, -0.0307102, 1.1461562], [0.684219, -0.2964262, 0.9404318]], "SE": [[1.2236172, 0.4203589, 0.3489461], [1.4439023, 0.4857671, 0.4781019], [1.0087315, 0.3455341, 0.3065499]], "m2ll0": 734.0953123, "m2ll1": 715.4619436, "chi": 18.6333687, "df": 6, "pearson": 805.4696566, "deviance": 693.2778348, "dfgof": 294, "subpop": 101, "coxSnell": 0.0588898, "nagelkerke": 0.0638462, "mcfadden": 0.023748, "lrt": {"gpa": {"m2ll": 716.4054636, "chi": 0.9435199, "df": 3}, "job": {"m2ll": 732.5975971, "chi": 17.1356535, "df": 3}}, "classCodes": [[33.0, 0.0, 0.0, 48.0], [26.0, 0.0, 0.0, 31.0], [7.0, 0.0, 0.0, 29.0], [23.0, 0.0, 0.0, 110.0]], "N": 307},
  car: {"cats": ["bike", "car", "transit", "walk"], "ref": "car", "others": ["bike", "transit", "walk"], "names": ["Intercept", "gpa"], "B": [[1.2758169, -0.2753029], [3.6165179, -0.8217847], [1.9456315, -0.4448393]], "SE": [[2.2957846, 0.8002805], [2.0416794, 0.7147732], [2.2111669, 0.7728307]], "m2ll0": 269.6958718, "m2ll1": 267.8387316, "chi": 1.8571403, "df": 3, "pearson": 273.8695497, "deviance": 243.5330753, "dfgof": 270, "subpop": 92, "coxSnell": 0.0156153, "nagelkerke": 0.0169451, "mcfadden": 0.0061843, "lrt": {"gpa": {"m2ll": 269.6958718, "chi": 1.8571403, "df": 3}, "Intercept": {"m2ll": 272.4014296, "chi": 4.562698, "df": 3}}, "classCodes": [[0.0, 0.0, 14.0, 0.0], [0.0, 0.0, 23.0, 0.0], [0.0, 0.0, 53.0, 0.0], [0.0, 0.0, 28.0, 0.0]], "N": 118},
  female: {"cats": ["bike", "car", "transit", "walk"], "ref": "walk", "others": ["bike", "car", "transit"], "names": ["Intercept", "gpa"], "B": [[0.7395956, -0.3933197], [-0.068646, -0.2949738], [0.7236021, -0.0438775]], "SE": [[2.4159334, 0.8646838], [2.876553, 1.0280439], [1.9590638, 0.6911726]], "m2ll0": 158.9940828, "m2ll1": 158.7010244, "chi": 0.2930584, "df": 3, "pearson": 178.2815626, "deviance": 150.3832582, "dfgof": 171, "subpop": 59, "coxSnell": 0.0043645, "nagelkerke": 0.0047559, "mcfadden": 0.0017516, "lrt": {"gpa": {"m2ll": 158.9940828, "chi": 0.2930584, "df": 3}, "Intercept": {"m2ll": 158.9104453, "chi": 0.2094209, "df": 3}}, "classCodes": [[0.0, 0.0, 0.0, 17.0], [0.0, 0.0, 0.0, 12.0], [0.0, 0.0, 0.0, 7.0], [0.0, 0.0, 0.0, 31.0]], "N": 67},
};

type Ref = (typeof REF)[keyof typeof REF];
const base = students as unknown as Dataset;

function withVar(name: string, values: (number | null)[], ds: Dataset = structuredClone(base)): Dataset {
  const v: Variable = makeVariable(name, { print: { type: 'F', w: 2, d: 0 }, write: { type: 'F', w: 2, d: 0 } });
  ds.variables.push(v);
  ds.columns.push(values);
  return ds;
}
const col = (name: string) => base.columns[base.variables.findIndex((v) => v.name === name)] as (number | string | null)[];

let sink: NomregRaw[] = [];
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

function checkRaw(r: NomregRaw, ref: Ref) {
  expect(r.B.length).toBe(ref.B.length);
  ref.B.forEach((row, k) => row.forEach((b, c) => close(r.B[k][c], b, 1e-5)));
  ref.SE.forEach((row, k) => row.forEach((s, c) => close(r.SE[k][c], s, 1e-5)));
  close(-2 * (r.ll + r.logConst), ref.m2ll1, 1e-7);
  close(-2 * (r.ll0 + r.logConst), ref.m2ll0, 1e-7);
  close(r.pearson, ref.pearson, 1e-6);
  close(r.deviance, ref.deviance, 1e-6);
}

function table(out: ReturnType<typeof runExt>, caption: string) {
  const t = tables(out).find((x) => x.caption.startsWith(caption));
  if (!t) throw new Error(`no table ${caption}`);
  return t;
}
/** Value cells of the first row having a stub cell LABEL (and, if given, a stub cell GROUP). */
function rowNums(out: ReturnType<typeof runExt>, caption: string, label: string, group?: string): (number | null)[] {
  const row = table(out, caption).rows.find((r) => r.some((c) => !c.header) && r.some((c) => c.header && c.text === label) && (!group || r.some((c) => c.header && c.text === group)));
  if (!row) throw new Error(`no row ${label} in ${caption}`);
  return row.filter((c) => !c.header).map((c) => c.num);
}

/** Checks the 3-decimal table values against the reference. */
function checkTables(out: ReturnType<typeof runExt>, ref: Ref, labels: Record<string, string>) {
  const t = 6e-4;
  close(rowNums(out, 'Model Fitting Information', 'Final')[0]!, ref.m2ll1, 2e-6);
  close(rowNums(out, 'Model Fitting Information', 'Final')[1]!, ref.chi, t);
  expect(rowNums(out, 'Model Fitting Information', 'Final')[2]).toBe(ref.df);
  close(rowNums(out, 'Pseudo R-Square', 'Nagelkerke')[0]!, ref.nagelkerke, t);
  close(rowNums(out, 'Pseudo R-Square', 'McFadden')[0]!, ref.mcfadden, t);
  close(rowNums(out, 'Pseudo R-Square', 'Cox and Snell')[0]!, ref.coxSnell, t);
  for (const [effect, v] of Object.entries(ref.lrt)) {
    const r = rowNums(out, 'Likelihood Ratio Tests', effect);
    close(r[0]!, v.m2ll, 2e-6);
    close(r[1]!, v.chi, t);
    expect(r[2]).toBe(v.df);
  }
  ref.others.forEach((o, k) =>
    ref.names.forEach((n, c) => {
      const r = rowNums(out, 'Parameter Estimates', n, labels[o]);
      close(r[0]!, ref.B[k][c], t);
      close(r[1]!, ref.SE[k][c], t);
      if (n !== 'Intercept') close(r[5]!, Math.exp(ref.B[k][c]), t);
    }),
  );
}

const COMMUTE = { bike: 'Bicycle', car: 'Car', transit: 'Public transport', walk: 'Walking' } as Record<string, string>;

describe('NOMREG commute BY job WITH gpa hours', () => {
  const syntax = 'NOMREG commute BY job WITH gpa hours /PRINT=PARAMETER SUMMARY LRT FIT CLASSTABLE CPS MFI.';
  it('estimates, standard errors and likelihoods match statsmodels (reference category last)', () => {
    const out = run(syntax);
    checkRaw(sink[0], REF.main);
    checkTables(out, REF.main, COMMUTE);
    expect(warnings(out)).toEqual(['There are 354 (75.0%) cells (i.e., dependent variable levels by observed combinations of predictor variable values) with zero frequencies.']);
  });
  it('tables have SPSS layout', () => {
    const out = run(syntax);
    expect(tables(out).map((t) => t.caption)).toEqual([
      'Case Processing Summary', 'Model Fitting Information', 'Goodness-of-Fit', 'Pseudo R-Square', 'Likelihood Ratio Tests', 'Parameter Estimates', 'Classification',
    ]);
    expect(rowNums(out, 'Case Processing Summary', 'Valid')[0]).toBe(118);
    expect(rowNums(out, 'Case Processing Summary', 'Missing')[0]).toBe(2);
    expect(table(out, 'Case Processing Summary').rows.find((r) => r[0].text === 'Subpopulation')![2].text).toBe('118ᵃ');
    close(rowNums(out, 'Goodness-of-Fit', 'Pearson')[0]!, REF.main.pearson, 6e-4);
    expect(rowNums(out, 'Goodness-of-Fit', 'Deviance')[1]).toBe(REF.main.dfgof);
    // the intercept cannot be omitted without changing the factor's parameterisation
    expect(table(out, 'Likelihood Ratio Tests').rows.find((r) => r[0].text === 'Intercept')!.map((c) => c.text).slice(1)).toEqual(['290.133ᵇ', '.000', '0', '']);
    const pe = table(out, 'Parameter Estimates');
    expect(pe.footnotes).toEqual(['The reference category is: Walking.', 'This parameter is set to zero because it is redundant.']);
    expect(pe.rows.filter((r) => r.some((c) => c.text === '[job=1]')).every((r) => r.filter((c) => !c.header).map((c) => c.text).join('|') === '0ᵇ|||0||||')).toBe(true);
    expect(pe.rows.filter((r) => r[0].text === 'Walking')).toHaveLength(0);
    // classification: rows observed, columns predicted (codes: reference first in the script)
    const codes = [REF.main.ref, ...REF.main.others];
    const cats = ['bike', 'car', 'transit', 'walk'];
    for (const o of cats) {
      const r = rowNums(out, 'Classification', COMMUTE[o]);
      cats.forEach((p, j) => expect(r[j], `${o}→${p}`).toBe(REF.main.classCodes[codes.indexOf(o)][codes.indexOf(p)]));
    }
    const correct = cats.reduce((s, c) => s + REF.main.classCodes[codes.indexOf(c)][codes.indexOf(c)], 0);
    close(rowNums(out, 'Classification', 'Overall Percentage')[4]!, (100 * correct) / REF.main.N, 1e-3);
  });
  it('BASE=FIRST and BASE=value', () => {
    run('NOMREG commute (BASE=FIRST) BY job WITH gpa hours.');
    checkRaw(sink[0], REF.first);
    const out = run("NOMREG commute (BASE='car') WITH gpa.");
    checkRaw(sink[1], REF.car);
    checkTables(out, REF.car, COMMUTE);
    expect(table(out, 'Parameter Estimates').footnotes[0]).toBe('The reference category is: Car.');
  });
  it('default PRINT: case processing, model fitting, pseudo R², LR tests and parameters', () => {
    const out = run('NOMREG commute BY job WITH gpa hours.');
    expect(tables(out).map((t) => t.caption)).toEqual(['Case Processing Summary', 'Model Fitting Information', 'Pseudo R-Square', 'Likelihood Ratio Tests', 'Parameter Estimates']);
  });
});

describe('NOMREG data handling', () => {
  it('numeric dependent with user-missing values; LR test of the intercept with covariates only', () => {
    const out = run('NOMREG satisf WITH gpa hours /PRINT=PARAMETER LRT SUMMARY MFI.');
    checkRaw(sink[0], REF.covs);
    checkTables(out, REF.covs, { 1: 'Very dissatisfied', 2: 'Dissatisfied', 3: 'Neutral', 4: 'Satisfied' });
  });
  it('frequency weights enter the likelihood (WEIGHT BY year = replicated cases)', () => {
    const ds = structuredClone(base);
    ds.weight = 'year';
    const out = run('NOMREG commute BY job WITH gpa /PRINT=PARAMETER LRT SUMMARY MFI FIT CLASSTABLE CPS.', ds);
    checkRaw(sink[0], REF.weighted);
    checkTables(out, REF.weighted, COMMUTE);
    expect(sink[0].logConst).toBeGreaterThan(1);
    expect(rowNums(out, 'Case Processing Summary', 'Valid')[0]).toBe(REF.weighted.N);
    const codes = [REF.weighted.ref, ...REF.weighted.others];
    expect(rowNums(out, 'Classification', 'Walking').slice(0, 4)).toEqual(['bike', 'car', 'transit', 'walk'].map((p) => REF.weighted.classCodes[0][codes.indexOf(p)]));
  });
  it('FILTER and SPLIT FILE', () => {
    let ds = withVar('female', col('gender').map((g) => (g === 1 ? 1 : 0)));
    ds.filter = 'female';
    run('NOMREG commute WITH gpa.', ds);
    checkRaw(sink[0], REF.female);
    // split by gender (contiguous after sorting): the female group equals the filtered model
    ds = structuredClone(base);
    const order = col('gender').map((g, i) => [g as number, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
    ds.columns = ds.columns.map((c) => order.map((i) => c[i]));
    ds.split = ['gender'];
    const out = run('NOMREG commute WITH gpa.', ds);
    expect(sink).toHaveLength(4);
    checkRaw(sink[1], REF.female);
    expect(flatItems(out).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['Gender = Female', 'Gender = Male', 'Gender = Other / prefer not to say']);
  });
  it('quasi-complete separation is reported (no car commuters in gender 3)', () => {
    const out = run('NOMREG commute BY gender WITH gpa.');
    const w = warnings(out);
    expect(w.some((m) => m.includes('quasi-complete separation'))).toBe(true);
    expect(w[w.length - 1]).toMatch(/NOMREG procedure continues/);
  });
  it('FULLFACTORIAL, MODEL with interactions, INTERCEPT=EXCLUDE', () => {
    let out = run('NOMREG commute BY job WITH gpa /FULLFACTORIAL.');
    expect(sink[0].B[0]).toHaveLength(3);
    out = run('NOMREG commute BY job WITH gpa /MODEL=gpa job gpa*job /PRINT=PARAMETER LRT.');
    expect(sink[1].B[0]).toHaveLength(4);
    expect(rowNums(out, 'Likelihood Ratio Tests', 'gpa * job')[2]).toBe(3);
    expect(table(out, 'Parameter Estimates').rows.some((r) => r.some((c) => c.text === '[job=0] * gpa'))).toBe(false);
    expect(table(out, 'Parameter Estimates').rows.some((r) => r.some((c) => c.text === 'gpa * [job=0]'))).toBe(true);
    out = run('NOMREG commute WITH gpa /INTERCEPT=EXCLUDE /PRINT=MFI PARAMETER.');
    expect(sink[2].B[0]).toHaveLength(1);
    expect(rowNums(out, 'Model Fitting Information', 'Null')[0]).not.toBeNull();
  });
  it('Czech output', () => {
    const out = run('NOMREG commute BY job WITH gpa.', base, 'cs', ',');
    const caps = tables(out).map((t) => t.caption);
    expect(caps).toContain('Odhady parametrů');
    expect(caps).toContain('Testy věrohodnostním poměrem');
    expect(table(out, 'Odhady parametrů').footnotes[0]).toBe('Referenční kategorie: Walking.');
  });
  it('errors', () => {
    const err = (s: string) => errorsOf(runExt(s, base))[0] ?? '';
    expect(err("NOMREG commute (BASE='plane') WITH gpa.")).toMatch(/reference category/);
    expect(err('NOMREG commute (BASE=MIDDLE) WITH gpa.')).toMatch(/BASE/);
    expect(err('NOMREG commute WITH gpa /SCALE=PEARSON.')).toMatch(/SCALE/);
    expect(err('NOMREG commute WITH gpa /FOO.')).toMatch(/Unknown subcommand/);
    expect(err('NOMREG commute WITH gpa /PRINT=BOGUS.')).toMatch(/Unknown keyword/);
  });
});
