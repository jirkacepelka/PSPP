/*
 * GLM (multivariate and repeated measures) against independent references:
 * - statsmodels AnovaRM (one-way and two-way within-subjects, sphericity assumed),
 * - statsmodels MANOVA (Pillai, Wilks, Roy and the Hotelling value; Sum coding = Type III) on the
 *   raw dependent variables (MANOVA) and on the orthonormal polynomial contrasts of the measures
 *   (repeated measures multivariate tests),
 * - statsmodels OLS + anova_lm(typ=3) with Sum coding per transformed variable (within effects,
 *   within contrasts, between effects of the average, MANOVA univariate tests) and for EMMs,
 * - scipy (paired t-tests for Bonferroni pairwise comparisons, Levene with center='mean'),
 * - formulas from the SPSS algorithms written independently in numpy: Mauchly's W, Greenhouse–
 *   Geisser and Lecoutre-corrected Huynh–Feldt epsilons, Hotelling's trace F (SPSS uses
 *   df2 = 2(sn + 1); statsmodels uses McKeon's approximation), Box's M.
 *
 * Reference script (python3 -W ignore ref_glm.py; statsmodels 0.15, scipy):
 *
 * import json, numpy as np, pandas as pd
 * from scipy import stats
 * import statsmodels.formula.api as smf
 * from statsmodels.stats.anova import AnovaRM, anova_lm
 * from statsmodels.multivariate.manova import MANOVA
 * np.set_printoptions(precision=6, suppress=True)
 * R = lambda x: float(np.round(x, 6))
 *
 * # --- datasets (hardcoded in glm.test.ts too)
 * MIX_G = [1]*5 + [2]*6
 * MIX = [[21,20,19,21],[16,21,16,17],[23,23,21,25],[20,23,19,21],[12,10,16,16],
 *        [14,20,24,27],[13,14,16,25],[17,22,20,24],[21,20,26,33],[16,17,17,29],[21,26,30,30]]
 * AB = [[11,13,16,12,16,17],[8,10,12,14,16,14],[9,6,10,10,14,15],[9,10,14,11,13,16],
 *       [9,9,12,11,16,17],[11,10,14,12,15,14],[8,9,12,11,15,20],[7,10,11,10,12,15]]
 * MAN = [(1,1,11.0,16.9,4.9),(1,1,10.1,16.8,5.4),(1,1,8.3,22.9,5.3),(1,2,10.2,18.2,5.8),(1,2,6.0,16.6,6.5),
 *        (1,2,5.7,22.5,3.4),(1,2,11.5,17.5,7.2),(2,1,11.3,15.4,6.9),(2,1,13.9,19.8,4.6),(2,2,10.7,16.1,7.6),
 *        (2,2,9.9,18.8,4.8),(2,2,9.7,15.2,7.9),(2,2,10.7,21.9,6.0),(2,2,9.6,18.0,5.2),(3,1,12.0,18.9,4.6),
 *        (3,1,9.2,17.6,7.5),(3,1,10.7,16.8,5.5),(3,2,14.8,13.6,5.7),(3,2,10.7,12.7,7.1),(3,2,12.0,18.2,4.9),(3,2,12.9,16.4,5.8)]
 *
 * def poly(L):
 *     x = np.arange(1, L+1, dtype=float)
 *     Q, _ = np.linalg.qr(np.vander(x, L, increasing=True))
 *     Q = Q[:, 1:]
 *     return Q * np.sign(Q[-1, :])
 *
 * def spss_mv(H, E, q, v):
 *     p = H.shape[0]
 *     lam = np.sort(np.real(np.linalg.eigvals(np.linalg.solve(E, H))))[::-1]
 *     lam = np.clip(lam, 0, None)
 *     s = min(p, q); m = (abs(p-q)-1)/2; n = (v-p-1)/2
 *     V = (lam/(1+lam)).sum(); L = np.prod(1/(1+lam)); T = lam.sum(); r1 = lam[0]
 *     out = {}
 *     df1, df2 = s*(2*m+s+1), s*(2*n+s+1); F = df2/df1*V/(s-V); out['pillai'] = (V, F, df1, df2, stats.f.sf(F, df1, df2), V/s)
 *     t = np.sqrt((p*p*q*q-4)/(p*p+q*q-5)) if p*p+q*q-5 > 0 else 1
 *     w = v+q-(p+q+1)/2; df1, df2 = p*q, w*t-(p*q-2)/2; l = L**(1/t); F = (1-l)/l*df2/df1
 *     out['wilks'] = (L, F, df1, df2, stats.f.sf(F, df1, df2), 1-L**(1/s))
 *     df1, df2 = s*(2*m+s+1), 2*(s*n+1); F = df2*T/(s*s*(2*m+s+1)); out['hotelling'] = (T, F, df1, df2, stats.f.sf(F, df1, df2), (T/s)/(T/s+1))
 *     rr = max(p, q); df1, df2 = rr, v-rr+q; F = r1*df2/df1; out['roy'] = (r1, F, df1, df2, stats.f.sf(F, df1, df2), r1/(1+r1))
 *     return {k: [R(x) for x in val] for k, val in out.items()}
 *
 * def mauchly(EM, dfE):
 *     d = EM.shape[0]; tr = np.trace(EM)
 *     W = np.linalg.det(EM)/(tr/d)**d
 *     chi = -(dfE-(2*d*d+d+2)/(6*d))*np.log(W); df = d*(d+1)/2-1
 *     gg = tr**2/(d*np.trace(EM@EM)); hf = min(1, ((dfE+1)*d*gg-2)/(d*(dfE-d*gg)))   # Lecoutre-corrected HF (SPSS)
 *     return dict(W=R(W), chi=R(chi), df=df, sig=R(stats.chi2.sf(chi, df)), gg=R(gg), hf=R(hf), lb=R(1/d))
 *
 * res = {}
 * # ===== 1. one-way RM, balanced (AB data treated as 6 levels? no: first 4 columns of MIX group 2 + AB) -> use AB columns b1..b3 at a=1 for 3 levels
 * Y1 = np.array(AB)[:, :3].astype(float); n1 = len(Y1)
 * long = pd.DataFrame([(s, j, Y1[s, j]) for s in range(n1) for j in range(3)], columns=['s', 'time', 'y'])
 * a = AnovaRM(long, 'y', 's', within=['time']).fit().anova_table
 * M = poly(3); E1 = ((Y1@M) - (Y1@M).mean(0)).T @ ((Y1@M) - (Y1@M).mean(0))
 * ssE = np.trace(E1); dfE = n1-1
 * res['oneway'] = dict(F=R(a['F Value'].iloc[0]), p=R(a['Pr > F'].iloc[0]), df1=a['Num DF'].iloc[0], df2=a['Den DF'].iloc[0], mauchly=mauchly(E1, dfE))
 * F = a['F Value'].iloc[0]; ssH = F*2/(2*dfE)*ssE  # SS_time = F * MSerr * df
 * res['oneway'].update(ssTime=R(ssH), ssErr=R(ssE))
 * mm = mauchly(E1, dfE)
 * res['oneway']['ggP'] = R(stats.f.sf(F, 2*mm['gg'], 2*dfE*mm['gg'])); res['oneway']['hfP'] = R(stats.f.sf(F, 2*mm['hf'], 2*dfE*mm['hf']))
 * # multivariate (Hotelling T2) via statsmodels MANOVA on difference scores (intercept test)
 * D = pd.DataFrame(Y1@M, columns=['d1', 'd2'])
 * mv = MANOVA.from_formula('d1 + d2 ~ 1', D).mv_test().results['Intercept']['stat']
 * res['oneway']['mvPillai'] = [R(mv.loc["Pillai's trace", c]) for c in ['Value', 'F Value', 'Pr > F']]
 * # pairwise Bonferroni = paired t tests x 3
 * pw = {}
 * for i in range(3):
 *     for j in range(i+1, 3):
 *         t = stats.ttest_rel(Y1[:, i], Y1[:, j]); d = Y1[:, i]-Y1[:, j]
 *         pw[f'{i+1}-{j+1}'] = [R(d.mean()), R(d.std(ddof=1)/np.sqrt(n1)), R(min(1, t.pvalue*3))]
 *         tq = stats.t.ppf(1-0.05/6, n1-1); pw[f'{i+1}-{j+1}'] += [R(d.mean()-tq*d.std(ddof=1)/np.sqrt(n1)), R(d.mean()+tq*d.std(ddof=1)/np.sqrt(n1))]
 * res['oneway']['pairwise'] = pw
 * res['oneway']['emm'] = [[R(Y1[:, j].mean()), R(Y1[:, j].std(ddof=1)/np.sqrt(n1))] for j in range(3)]
 *
 * # ===== 2. two within factors a(2) x b(3)
 * Y2 = np.array(AB, dtype=float); n2 = len(Y2)
 * long = pd.DataFrame([(s, ai, bi, Y2[s, ai*3+bi]) for s in range(n2) for ai in range(2) for bi in range(3)], columns=['s', 'a', 'b', 'y'])
 * a2 = AnovaRM(long, 'y', 's', within=['a', 'b']).fit().anova_table
 * res['twoWithin'] = {k: [R(a2.loc[k, 'F Value']), R(a2.loc[k, 'Pr > F'])] for k in ['a', 'b', 'a:b']}
 * u2, u3 = np.ones((2, 1))/np.sqrt(2), np.ones((3, 1))/np.sqrt(3)
 * Mb = np.kron(u2, poly(3)); Mab = np.kron(poly(2), poly(3)); Ma = np.kron(poly(2), u3)
 * CS = lambda Z: (Z-Z.mean(0)).T@(Z-Z.mean(0))
 * res['twoWithin']['mauchlyB'] = mauchly(CS(Y2@Mb), n2-1); res['twoWithin']['mauchlyAB'] = mauchly(CS(Y2@Mab), n2-1)
 * res['twoWithin']['ssA'] = R(n2*((Y2@Ma).mean(0)**2).sum()); res['twoWithin']['ssB'] = R(n2*((Y2@Mb).mean(0)**2).sum())
 * res['twoWithin']['errB'] = R(np.trace(CS(Y2@Mb)))
 *
 * # ===== 3. mixed design (MIX, unbalanced 5/6), time 4 levels
 * Y = np.array(MIX, dtype=float); g = np.array(MIX_G); k = 4; M = poly(4)
 * def anova_t3(z, df_):
 *     d = df_.copy(); d['z'] = z
 *     fit = smf.ols('z ~ C(g, Sum)', d).fit()
 *     return anova_lm(fit, typ=3), fit
 * df = pd.DataFrame({'g': g})
 * ssT = ssTG = ssE = 0; contr = []
 * for j in range(3):
 *     t3, _ = anova_t3(Y@M[:, j], df)
 *     contr.append([R(t3.loc['Intercept', 'sum_sq']), R(t3.loc['C(g, Sum)', 'sum_sq']), R(t3.loc['Residual', 'sum_sq'])])
 *     ssT += t3.loc['Intercept', 'sum_sq']; ssTG += t3.loc['C(g, Sum)', 'sum_sq']; ssE += t3.loc['Residual', 'sum_sq']
 * dfE = len(Y)-2
 * t3, _ = anova_t3(Y.sum(1)/np.sqrt(k), df)
 * mix = dict(ssTime=R(ssT), ssTimeG=R(ssTG), ssErr=R(ssE), contrasts=contr,
 *            between=[[R(t3.loc[r, 'sum_sq']), R(t3.loc[r, 'F']) if r != 'Residual' else None] for r in ['Intercept', 'C(g, Sum)', 'Residual']])
 * Fm = (ssT/3)/(ssE/(3*dfE)); Fi = (ssTG/3)/(ssE/(3*dfE))
 * Z = Y@M
 * Eres = sum(CS(Z[g == gg]) for gg in [1, 2])
 * mm = mauchly(Eres, dfE); mix['mauchly'] = mm
 * mix['F'] = [R(Fm), R(Fi)]
 * mix['p'] = {c: [R(stats.f.sf(Fm, 3*e, 3*dfE*e)), R(stats.f.sf(Fi, 3*e, 3*dfE*e))] for c, e in [('sph', 1), ('gg', mm['gg']), ('hf', mm['hf']), ('lb', 1/3)]}
 * D = pd.DataFrame(Z, columns=['d1', 'd2', 'd3']); D['g'] = g
 * mvr = MANOVA.from_formula('d1 + d2 + d3 ~ C(g, Sum)', D).mv_test().results
 * mix['mv'] = {name: {s: [R(mvr[name]['stat'].loc[s, c]) for c in ['Value', 'F Value', 'Num DF', 'Den DF', 'Pr > F']] for s in ["Pillai's trace", "Wilks' lambda", "Roy's greatest root"]} for name in ['Intercept', 'C(g, Sum)']}
 * # EMM time (unweighted over groups) and Bonferroni pairwise 1 vs 4 via OLS intercepts (sum coding)
 * emm = []
 * for j in range(4):
 *     d = df.copy(); d['y'] = Y[:, j]; f = smf.ols('y ~ C(g, Sum)', d).fit(); emm.append([R(f.params['Intercept']), R(f.bse['Intercept'])])
 * mix['emmTime'] = emm
 * d = df.copy(); d['y'] = Y[:, 0]-Y[:, 3]; f = smf.ols('y ~ C(g, Sum)', d).fit()
 * mix['pw14'] = [R(f.params['Intercept']), R(f.bse['Intercept']), R(min(1, f.pvalues['Intercept']*6))]
 * mix['pw14sidak'] = R(1-(1-f.pvalues['Intercept'])**6)
 * # parameters (dummy, last group reference) for t1
 * d = df.copy(); d['y'] = Y[:, 0]; f = smf.ols('y ~ C(g, Treatment(reference=2))', d).fit()
 * mix['paramT1'] = [R(x) for x in [f.params.iloc[0], f.bse.iloc[0], f.params.iloc[1], f.bse.iloc[1], f.tvalues.iloc[1], f.pvalues.iloc[1]]]
 * # Levene (deviations from group means) per DV
 * mix['levene'] = [[R(x) for x in stats.levene(Y[g == 1, j], Y[g == 2, j], center='mean')] for j in range(4)]
 * # Box's M
 * def boxm(groups):
 *     p = groups[0].shape[1]; ns = np.array([len(x) for x in groups]); gN = len(groups); N = ns.sum()
 *     Ss = [np.cov(x.T) for x in groups]; Sp = sum((n-1)*S for n, S in zip(ns, Ss))/(N-gN)
 *     Mv = (N-gN)*np.log(np.linalg.det(Sp))-sum((n-1)*np.log(np.linalg.det(S)) for n, S in zip(ns, Ss))
 *     c1 = ((1/(ns-1)).sum()-1/(N-gN))*(2*p*p+3*p-1)/(6*(p+1)*(gN-1))
 *     c2 = ((1/(ns-1)**2).sum()-1/(N-gN)**2)*(p-1)*(p+2)/(6*(gN-1))
 *     df1 = (gN-1)*p*(p+1)/2
 *     if c2 > c1*c1:
 *         df2 = (df1+2)/(c2-c1*c1); b = df1/(1-c1-df1/df2); F = Mv/b
 *     else:
 *         df2 = (df1+2)/(c1*c1-c2); b = df2/(1-c1+2/df2); F = df2*Mv/(df1*(b-Mv))
 *     return [R(Mv), R(F), df1, R(df2), R(stats.f.sf(F, df1, df2))]
 * mix['boxM'] = boxm([Y[g == 1], Y[g == 2]])
 * res['mixed'] = mix
 *
 * # ===== 4. MANOVA a(3) x b(2), unbalanced, 3 DVs
 * man = pd.DataFrame(MAN, columns=['a', 'b', 'y1', 'y2', 'y3'])
 * mv = MANOVA.from_formula('y1 + y2 + y3 ~ C(a, Sum) * C(b, Sum)', man).mv_test().results
 * res['manova'] = {'mv': {name: {s: [R(mv[name]['stat'].loc[s, c]) for c in ['Value', 'F Value', 'Num DF', 'Den DF', 'Pr > F']] for s in mv[name]['stat'].index}
 *                         for name in ['Intercept', 'C(a, Sum)', 'C(b, Sum)', 'C(a, Sum):C(b, Sum)']}}
 * Yd = man[['y1', 'y2', 'y3']].values
 * res['manova']['hotellingSpss'] = {}
 * uni = {}
 * for yv in ['y1', 'y2', 'y3']:
 *     f = smf.ols(f'{yv} ~ C(a, Sum) * C(b, Sum)', man).fit(); t3 = anova_lm(f, typ=3)
 *     f0 = smf.ols(f'{yv} ~ 1', man).fit()
 *     uni[yv] = dict(rows={r: [R(t3.loc[r, 'sum_sq']), R(t3.loc[r, 'df']), R(t3.loc[r, 'F']) if r != 'Residual' else None] for r in t3.index},
 *                    model=R(f0.ssr-f.ssr), r2=R(f.rsquared), adj=R(f.rsquared_adj), ctot=R(f0.ssr), total=R((man[yv]**2).sum()))
 * res['manova']['uni'] = uni
 * # SPSS Hotelling F for each effect from H and E of the Sum-coded fit
 * X = pd.get_dummies(man[['a', 'b']].astype(str))
 * from patsy import dmatrix
 * def HE(term_formula_full, drop):
 *     Xf = dmatrix('C(a, Sum) * C(b, Sum)', man, return_type='dataframe')
 *     cols = [c for c in Xf.columns if not drop(c)]
 *     def resid(Xm):
 *         B = np.linalg.lstsq(Xm, Yd, rcond=None)[0]; Rr = Yd-Xm@B; return Rr.T@Rr
 *     Ef = resid(Xf.values); Er = resid(Xf[cols].values); return Er-Ef, Ef
 * for name, dropper, q in [('a', lambda c: c.startswith('C(a, Sum)[') and ':' not in c, 2), ('ab', lambda c: ':' in c, 2), ('Intercept', lambda c: c == 'Intercept', 1)]:
 *     H, E = HE(None, dropper); res['manova']['hotellingSpss'][name] = spss_mv(H, E, q, len(man)-6)['hotelling']
 * # Levene per DV across 6 cells, Box's M over 6 cells
 * cellsI = [man[(man.a == ai) & (man.b == bi)].index for ai in [1, 2, 3] for bi in [1, 2]]
 * res['manova']['levene'] = [[R(x) for x in stats.levene(*[man.loc[ix, yv] for ix in cellsI], center='mean')] for yv in ['y1', 'y2', 'y3']]
 * res['manova']['boxM'] = boxm([Yd[ix] for ix in cellsI if len(ix) > 3])
 * # EMM a and Bonferroni pairwise a1-a3 for y1: unweighted cell means
 * cm = man.groupby(['a', 'b'])['y1'].agg(['mean', 'count'])
 * mse = uni['y1']['rows']['Residual'][0]/uni['y1']['rows']['Residual'][1]
 * emmA = []
 * for ai in [1, 2, 3]:
 *     mu = cm.loc[ai]['mean'].mean(); se = np.sqrt(mse/4*(1/cm.loc[ai]['count']).sum()); emmA.append([R(mu), R(se)])
 * res['manova']['emmA_y1'] = emmA
 * diff = cm.loc[1]['mean'].mean()-cm.loc[3]['mean'].mean(); se = np.sqrt(mse/4*((1/cm.loc[1]['count']).sum()+(1/cm.loc[3]['count']).sum()))
 * p = 2*stats.t.sf(abs(diff/se), len(man)-6)
 * res['manova']['pw13_y1'] = [R(diff), R(se), R(min(1, 3*p))]
 *
 * # ===== 5. students: MANOVA with covariate, listwise missing (sleep, gpa have system-missing)
 * d = json.load(open('/home/user/PSPP/web/src/samples/students.json'))
 * st = pd.DataFrame({v['name']: c for v, c in zip(d['variables'], d['columns'])})
 * s5 = st[['sleep', 'stress', 'gpa', 'gender', 'hours']].dropna().astype(float)
 * mv = MANOVA.from_formula('sleep + stress + gpa ~ C(gender, Sum) + hours', s5).mv_test().results
 * res['students'] = {'N': len(s5), 'mv': {name: {s: [R(mv[name]['stat'].loc[s, c]) for c in ['Value', 'F Value', 'Num DF', 'Den DF', 'Pr > F']] for s in ["Pillai's trace", "Wilks' lambda"]} for name in ['C(gender, Sum)', 'hours', 'Intercept']}}
 * for yv in ['sleep', 'gpa']:
 *     t3 = anova_lm(smf.ols(f'{yv} ~ C(gender, Sum) + hours', s5).fit(), typ=3)
 *     res['students'][yv] = {r: [R(t3.loc[r, 'sum_sq']), R(t3.loc[r, 'F']) if r != 'Residual' else None] for r in t3.index}
 * # students RM: hours, stress, age within, BY gender (3 groups)
 * s6 = st[['hours', 'stress', 'age', 'gender']].dropna().astype(float); Y6 = s6[['hours', 'stress', 'age']].values; g6 = s6.gender.values
 * Z6 = Y6@poly(3); E6 = sum(CS(Z6[g6 == gg]) for gg in [1, 2, 3]); res['students']['rmMauchly'] = mauchly(E6, len(s6)-3)
 * ssT = ssTG = 0
 * for j in range(2):
 *     dd = pd.DataFrame({'g': g6, 'z': Z6[:, j]}); t3 = anova_lm(smf.ols('z ~ C(g, Sum)', dd).fit(), typ=3)
 *     ssT += t3.loc['Intercept', 'sum_sq']; ssTG += t3.loc['C(g, Sum)', 'sum_sq']
 * res['students']['rmSS'] = [R(ssT), R(ssTG), R(np.trace(E6))]
 * print(json.dumps(res, indent=1))
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, OutputItem } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import type { PivotTable } from '../../lib/pivot';
import { errorsOf, flatItems, haveEngine, runExt, runMixed, tables } from '../testing';
import { hasExtCommand, isExtCommand } from '../runner';
import { EXT_CONDITIONAL } from '../names';
import { commandName } from '../../lib/commands';
import students from '../../samples/students.json';
import { multivariateTests, sphericity } from './glm';
import cs from '../../i18n/fragments/ext-glm.cs.json';
import en from '../../i18n/fragments/ext-glm.en.json';

// reference values printed by the script above
const REF = {"oneway": {"F": 27.579235, "p": 1.4e-05, "df1": 2.0, "df2": 14.0, "mauchly": {"W": 0.493057, "chi": 4.242778, "df": 2.0, "sig": 0.119865, "gg": 0.663595, "hf": 0.759546, "lb": 0.5}, "ssTime": 60.083333, "ssErr": 15.25, "ggP": 0.000273, "hfP": 0.000116, "mvPillai": [0.962674, 77.372093, 5.2e-05], "pairwise": {"1-2": [-0.625, 0.679745, 1.0, -2.750939, 1.500939], "1-3": [-3.625, 0.460493, 0.000303, -5.065215, -2.184785], "2-3": [-3.0, 0.377964, 0.000288, -4.182104, -1.817896]}, "emm": [[9.0, 0.5], [9.625, 0.679745], [12.625, 0.679745]]}, "twoWithin": {"a": [45.097561, 0.000274], "b": [45.340594, 1e-06], "a:b": [3.786517, 0.048475], "mauchlyB": {"W": 0.658006, "chi": 2.511247, "df": 2.0, "sig": 0.284898, "gg": 0.74516, "hf": 0.900466, "lb": 0.5}, "mauchlyAB": {"W": 0.973779, "chi": 0.159423, "df": 2.0, "sig": 0.923383, "gg": 0.974449, "hf": 1.0, "lb": 0.5}, "ssA": 154.083333, "ssB": 136.291667, "errB": 21.041667}, "mixed": {"ssTime": 228.087879, "ssTimeG": 140.815152, "ssErr": 146.866667, "contrasts": [[206.700606, 137.318788, 34.526667], [9.845455, 3.3, 68.2], [11.541818, 0.196364, 44.14]], "between": [[18115.227273, 349.864904], [82.5, 1.593348], [466.0, null]], "mauchly": {"W": 0.350248, "chi": 8.101479, "df": 5.0, "sig": 0.150731, "gg": 0.722393, "hf": 0.959671, "lb": 0.333333}, "F": [13.977242, 8.629163], "p": {"sph": [1.1e-05, 0.000353], "gg": [0.000131, 0.00171], "hf": [1.6e-05, 0.000443], "lb": [0.004635, 0.016553]}, "mv": {"Intercept": {"Pillai's trace": [0.947577, 42.176294, 3.0, 7.0, 7.5e-05], "Wilks' lambda": [0.052423, 42.176294, 3.0, 7.0, 7.5e-05], "Roy's greatest root": [18.075555, 42.176294, 3.0, 7.0, 7.5e-05]}, "C(g, Sum)": {"Pillai's trace": [0.898508, 20.657071, 3.0, 7.0, 0.000744], "Wilks' lambda": [0.101492, 20.657071, 3.0, 7.0, 0.000744], "Roy's greatest root": [8.85303, 20.657071, 3.0, 7.0, 0.000744]}}, "emmTime": [[17.7, 1.173472], [19.616667, 1.434485], [20.183333, 1.306666], [24.0, 1.048809]], "pw14": [-6.3, 0.63187, 2.2e-05], "pw14sidak": 2.2e-05, "paramT1": [17.0, 1.58231, 1.4, 2.346944, 0.59652, 0.565528], "levene": [[0.584456, 0.464143], [0.229182, 0.643547], [6.013231, 0.036625], [0.016698, 0.900026]], "boxM": [27.725348, 1.346048, 10.0, 347.635686, 0.204367]}, "manova": {"mv": {"Intercept": {"Wilks' lambda": [0.003158, 1367.967392, 3.0, 13.0, 0.0], "Pillai's trace": [0.996842, 1367.967392, 3.0, 13.0, 0.0], "Hotelling-Lawley trace": [315.684783, 1367.967392, 3.0, 13.0, 0.0], "Roy's greatest root": [315.684783, 1367.967392, 3.0, 13.0, 0.0]}, "C(a, Sum)": {"Wilks' lambda": [0.554159, 1.487765, 6.0, 26.0, 0.22134], "Pillai's trace": [0.481972, 1.481661, 6.0, 28.0, 0.220552], "Hotelling-Lawley trace": [0.739337, 1.553679, 6.0, 15.675676, 0.225399], "Roy's greatest root": [0.636979, 2.97257, 3.0, 14.0, 0.067891]}, "C(b, Sum)": {"Wilks' lambda": [0.922448, 0.364311, 3.0, 13.0, 0.779909], "Pillai's trace": [0.077552, 0.364311, 3.0, 13.0, 0.779909], "Hotelling-Lawley trace": [0.084072, 0.364311, 3.0, 13.0, 0.779909], "Roy's greatest root": [0.084072, 0.364311, 3.0, 13.0, 0.779909]}, "C(a, Sum):C(b, Sum)": {"Wilks' lambda": [0.660958, 0.996763, 6.0, 26.0, 0.448293], "Pillai's trace": [0.339389, 0.953753, 6.0, 28.0, 0.473659], "Hotelling-Lawley trace": [0.51243, 1.076846, 6.0, 15.675676, 0.417118], "Roy's greatest root": [0.511404, 2.386552, 3.0, 14.0, 0.112781]}}, "hotellingSpss": {"a": [0.739337, 1.478673, 6.0, 24.0, 0.22759, 0.269896], "ab": [0.51243, 1.02486, 6.0, 24.0, 0.433313, 0.203958], "Intercept": [315.684783, 1367.967392, 3.0, 13.0, 0.0, 0.996842]}, "uni": {"y1": {"rows": {"Intercept": [2201.377149, 1.0, 701.900121], "C(a, Sum)": [26.297518, 2.0, 4.192428], "C(b, Sum)": [2.065006, 1.0, 0.658419], "C(a, Sum):C(b, Sum)": [17.567434, 2.0, 2.800652], "Residual": [47.044667, 15.0, null]}, "model": 47.187714, "r2": 0.500759, "adj": 0.334345, "ctot": 94.232381, "total": 2417.89}, "y2": {"rows": {"Intercept": [6037.281287, 1.0, 875.638074], "C(a, Sum)": [18.044335, 2.0, 1.308561], "C(b, Sum)": [2.854501, 1.0, 0.414013], "C(a, Sum):C(b, Sum)": [7.93778, 2.0, 0.575642], "Residual": [103.420833, 15.0, null]}, "model": 33.030595, "r2": 0.242069, "adj": -0.010575, "ctot": 136.451429, "total": 6683.72}, "y3": {"rows": {"Intercept": [645.668006, 1.0, 377.338445], "C(a, Sum)": [1.089594, 2.0, 0.318388], "C(b, Sum)": [0.62872, 1.0, 0.367434], "C(a, Sum):C(b, Sum)": [0.309762, 2.0, 0.090515], "Residual": [25.666667, 15.0, null]}, "model": 2.362857, "r2": 0.084299, "adj": -0.220935, "ctot": 28.029524, "total": 743.78}}, "levene": [[5.241013, 0.005567], [0.871282, 0.523044], [1.389556, 0.283389]], "boxM": [21.956972, 0.968188, 12.0, 421.029427, 0.478624], "emmA_y1": [[9.075, 0.676298], [11.36, 0.740847], [11.616667, 0.676298]], "pw13_y1": [-2.541667, 0.95643, 0.053767]}, "students": {"N": 114, "mv": {"C(gender, Sum)": {"Pillai's trace": [0.040058, 0.742593, 6.0, 218.0, 0.615896], "Wilks' lambda": [0.960304, 0.736532, 6.0, 216.0, 0.620716]}, "hours": {"Pillai's trace": [0.282443, 14.170232, 3.0, 108.0, 0.0], "Wilks' lambda": [0.717557, 14.170232, 3.0, 108.0, 0.0]}, "Intercept": {"Pillai's trace": [0.892138, 297.760318, 3.0, 108.0, 0.0], "Wilks' lambda": [0.107862, 297.760318, 3.0, 108.0, 0.0]}}, "sleep": {"Intercept": [448.491114, 407.855871], "C(gender, Sum)": [1.804553, 0.820526], "hours": [3.512325, 3.194093], "Residual": [120.959452, null]}, "gpa": {"Intercept": [51.887001, 288.704345], "C(gender, Sum)": [0.225535, 0.627449], "hours": [1.647243, 9.165421], "Residual": [19.769603, null]}, "rmMauchly": {"W": 0.91235, "chi": 10.640883, "df": 2.0, "sig": 0.004891, "gg": 0.919413, "hf": 0.933394, "lb": 0.5}, "rmSS": [169.532286, 59.362934, 6922.60601]}};

const MIX_G = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2];
const MIX = [[21, 20, 19, 21], [16, 21, 16, 17], [23, 23, 21, 25], [20, 23, 19, 21], [12, 10, 16, 16], [14, 20, 24, 27], [13, 14, 16, 25], [17, 22, 20, 24], [21, 20, 26, 33], [16, 17, 17, 29], [21, 26, 30, 30]];
const AB = [[11, 13, 16, 12, 16, 17], [8, 10, 12, 14, 16, 14], [9, 6, 10, 10, 14, 15], [9, 10, 14, 11, 13, 16], [9, 9, 12, 11, 16, 17], [11, 10, 14, 12, 15, 14], [8, 9, 12, 11, 15, 20], [7, 10, 11, 10, 12, 15]];
const MAN = [[1, 1, 11.0, 16.9, 4.9], [1, 1, 10.1, 16.8, 5.4], [1, 1, 8.3, 22.9, 5.3], [1, 2, 10.2, 18.2, 5.8], [1, 2, 6.0, 16.6, 6.5], [1, 2, 5.7, 22.5, 3.4], [1, 2, 11.5, 17.5, 7.2], [2, 1, 11.3, 15.4, 6.9], [2, 1, 13.9, 19.8, 4.6], [2, 2, 10.7, 16.1, 7.6], [2, 2, 9.9, 18.8, 4.8], [2, 2, 9.7, 15.2, 7.9], [2, 2, 10.7, 21.9, 6.0], [2, 2, 9.6, 18.0, 5.2], [3, 1, 12.0, 18.9, 4.6], [3, 1, 9.2, 17.6, 7.5], [3, 1, 10.7, 16.8, 5.5], [3, 2, 14.8, 13.6, 5.7], [3, 2, 10.7, 12.7, 7.1], [3, 2, 12.0, 18.2, 4.9], [3, 2, 12.9, 16.4, 5.8]];

function dataset(cols: Record<string, (number | null)[]>, extra: Partial<Dataset> = {}): Dataset {
  const names = Object.keys(cols);
  return { name: 't', variables: names.map((n) => makeVariable(n)), columns: names.map((n) => cols[n]), ...extra };
}
const mixed = () => dataset({ g: MIX_G, t1: MIX.map((r) => r[0]), t2: MIX.map((r) => r[1]), t3: MIX.map((r) => r[2]), t4: MIX.map((r) => r[3]) });
const twoWithin = () => dataset(Object.fromEntries(['a1b1', 'a1b2', 'a1b3', 'a2b1', 'a2b2', 'a2b3'].map((n, j) => [n, AB.map((r) => r[j])])));
const manova = () => dataset({ a: MAN.map((r) => r[0]), b: MAN.map((r) => r[1]), y1: MAN.map((r) => r[2]), y2: MAN.map((r) => r[3]), y3: MAN.map((r) => r[4]) });
const studentsDs = students as unknown as Dataset;

const byCaption = (items: OutputItem[], caption: string, nth = 0): PivotTable => {
  const t = tables(items).filter((x) => x.caption === caption)[nth];
  if (!t) throw new Error(`no table ${caption}: ${tables(items).map((x) => x.caption).join(', ')}`);
  return t;
};
/** Numbers (td cells) of the data row whose stub contains all LABELS. */
const row = (t: PivotTable, ...labels: string[]) => {
  const r = t.rows.find((x) => x.some((c) => !c.header) && labels.every((l) => x.some((c) => c.header && c.text === l)));
  if (!r) throw new Error(`no row ${labels.join('/')} in ${t.caption}`);
  return r.filter((c) => !c.header).map((c) => c.num);
};
const texts = (t: PivotTable, ...labels: string[]) => {
  const r = t.rows.find((x) => x.some((c) => !c.header) && labels.every((l) => x.some((c) => c.header && c.text === l)))!;
  return r.filter((c) => !c.header).map((c) => c.text);
};
/** printed value (3 decimals) equals the reference */
const near = (got: number | null, want: number | null, tol = 6e-4) => {
  if (want === null) return expect(got).toBeNull();
  expect(got, `${got} vs ${want}`).not.toBeNull();
  expect(Math.abs((got as number) - want), `${got} vs ${want}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want) / 1000));
};

describe('GLM routing (EXT_CONDITIONAL)', () => {
  const claims = EXT_CONDITIONAL.find((c) => c.name === 'GLM')!.claims;
  it('claims only multivariate / repeated measures forms', () => {
    expect(claims('GLM y BY a.')).toBe(false);
    expect(claims('GLM y BY a WITH x /DESIGN=a x.')).toBe(false);
    expect(claims('GLM y WITH x.')).toBe(false);
    expect(claims('GLM y1 y2 BY a.')).toBe(true);
    expect(claims('GLM y1 TO y3 BY a.')).toBe(true);
    expect(claims('glm y1,y2.')).toBe(true);
    expect(claims('GLM t1 t2 t3\n  /WSFACTOR=time 3 Polynomial.')).toBe(true);
    expect(claims('GLM y /WSF=time 2.')).toBe(true);
  });
  it('plain univariate GLM stays an engine command', () => {
    expect(commandName('GLM y BY a.')).toBe('GLM');
    expect(isExtCommand('GLM', 'GLM y BY a.')).toBe(false);
    expect(hasExtCommand('DESCRIPTIVES x.\nGLM y BY a.')).toBe(false);
    expect(hasExtCommand('GLM y1 y2 BY a.')).toBe(true);
  });
  it.skipIf(!haveEngine)('univariate GLM runs in PSPP, multivariate GLM in the extension', async () => {
    const r = await runMixed('GLM gpa BY gender.\nGLM sleep gpa BY gender.', studentsDs);
    expect(errorsOf(r.items)).toEqual([]);
    const caps = tables(r.items).map((t) => t.caption);
    // engine output for the first command (no Multivariate Tests), extension output for the second
    expect(caps.filter((c) => c === 'Multivariate Tests')).toHaveLength(1);
    expect(caps.filter((c) => c === 'Tests of Between-Subjects Effects').length).toBe(2);
    const groups = r.items.filter((i) => i.kind === 'group' && i.command === 'GLM');
    expect(groups.length).toBeGreaterThanOrEqual(1);
  }, 60000);
});

describe('GLM repeated measures', () => {
  it('one-way within (balanced) vs AnovaRM, Mauchly, epsilons, Bonferroni pairwise', () => {
    const ds = twoWithin();
    const out = runExt('GLM a1b1 a1b2 a1b3 /WSFACTOR=time 3 Polynomial /PRINT=ETASQ /EMMEANS=TABLES(time) COMPARE ADJ(BONFERRONI) /WSDESIGN=time.', ds);
    expect(errorsOf(out)).toEqual([]);
    const R = REF.oneway;
    const we = byCaption(out, 'Tests of Within-Subjects Effects');
    const sph = row(we, 'time', 'Sphericity Assumed');
    near(sph[0], R.ssTime);
    expect(sph[1]).toBe(R.df1);
    near(sph[3], R.F);
    near(sph[4], R.p);
    near(row(we, 'time', 'Greenhouse-Geisser')[4], R.ggP);
    near(row(we, 'time', 'Huynh-Feldt')[4], R.hfP);
    near(row(we, 'time', 'Greenhouse-Geisser')[1], 2 * R.mauchly.gg);
    near(row(we, 'Error(time)', 'Sphericity Assumed')[0], R.ssErr);
    expect(row(we, 'Error(time)', 'Sphericity Assumed')[1]).toBe(R.df2);
    const m = row(byCaption(out, "Mauchly's Test of Sphericity"), 'time');
    [R.mauchly.W, R.mauchly.chi, R.mauchly.df, R.mauchly.sig, R.mauchly.gg, R.mauchly.hf, R.mauchly.lb].forEach((x, i) => near(m[i], x));
    const mv = row(byCaption(out, 'Multivariate Tests'), 'time', "Pillai's Trace");
    near(mv[0], R.mvPillai[0]);
    near(mv[1], R.mvPillai[1]);
    near(mv[4], R.mvPillai[2]);
    const est = byCaption(out, 'Estimates');
    R.emm.forEach(([mean, se], j) => {
      near(row(est, String(j + 1))[0], mean);
      near(row(est, String(j + 1))[1], se);
    });
    const pw = byCaption(out, 'Pairwise Comparisons');
    for (const [key, vals] of Object.entries(R.pairwise)) {
      const [i, j] = key.split('-');
      const r = row(pw, i, j);
      vals.forEach((x, z) => near(r[z], x as number));
    }
    expect(pw.footnotes.join(' ')).toContain('Bonferroni');
    // Within-Subjects Contrasts: linear + quadratic SS add up to the time SS
    const wc = byCaption(out, 'Tests of Within-Subjects Contrasts');
    near(row(wc, 'time', 'Linear')[0]! + row(wc, 'time', 'Quadratic')[0]!, R.ssTime, 2e-3);
  });

  it('two within factors: AnovaRM F, Mauchly for 2 levels (W = 1, df 0, Sig. ".")', () => {
    const out = runExt('GLM a1b1 a1b2 a1b3 a2b1 a2b2 a2b3 /WSFACTOR=a 2 b 3.', twoWithin());
    expect(errorsOf(out)).toEqual([]);
    const R = REF.twoWithin;
    const we = byCaption(out, 'Tests of Within-Subjects Effects');
    near(row(we, 'a', 'Sphericity Assumed')[3], R.a[0]);
    near(row(we, 'a', 'Sphericity Assumed')[4], R.a[1]);
    near(row(we, 'b', 'Sphericity Assumed')[3], R.b[0]);
    near(row(we, 'b', 'Sphericity Assumed')[4], R.b[1]);
    near(row(we, 'a * b', 'Sphericity Assumed')[3], R['a:b'][0]);
    near(row(we, 'a * b', 'Sphericity Assumed')[4], R['a:b'][1]);
    near(row(we, 'a', 'Sphericity Assumed')[0], R.ssA);
    near(row(we, 'b', 'Sphericity Assumed')[0], R.ssB);
    near(row(we, 'Error(b)', 'Sphericity Assumed')[0], R.errB);
    const mt = byCaption(out, "Mauchly's Test of Sphericity");
    expect(texts(mt, 'a')).toEqual(['1.000', '.000', '0', '.', '1.000', '1.000', '1.000']);
    const mb = row(mt, 'b');
    [R.mauchlyB.W, R.mauchlyB.chi, R.mauchlyB.df, R.mauchlyB.sig, R.mauchlyB.gg, R.mauchlyB.hf, R.mauchlyB.lb].forEach((x, i) => near(mb[i], x));
    const mab = row(mt, 'a * b');
    [R.mauchlyAB.W, R.mauchlyAB.chi, R.mauchlyAB.gg, R.mauchlyAB.hf].forEach((x, i) => near(mab[[0, 1, 4, 5][i]], x));
    const wc = byCaption(out, 'Tests of Within-Subjects Contrasts');
    expect(wc.rows[0].map((c) => c.text).slice(0, 3)).toEqual(['Source', 'a', 'b']);
    expect(row(wc, 'a * b', 'Linear', 'Quadratic')).toHaveLength(5);
  });

  it('mixed design (unbalanced between × within): all tables', () => {
    const out = runExt(
      'GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4 POLYNOMIAL /METHOD=SSTYPE(3) /PRINT=DESCRIPTIVE ETASQU HOMOGENEITY PARAMETER /EMMEANS=TABLES(time) COMPARE ADJ(BONFERRONI) /CRITERIA=ALPHA(.05) /WSDESIGN=time /DESIGN=g.',
      mixed(),
    );
    expect(errorsOf(out)).toEqual([]);
    const R = REF.mixed;
    expect(tables(out).map((t) => t.caption)).toEqual([
      'Within-Subjects Factors', 'Between-Subjects Factors', 'Descriptive Statistics', "Box's Test of Equality of Covariance Matrices", 'Multivariate Tests',
      "Mauchly's Test of Sphericity", 'Tests of Within-Subjects Effects', 'Tests of Within-Subjects Contrasts', "Levene's Test of Equality of Error Variances",
      'Tests of Between-Subjects Effects', 'Parameter Estimates', 'Estimates', 'Pairwise Comparisons',
    ]);
    const we = byCaption(out, 'Tests of Within-Subjects Effects');
    near(row(we, 'time', 'Sphericity Assumed')[0], R.ssTime);
    near(row(we, 'time * g', 'Sphericity Assumed')[0], R.ssTimeG);
    near(row(we, 'Error(time)', 'Sphericity Assumed')[0], R.ssErr);
    near(row(we, 'time', 'Sphericity Assumed')[3], R.F[0]);
    near(row(we, 'time * g', 'Sphericity Assumed')[3], R.F[1]);
    for (const [label, key] of [['Sphericity Assumed', 'sph'], ['Greenhouse-Geisser', 'gg'], ['Huynh-Feldt', 'hf'], ['Lower-bound', 'lb']] as const) {
      near(row(we, 'time', label)[4], R.p[key][0]);
      near(row(we, 'time * g', label)[4], R.p[key][1]);
    }
    near(row(we, 'time', 'Sphericity Assumed')[5], R.ssTime / (R.ssTime + R.ssErr));
    const m = row(byCaption(out, "Mauchly's Test of Sphericity"), 'time');
    [R.mauchly.W, R.mauchly.chi, R.mauchly.df, R.mauchly.sig, R.mauchly.gg, R.mauchly.hf, R.mauchly.lb].forEach((x, i) => near(m[i], x));
    const wc = byCaption(out, 'Tests of Within-Subjects Contrasts');
    ['Linear', 'Quadratic', 'Cubic'].forEach((c, j) => {
      near(row(wc, 'time', c)[0], R.contrasts[j][0]);
      near(row(wc, 'time * g', c)[0], R.contrasts[j][1]);
      near(row(wc, 'Error(time)', c)[0], R.contrasts[j][2]);
    });
    const mv = byCaption(out, 'Multivariate Tests');
    for (const [eff, name] of [['time', 'Intercept'], ['time * g', 'C(g, Sum)']] as const) {
      const ref = R.mv[name];
      for (const [lab, key] of [["Pillai's Trace", "Pillai's trace"], ["Wilks' Lambda", "Wilks' lambda"], ["Roy's Largest Root", "Roy's greatest root"]] as const) {
        const r = row(mv, eff, lab);
        ref[key].forEach((x, i) => near(r[i], x));
      }
    }
    expect(mv.footnotes[0]).toBe('Exact statistic');
    const bs = byCaption(out, 'Tests of Between-Subjects Effects');
    near(row(bs, 'Intercept')[0], R.between[0][0]);
    near(row(bs, 'Intercept')[3], R.between[0][1]);
    near(row(bs, 'g')[0], R.between[1][0]);
    near(row(bs, 'g')[3], R.between[1][1]);
    near(row(bs, 'Error')[0], R.between[2][0]);
    expect(bs.footnotes).toContain('Transformed Variable: Average');
    const lev = byCaption(out, "Levene's Test of Equality of Error Variances");
    ['t1', 't2', 't3', 't4'].forEach((v, j) => {
      near(row(lev, v)[0], R.levene[j][0]);
      near(row(lev, v)[3], R.levene[j][1]);
    });
    const box = byCaption(out, "Box's Test of Equality of Covariance Matrices");
    near(row(box, "Box's M")[0], R.boxM[0]);
    near(row(box, 'F')[0], R.boxM[1]);
    near(row(box, 'df1')[0], R.boxM[2]);
    near(row(box, 'df2')[0], R.boxM[3]);
    near(row(box, 'Sig.')[0], R.boxM[4]);
    const pe = byCaption(out, 'Parameter Estimates');
    near(row(pe, 't1', 'Intercept')[0], R.paramT1[0]);
    near(row(pe, 't1', 'Intercept')[1], R.paramT1[1]);
    const g1 = row(pe, 't1', '[g=1]');
    [R.paramT1[2], R.paramT1[3], R.paramT1[4], R.paramT1[5]].forEach((x, i) => near(g1[i], x));
    expect(texts(pe, 't1', '[g=2]')[0]).toBe('0');
    const est = byCaption(out, 'Estimates');
    R.emmTime.forEach(([mean, se], j) => {
      near(row(est, String(j + 1))[0], mean);
      near(row(est, String(j + 1))[1], se);
    });
    const pw = row(byCaption(out, 'Pairwise Comparisons'), '1', '4');
    R.pw14.forEach((x, i) => near(pw[i], x));
    const desc = byCaption(out, 'Descriptive Statistics');
    near(row(desc, 't4', 'Total')[0], MIX.reduce((s, r) => s + r[3], 0) / 11);
    expect(row(desc, 't4', '2')[2]).toBe(6);
  });

  it('Sidak adjustment and interaction EMMs (between compared within each time)', () => {
    const out = runExt('GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4 /EMMEANS=TABLES(time) COMPARE ADJ(SIDAK) /EMMEANS=TABLES(g*time) COMPARE(g).', mixed());
    expect(errorsOf(out)).toEqual([]);
    near(row(byCaption(out, 'Pairwise Comparisons'), '1', '4')[2], REF.mixed.pw14sidak);
    const est = byCaption(out, 'Estimates', 1);
    near(row(est, '2', '4')[0], MIX.slice(5).reduce((s, r) => s + r[3], 0) / 6);
    const pw = byCaption(out, 'Pairwise Comparisons', 1);
    // at time 1: group difference = parameter [g=1] of t1
    near(row(pw, '1', '1', '2')[0], REF.mixed.paramT1[2]);
    near(row(pw, '1', '1', '2')[2], REF.mixed.paramT1[5]);
  });

  it('students: three groups, listwise, Mauchly/epsilons and within SS', () => {
    const out = runExt('GLM hours stress age BY gender /WSFACTOR=x 3.', studentsDs);
    expect(errorsOf(out)).toEqual([]);
    const R = REF.students;
    const m = row(byCaption(out, "Mauchly's Test of Sphericity"), 'x');
    [R.rmMauchly.W, R.rmMauchly.chi, R.rmMauchly.df, R.rmMauchly.sig, R.rmMauchly.gg, R.rmMauchly.hf].forEach((x, i) => near(m[i], x));
    const we = byCaption(out, 'Tests of Within-Subjects Effects');
    near(row(we, 'x', 'Sphericity Assumed')[0], R.rmSS[0]);
    near(row(we, 'x * gender', 'Sphericity Assumed')[0], R.rmSS[1]);
    near(row(we, 'Error(x)', 'Sphericity Assumed')[0], R.rmSS[2]);
  });

  it('errors: level count mismatch, unknown subcommand, doubly multivariate', () => {
    expect(errorsOf(runExt('GLM t1 t2 t3 BY g /WSFACTOR=time 4.', mixed()))[0]).toMatch(/product of the levels/);
    expect(errorsOf(runExt('GLM t1 t2 /WSFACTOR=time 2 /FOO=1.', mixed()))[0]).toMatch(/Unknown subcommand/);
    expect(errorsOf(runExt('GLM t1 t2 t3 t4 /WSFACTOR=time 2 /MEASURE=a b.', mixed()))[0]).toMatch(/Doubly multivariate/);
    expect(errorsOf(runExt('GLM t1 t2 /WSFACTOR=g 2.', mixed()))[0]).toMatch(/already a variable/);
    expect(errorsOf(runExt('GLM t1 t2 BY g /METHOD=SSTYPE(1).', mixed()))[0]).toMatch(/Type III/);
  });

  it('other contrasts: same omnibus tests, contrast labels', () => {
    const base = runExt('GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4.', mixed());
    const rep = runExt('GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4 REPEATED.', mixed());
    const sim = runExt('GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4 SIMPLE(1).', mixed());
    const W = (o: OutputItem[]) => row(byCaption(o, 'Tests of Within-Subjects Effects'), 'time * g', 'Huynh-Feldt');
    expect(W(rep)).toEqual(W(base));
    expect(W(sim)).toEqual(W(base));
    const wc = byCaption(rep, 'Tests of Within-Subjects Contrasts');
    // repeated contrast Level 1 vs. Level 2: SS = N·mean(d)² over the unweighted group mean of d = t1 − t2 (1 df)
    expect(row(wc, 'time', 'Level 1 vs. Level 2')[1]).toBe(1);
    expect(row(byCaption(sim, 'Tests of Within-Subjects Contrasts'), 'time', 'Level 4 vs. Level 1')[1]).toBe(1);
  });
});

describe('GLM multivariate (MANOVA)', () => {
  it('two factors, unbalanced: multivariate tests, univariate Type III, Levene, Box, EMMs', () => {
    const out = runExt('GLM y1 y2 y3 BY a b /PRINT=DESCRIPTIVE ETASQ HOMOGENEITY /EMMEANS=TABLES(a) COMPARE ADJ(BONFERRONI).', manova());
    expect(errorsOf(out)).toEqual([]);
    const R = REF.manova;
    const mv = byCaption(out, 'Multivariate Tests');
    const names = { Intercept: 'Intercept', a: 'C(a, Sum)', b: 'C(b, Sum)', 'a * b': 'C(a, Sum):C(b, Sum)' } as const;
    for (const [eff, key] of Object.entries(names)) {
      const ref = R.mv[key];
      for (const [lab, k] of [["Pillai's Trace", "Pillai's trace"], ["Wilks' Lambda", "Wilks' lambda"], ["Roy's Largest Root", "Roy's greatest root"]] as const) {
        const r = row(mv, eff, lab);
        ref[k].forEach((x, i) => near(r[i], x));
      }
      near(row(mv, eff, "Hotelling's Trace")[0], ref['Hotelling-Lawley trace'][0]);
    }
    for (const [eff, key] of [['a', 'a'], ['a * b', 'ab'], ['Intercept', 'Intercept']] as const) {
      const r = row(mv, eff, "Hotelling's Trace");
      R.hotellingSpss[key].forEach((x, i) => near(r[i], x));
    }
    expect(mv.footnotes.some((f) => f.startsWith('The statistic is an upper bound'))).toBe(true);
    const bs = byCaption(out, 'Tests of Between-Subjects Effects');
    for (const y of ['y1', 'y2', 'y3'] as const) {
      const u = R.uni[y];
      near(row(bs, 'Corrected Model', y)[0], u.model);
      for (const [src, key] of [['Intercept', 'Intercept'], ['a', 'C(a, Sum)'], ['b', 'C(b, Sum)'], ['a * b', 'C(a, Sum):C(b, Sum)'], ['Error', 'Residual']] as const) {
        const r = row(bs, src, y);
        near(r[0], u.rows[key][0]);
        expect(r[1]).toBe(u.rows[key][1]);
        if (u.rows[key][2] !== null) near(r[3], u.rows[key][2]);
      }
      near(row(bs, 'Total', y)[0], u.total);
      near(row(bs, 'Corrected Total', y)[0], u.ctot);
      expect(row(bs, 'Corrected Total', y)[1]).toBe(20);
    }
    expect(bs.footnotes[0]).toBe(`R Squared = ${R.uni.y1.r2.toFixed(3).replace(/^0/, '')} (Adjusted R Squared = ${R.uni.y1.adj.toFixed(3).replace(/^0/, '')})`);
    expect(bs.footnotes[1]).toContain(`(Adjusted R Squared = -${Math.abs(R.uni.y2.adj).toFixed(3).replace(/^0/, '')})`);
    const lev = byCaption(out, "Levene's Test of Equality of Error Variances");
    ['y1', 'y2', 'y3'].forEach((y, j) => {
      near(row(lev, y)[0], R.levene[j][0]);
      expect(row(lev, y).slice(1, 3)).toEqual([5, 15]);
      near(row(lev, y)[3], R.levene[j][1]);
    });
    const box = byCaption(out, "Box's Test of Equality of Covariance Matrices");
    R.boxM.forEach((x, i) => near(row(box, ["Box's M", 'F', 'df1', 'df2', 'Sig.'][i])[0], x));
    const est = byCaption(out, 'Estimates');
    R.emmA_y1.forEach(([mean, se], j) => {
      near(row(est, 'y1', String(j + 1))[0], mean);
      near(row(est, 'y1', String(j + 1))[1], se);
    });
    const pw = row(byCaption(out, 'Pairwise Comparisons'), 'y1', '1', '3');
    R.pw13_y1.forEach((x, i) => near(pw[i], x));
    const desc = byCaption(out, 'Descriptive Statistics');
    expect(row(desc, 'y1', '1', '2')[2]).toBe(4);
    expect(desc.rows.at(-1)!.filter((c) => c.header).map((c) => c.text)).toEqual(['y3', 'Total', 'Total']);
    expect(desc.rows.at(-1)!.at(-1)!.num).toBe(21);
  });

  it('students: covariate, listwise deletion of missing values', () => {
    const out = runExt('GLM sleep stress gpa BY gender WITH hours.', studentsDs);
    expect(errorsOf(out)).toEqual([]);
    const R = REF.students;
    const mv = byCaption(out, 'Multivariate Tests');
    for (const [eff, key] of [['gender', 'C(gender, Sum)'], ['hours', 'hours'], ['Intercept', 'Intercept']] as const)
      for (const [lab, k] of [["Pillai's Trace", "Pillai's trace"], ["Wilks' Lambda", "Wilks' lambda"]] as const) {
        const r = row(mv, eff, lab);
        R.mv[key][k].forEach((x, i) => near(r[i], x));
      }
    const bs = byCaption(out, 'Tests of Between-Subjects Effects');
    // the Dependent Variable column shows variable labels
    const label = { sleep: 'Average sleep (hours/night)', gpa: 'Grade point average' } as const;
    for (const y of ['sleep', 'gpa'] as const)
      for (const [src, key] of [['Intercept', 'Intercept'], ['gender', 'C(gender, Sum)'], ['hours', 'hours'], ['Error', 'Residual']] as const) {
        near(row(bs, src, label[y])[0], R[y][key][0]);
        if (R[y][key][1] !== null) near(row(bs, src, label[y])[3], R[y][key][1]);
      }
    expect(row(bs, 'Corrected Total', label.gpa)[1]).toBe(R.N - 1);
    const bf = byCaption(out, 'Between-Subjects Factors');
    expect(texts(bf, 'gender', '1')[0]).toBe('Female');
    expect(['1', '2', '3'].reduce((s, l) => s + row(bf, 'gender', l)[1]!, 0)).toBe(R.N);
  });

  it('frequency weights equal replicated cases; FILTER and SPLIT FILE equal subsets', () => {
    const base = manova();
    const w = MAN.map((_, i) => (i % 3) + 1);
    const weighted = dataset({ a: base.columns[0] as number[], b: base.columns[1] as number[], y1: base.columns[2] as number[], y2: base.columns[3] as number[], y3: base.columns[4] as number[], w }, { weight: 'w' });
    const rep = (c: (number | null)[]) => c.flatMap((x, i) => new Array(w[i]).fill(x));
    const replicated = dataset({ a: rep(base.columns[0] as number[]), b: rep(base.columns[1] as number[]), y1: rep(base.columns[2] as number[]), y2: rep(base.columns[3] as number[]), y3: rep(base.columns[4] as number[]) });
    const syn = 'GLM y1 y2 y3 BY a b /PRINT=HOMOGENEITY PARAMETER /EMMEANS=TABLES(a*b) COMPARE(b).';
    const strip = (o: OutputItem[]) => tables(o).map((t) => t.rows.map((r) => r.map((c) => c.text)));
    expect(strip(runExt(syn, weighted))).toEqual(strip(runExt(syn, replicated)));
    // FILTER: only a ≠ 3
    const f = { ...manova(), variables: [...base.variables, makeVariable('keep')], columns: [...base.columns, MAN.map((r) => (r[0] === 3 ? 0 : 1))], filter: 'keep' };
    const sub = dataset({ a: MAN.filter((r) => r[0] !== 3).map((r) => r[0]), b: MAN.filter((r) => r[0] !== 3).map((r) => r[1]), y1: MAN.filter((r) => r[0] !== 3).map((r) => r[2]), y2: MAN.filter((r) => r[0] !== 3).map((r) => r[3]), y3: MAN.filter((r) => r[0] !== 3).map((r) => r[4]) });
    expect(strip(runExt('GLM y1 y2 y3 BY b.', f))).toEqual(strip(runExt('GLM y1 y2 y3 BY b.', sub)));
    // SPLIT FILE by a (data sorted by a): one set of tables per group, labelled
    const split = { ...manova(), split: ['a'] };
    const out = runExt('GLM y1 y2 y3 BY b.', split);
    expect(flatItems(out).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['a = 1', 'a = 2', 'a = 3']);
    expect(tables(out).filter((t) => t.caption === 'Multivariate Tests')).toHaveLength(3);
  });

  it('missing values: listwise across all dependent variables', () => {
    const base = manova();
    const cols = base.columns.map((c) => [...c, null]);
    cols[0][21] = 1;
    cols[1][21] = 1;
    cols[2][21] = 99;
    cols[3][21] = 99;
    const ds = { ...base, columns: cols };
    const strip = (o: OutputItem[]) => tables(o).map((t) => t.rows.map((r) => r.map((c) => c.text)));
    expect(strip(runExt('GLM y1 y2 y3 BY a b.', ds))).toEqual(strip(runExt('GLM y1 y2 y3 BY a b.', manova())));
  });

  it('singular error SSCP (y3 = y1 + y2): no multivariate statistics, univariate tests kept', () => {
    const base = manova();
    const ds = { ...base, columns: [...base.columns.slice(0, 4), MAN.map((r) => r[2] + r[3])] };
    const out = runExt('GLM y1 y2 y3 BY a.', ds);
    expect(errorsOf(out)).toEqual([]);
    const mv = byCaption(out, 'Multivariate Tests');
    expect(texts(mv, 'a', "Pillai's Trace")).toEqual(['', '', '', '', '']);
    expect(mv.footnotes.some((f) => f.includes('singular'))).toBe(true);
    expect(row(byCaption(out, 'Tests of Between-Subjects Effects'), 'a', 'y3')[3]).not.toBeNull();
  });

  it('a group with one case; parameter estimates with redundant parameters', () => {
    const ds = dataset({ g: [1, 1, 1, 2, 2, 2, 3], y1: [1, 2, 4, 3, 5, 6, 9], y2: [2, 1, 3, 3, 6, 4, 2] });
    const out = runExt('GLM y1 y2 BY g /PRINT=PARAMETER HOMOGENEITY.', ds);
    expect(errorsOf(out)).toEqual([]);
    const pe = byCaption(out, 'Parameter Estimates');
    expect(row(pe, 'y1', 'Intercept')[0]).toBe(9);
    near(row(pe, 'y1', '[g=1]')[0], 7 / 3 - 9);
    expect(texts(pe, 'y2', '[g=3]')[0]).toBe('0');
    expect(pe.footnotes).toEqual(['This parameter is set to zero because it is redundant.']);
    // Box's M uses the two groups with nonsingular covariance matrices
    expect(row(byCaption(out, "Box's Test of Equality of Covariance Matrices"), 'df1')[0]).toBe(3);
  });

  it('Czech output and decimal comma', () => {
    const out = runExt('GLM t1 t2 t3 t4 BY g /WSFACTOR=time 4.', mixed(), 'cs', ',');
    const caps = tables(out).map((t) => t.caption);
    expect(caps).toContain('Vícerozměrné testy');
    expect(caps).toContain('Mauchlyho test sféricity');
    expect(caps).toContain('Testy vnitrosubjektových efektů');
    expect(caps).toContain('Testy mezisubjektových efektů');
    expect(texts(byCaption(out, 'Vícerozměrné testy'), 'time', 'Pillaiova stopa')[0]).toBe(String(REF.mixed.mv.Intercept["Pillai's trace"][0].toFixed(3)).replace('0.', ','));
  });
});

describe('GLM helpers', () => {
  it('multivariate tests for s = 1 are exact and identical in F', () => {
    const r = multivariateTests([[4]], [[10]], 2, 20)!;
    expect(r.every((x) => x.exact)).toBe(true);
    r.forEach((x) => expect(x.F).toBeCloseTo(r[0].F, 10));
    expect(r[0].F).toBeCloseTo((0.4 * 20) / 2, 10);
  });
  it('sphericity of a spherical matrix: W = 1, epsilons 1', () => {
    const s = sphericity([[2, 0], [0, 2]], 10);
    expect(s.W).toBeCloseTo(1, 12);
    expect(s.gg).toBeCloseTo(1, 12);
    expect(s.hf).toBe(1);
  });
  it('i18n fragments have identical keys', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(cs).sort()).toEqual(keys(en).sort());
  });
});
