/*
 * DISCRIMINANT checked against scipy / scikit-learn (1.9) on Fisher's iris data and the students
 * sample. Canonical functions come from scipy.linalg.eigh(B, W) (generalised symmetric problem,
 * vᵀWv = 1), scaled by √(n − g) and oriented so that the standardised coefficients sum to a
 * positive number (this reproduces the iris output SPSS publishes: eigenvalues 32.192 and .285,
 * Box's M 146.663, F 7.045 on 20 and 77566.751 df, raw coefficients −.829 −1.534 2.201 2.810,
 * constant −2.105, centroid of setosa −7.608). Posterior probabilities, classification tables and
 * leave-one-out tables come from sklearn's LinearDiscriminantAnalysis, refitted without each case
 * (frequency weights by replicating cases; the leave-one-out reference leaves out the whole
 * weighted case, as the implementation does). Box's M follows Box's F approximation over the
 * groups with non-singular covariance matrices. The stepwise reference is an independent numpy
 * implementation of the Wilks' lambda method (removal checked first, F to enter/remove).
 *
 * Reference script (python3 ref_discrim.py > ref.json; post/scores trimmed to the first 8 cases):
 *
 *   import json, numpy as np
 *   from scipy.linalg import eigh
 *   from scipy import stats
 *   from sklearn.discriminant_analysis import LinearDiscriminantAnalysis as LDA
 *   from sklearn.datasets import load_iris
 *
 *   def r(x, d=6):
 *       return np.round(np.asarray(x, float), d).tolist()
 *
 *   def lda_ref(X, y, w=None, priors=None, loo=True, Xnew=None):
 *       """Reference LDA. X: n×p, y: group codes, w: frequency weights (ints)."""
 *       X = np.asarray(X, float); y = np.asarray(y); n0, p = X.shape
 *       w = np.ones(n0) if w is None else np.asarray(w, float)
 *       codes = np.unique(y); g = len(codes)
 *       nj = np.array([w[y == c].sum() for c in codes]); n = nj.sum()
 *       means = np.array([(w[y == c][:, None] * X[y == c]).sum(0) / nj[k] for k, c in enumerate(codes)])
 *       grand = (w[:, None] * X).sum(0) / n
 *       W = sum(((X[y == c] - means[k]) * w[y == c][:, None]).T @ (X[y == c] - means[k]) for k, c in enumerate(codes))
 *       T = ((X - grand) * w[:, None]).T @ (X - grand)
 *       B = T - W
 *       lam, V = eigh(B, W)                     # B v = λ W v, vᵀ W v = 1
 *       order = np.argsort(lam)[::-1]; m = min(g - 1, p)
 *       lam = lam[order][:m]; V = V[:, order][:, :m]
 *       sdw = np.sqrt(np.diag(W))
 *       for k in range(m):                      # sign: positive sum of standardised coefficients
 *           if (V[:, k] * sdw).sum() < 0: V[:, k] *= -1
 *       raw = V * np.sqrt(n - g)
 *       C = W / (n - g)
 *       std = raw * np.sqrt(np.diag(C))[:, None]
 *       const = -grand @ raw
 *       cent = means @ raw + const
 *       struct = (C @ raw) / np.sqrt(np.diag(C))[:, None]
 *       wl = [np.prod(1 / (1 + lam[k:])) for k in range(m)]
 *       chi = [-(n - 1 - (p + g) / 2) * np.log(l) for l in wl]
 *       df = [(p - k) * (g - 1 - k) for k in range(m)]
 *       pr = np.full(g, 1 / g) if priors is None else np.asarray(priors, float)
 *       Ci = np.linalg.inv(C)
 *       fisher = means @ Ci
 *       fconst = np.log(pr) - 0.5 * np.einsum('ij,ij->i', fisher, means)
 *       univ_l = np.diag(W) / np.diag(T)
 *       univ_f = (np.diag(T) - np.diag(W)) / (g - 1) / (np.diag(W) / (n - g))
 *       # Box's M (groups with non-singular covariance), Box's F approximation
 *       use = [k for k, c in enumerate(codes) if nj[k] - 1 > 0 and np.linalg.matrix_rank(np.cov(X[y == c].T, fweights=w[y == c].astype(int)) if (y == c).sum() > 1 else np.zeros((p, p))) == p]
 *       covs = {k: ((X[y == c] - means[k]) * w[y == c][:, None]).T @ (X[y == c] - means[k]) / (nj[k] - 1) for k, c in enumerate(codes) if nj[k] > 1}
 *       gu = len(use); nu = nj[use].sum()
 *       Cp = sum((nj[k] - 1) * covs[k] for k in use) / (nu - gu)
 *       M = (nu - gu) * np.linalg.slogdet(Cp)[1] - sum((nj[k] - 1) * np.linalg.slogdet(covs[k])[1] for k in use)
 *       s1 = sum(1 / (nj[k] - 1) for k in use) - 1 / (nu - gu)
 *       s2 = sum(1 / (nj[k] - 1) ** 2 for k in use) - 1 / (nu - gu) ** 2
 *       c1 = s1 * (2 * p * p + 3 * p - 1) / (6 * (p + 1) * (gu - 1)); c2 = s2 * (p - 1) * (p + 2) / (6 * (gu - 1))
 *       df1 = (gu - 1) * p * (p + 1) / 2
 *       if c2 > c1 ** 2:
 *           df2 = (df1 + 2) / (c2 - c1 ** 2); b = df1 / (1 - c1 - df1 / df2); F = M / b
 *       else:
 *           df2 = (df1 + 2) / (c1 ** 2 - c2); b = df2 / (1 - c1 + 2 / df2); F = df2 * M / (df1 * (b - M))
 *       logdets = [float(np.linalg.slogdet(covs[k])[1]) if k in use else None for k in range(g)]
 *       # classification with sklearn (expanded by frequency weights), posterior and scores
 *       rep = w.astype(int)
 *       sk = LDA(solver='lsqr', priors=pr).fit(np.repeat(X, rep, 0), np.repeat(y, rep))
 *       post = sk.predict_proba(X); pred = codes[np.argmax(post, 1)]
 *       tab = np.zeros((g, g))
 *       for i in range(n0): tab[list(codes).index(y[i]), list(codes).index(pred[i])] += w[i]
 *       out = dict(eig=r(lam, 8), cancorr=r(np.sqrt(lam / (1 + lam)), 8), wilks=r(wl, 8), chi=r(chi, 6), df=df,
 *                  sig=r([stats.chi2.sf(c, d) for c, d in zip(chi, df)], 8), std=r(std, 8), raw=r(raw, 8), const=r(const, 8),
 *                  cent=r(cent, 8), struct=r(struct, 8), fisher=r(fisher, 6), fconst=r(fconst, 6), univL=r(univ_l, 8), univF=r(univ_f, 6),
 *                  boxM=float(M), boxF=float(F), boxDf1=float(df1), boxDf2=float(df2), boxP=float(stats.f.sf(F, df1, df2)), logdets=logdets,
 *                  pooledLogdet=float(np.linalg.slogdet(C)[1]), tab=r(tab, 6), post=r(post, 9), scores=r(X @ raw + const, 8),
 *                  covW=r(C, 8), covT=r(T / (n - 1), 8))
 *       if loo:
 *           cv = np.zeros((g, g))
 *           for i in range(n0):
 *               keep = np.arange(n0) != i
 *               yk = y[keep]; codes_k = np.unique(yk)
 *               pk = np.array([pr[list(codes).index(c)] for c in codes_k])
 *               m2 = LDA(solver='lsqr', priors=pk / pk.sum()).fit(np.repeat(X[keep], rep[keep], 0), np.repeat(yk, rep[keep]))
 *               # sklearn renormalises priors; the argmax is unchanged by a common scale
 *               pi = m2.predict(X[i:i + 1])[0]
 *               cv[list(codes).index(y[i]), list(codes).index(pi)] += w[i]
 *           out['cv'] = r(cv, 6)
 *       if Xnew is not None:
 *           pn = sk.predict_proba(np.asarray(Xnew, float)); out['newPost'] = r(pn, 9); out['newPred'] = codes[np.argmax(pn, 1)].tolist()
 *           out['newScores'] = r(np.asarray(Xnew, float) @ raw + const, 8)
 *       return out
 *
 *   def stepwise(X, y, fin=3.84, fout=2.71, tol=0.001):
 *       X = np.asarray(X, float); codes = np.unique(y); g = len(codes); n, p = X.shape
 *       means = np.array([X[y == c].mean(0) for c in codes])
 *       W = sum((X[y == c] - means[k]).T @ (X[y == c] - means[k]) for k, c in enumerate(codes))
 *       T = (X - X.mean(0)).T @ (X - X.mean(0))
 *       lam = lambda S: 1.0 if not S else np.linalg.det(W[np.ix_(S, S)]) / np.linalg.det(T[np.ix_(S, S)])
 *       def toler(x, S):
 *           if not S: return 1.0
 *           return (W[x, x] - W[x, S] @ np.linalg.solve(W[np.ix_(S, S)], W[S, x])) / W[x, x]
 *       S = []; steps = []
 *       while len(steps) < 2 * p:
 *           if len(S) > 1:
 *               fr = [((n - g - len(S) + 1) / (g - 1)) * (lam([s for s in S if s != x]) / lam(S) - 1) for x in S]
 *               k = int(np.argmin(fr))
 *               if fr[k] < fout and steps[-1][0] != S[k]:
 *                   steps.append(('remove', S[k])); S.pop(k); continue
 *           cand = []
 *           for x in range(p):
 *               if x in S: continue
 *               if toler(x, S) < tol or any(toler(s, [t for t in S + [x] if t != s]) < tol for s in S): continue
 *               F = ((n - g - len(S)) / (g - 1)) * (lam(S) / lam(S + [x]) - 1)
 *               cand.append((lam(S + [x]), F, x))
 *           if not cand: break
 *           l, F, x = min(cand)
 *           if F < fin: break
 *           S.append(x); steps.append((x, lam(S), F))
 *       return [[int(s[0]) if s[0] != 'remove' else -1, float(s[1]), float(s[2]) if len(s) > 2 else None] for s in steps], S
 *
 *   iris = load_iris(); IX = iris.data; Iy = iris.target + 1
 *   d = json.load(open('/home/user/PSPP/web/src/samples/students.json'))
 *   col = {v['name']: d['columns'][i] for i, v in enumerate(d['variables'])}
 *   P4 = ['hours', 'sleep', 'stress', 'gpa']
 *   def rows(group, preds, lo, hi, extra=None):
 *       out = []
 *       for i in range(120):
 *           gv = col[group][i]; xs = [col[v][i] for v in preds]
 *           if any(x is None for x in xs) or gv is None or not (lo <= gv <= hi): continue
 *           out.append((i, gv, xs, (extra[i] if extra else 1)))
 *       return out
 *   res = {}
 *   res['iris'] = lda_ref(IX, Iy)
 *   res['irisData'] = [[*map(float, IX[i]), int(Iy[i])] for i in range(150)]
 *   f = rows('faculty', P4, 1, 5)
 *   res['faculty'] = lda_ref([x for _, _, x, _ in f], np.array([g for _, g, _, _ in f]))
 *   res['facultyRows'] = [i for i, _, _, _ in f]
 *   res['facultySize'] = lda_ref([x for _, _, x, _ in f], np.array([g for _, g, _, _ in f]), priors=np.bincount([g for _, g, _, _ in f])[1:] / len(f), loo=False)
 *   # weighted (WEIGHT BY year), priors SIZE
 *   fw = rows('faculty', P4, 1, 5, col['year'])
 *   wts = np.array([w for *_, w in fw]); gs = np.array([g for _, g, _, _ in fw])
 *   res['weighted'] = lda_ref([x for _, _, x, _ in fw], gs, w=wts, priors=np.array([wts[gs == k].sum() for k in range(1, 6)]) / wts.sum())
 *   # gender (group with 3 cases), 3 groups
 *   gd = rows('gender', P4, 1, 3)
 *   res['gender'] = lda_ref([x for _, _, x, _ in gd], np.array([g for _, g, _, _ in gd]))
 *   # two groups, unequal priors
 *   jb = rows('job', ['hours', 'gpa'], 0, 1)
 *   res['job'] = lda_ref([x for _, _, x, _ in jb], np.array([g for _, g, _, _ in jb]), priors=[0.3, 0.7])
 *   # ungrouped: faculty(1,4), faculty-5 cases classified
 *   f4 = rows('faculty', P4, 1, 4); f5 = [r_ for r_ in rows('faculty', P4, 5, 5)]
 *   res['ungrouped'] = lda_ref([x for _, _, x, _ in f4], np.array([g for _, g, _, _ in f4]), loo=False, Xnew=[x for _, _, x, _ in f5])
 *   res['ungroupedRows'] = [i for i, *_ in f5]
 *   # stepwise
 *   res['stepDefault'] = stepwise([x for _, _, x, _ in f], np.array([g for _, g, _, _ in f]))
 *   res['stepLow'] = stepwise([x for _, _, x, _ in f], np.array([g for _, g, _, _ in f]), fin=1.0, fout=0.5)
 *   # stepwise on iris (all four enter)
 *   res['stepIris'] = stepwise(IX, Iy)
 *   print(json.dumps(res, separators=(',', ':')))
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import students from '../../samples/students.json';
import type { Cell, Dataset, OutputItem } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { parseChart } from '../../charts/types';
import { runExtCommandFull } from '../runner';
import { ctxFor, errorsOf, flatItems, haveEngine, runExt, runMixed, tables } from '../testing';

const IRIS_DATA = '5.1 3.5 1.4 0.2 1;4.9 3 1.4 0.2 1;4.7 3.2 1.3 0.2 1;4.6 3.1 1.5 0.2 1;5 3.6 1.4 0.2 1;5.4 3.9 1.7 0.4 1;4.6 3.4 1.4 0.3 1;5 3.4 1.5 0.2 1;4.4 2.9 1.4 0.2 1;4.9 3.1 1.5 0.1 1;5.4 3.7 1.5 0.2 1;4.8 3.4 1.6 0.2 1;4.8 3 1.4 0.1 1;4.3 3 1.1 0.1 1;5.8 4 1.2 0.2 1;5.7 4.4 1.5 0.4 1;5.4 3.9 1.3 0.4 1;5.1 3.5 1.4 0.3 1;5.7 3.8 1.7 0.3 1;5.1 3.8 1.5 0.3 1;5.4 3.4 1.7 0.2 1;5.1 3.7 1.5 0.4 1;4.6 3.6 1 0.2 1;5.1 3.3 1.7 0.5 1;4.8 3.4 1.9 0.2 1;5 3 1.6 0.2 1;5 3.4 1.6 0.4 1;5.2 3.5 1.5 0.2 1;5.2 3.4 1.4 0.2 1;4.7 3.2 1.6 0.2 1;4.8 3.1 1.6 0.2 1;5.4 3.4 1.5 0.4 1;5.2 4.1 1.5 0.1 1;5.5 4.2 1.4 0.2 1;4.9 3.1 1.5 0.2 1;5 3.2 1.2 0.2 1;5.5 3.5 1.3 0.2 1;4.9 3.6 1.4 0.1 1;4.4 3 1.3 0.2 1;5.1 3.4 1.5 0.2 1;5 3.5 1.3 0.3 1;4.5 2.3 1.3 0.3 1;4.4 3.2 1.3 0.2 1;5 3.5 1.6 0.6 1;5.1 3.8 1.9 0.4 1;4.8 3 1.4 0.3 1;5.1 3.8 1.6 0.2 1;4.6 3.2 1.4 0.2 1;5.3 3.7 1.5 0.2 1;5 3.3 1.4 0.2 1;7 3.2 4.7 1.4 2;6.4 3.2 4.5 1.5 2;6.9 3.1 4.9 1.5 2;5.5 2.3 4 1.3 2;6.5 2.8 4.6 1.5 2;5.7 2.8 4.5 1.3 2;6.3 3.3 4.7 1.6 2;4.9 2.4 3.3 1 2;6.6 2.9 4.6 1.3 2;5.2 2.7 3.9 1.4 2;5 2 3.5 1 2;5.9 3 4.2 1.5 2;6 2.2 4 1 2;6.1 2.9 4.7 1.4 2;5.6 2.9 3.6 1.3 2;6.7 3.1 4.4 1.4 2;5.6 3 4.5 1.5 2;5.8 2.7 4.1 1 2;6.2 2.2 4.5 1.5 2;5.6 2.5 3.9 1.1 2;5.9 3.2 4.8 1.8 2;6.1 2.8 4 1.3 2;6.3 2.5 4.9 1.5 2;6.1 2.8 4.7 1.2 2;6.4 2.9 4.3 1.3 2;6.6 3 4.4 1.4 2;6.8 2.8 4.8 1.4 2;6.7 3 5 1.7 2;6 2.9 4.5 1.5 2;5.7 2.6 3.5 1 2;5.5 2.4 3.8 1.1 2;5.5 2.4 3.7 1 2;5.8 2.7 3.9 1.2 2;6 2.7 5.1 1.6 2;5.4 3 4.5 1.5 2;6 3.4 4.5 1.6 2;6.7 3.1 4.7 1.5 2;6.3 2.3 4.4 1.3 2;5.6 3 4.1 1.3 2;5.5 2.5 4 1.3 2;5.5 2.6 4.4 1.2 2;6.1 3 4.6 1.4 2;5.8 2.6 4 1.2 2;5 2.3 3.3 1 2;5.6 2.7 4.2 1.3 2;5.7 3 4.2 1.2 2;5.7 2.9 4.2 1.3 2;6.2 2.9 4.3 1.3 2;5.1 2.5 3 1.1 2;5.7 2.8 4.1 1.3 2;6.3 3.3 6 2.5 3;5.8 2.7 5.1 1.9 3;7.1 3 5.9 2.1 3;6.3 2.9 5.6 1.8 3;6.5 3 5.8 2.2 3;7.6 3 6.6 2.1 3;4.9 2.5 4.5 1.7 3;7.3 2.9 6.3 1.8 3;6.7 2.5 5.8 1.8 3;7.2 3.6 6.1 2.5 3;6.5 3.2 5.1 2 3;6.4 2.7 5.3 1.9 3;6.8 3 5.5 2.1 3;5.7 2.5 5 2 3;5.8 2.8 5.1 2.4 3;6.4 3.2 5.3 2.3 3;6.5 3 5.5 1.8 3;7.7 3.8 6.7 2.2 3;7.7 2.6 6.9 2.3 3;6 2.2 5 1.5 3;6.9 3.2 5.7 2.3 3;5.6 2.8 4.9 2 3;7.7 2.8 6.7 2 3;6.3 2.7 4.9 1.8 3;6.7 3.3 5.7 2.1 3;7.2 3.2 6 1.8 3;6.2 2.8 4.8 1.8 3;6.1 3 4.9 1.8 3;6.4 2.8 5.6 2.1 3;7.2 3 5.8 1.6 3;7.4 2.8 6.1 1.9 3;7.9 3.8 6.4 2 3;6.4 2.8 5.6 2.2 3;6.3 2.8 5.1 1.5 3;6.1 2.6 5.6 1.4 3;7.7 3 6.1 2.3 3;6.3 3.4 5.6 2.4 3;6.4 3.1 5.5 1.8 3;6 3 4.8 1.8 3;6.9 3.1 5.4 2.1 3;6.7 3.1 5.6 2.4 3;6.9 3.1 5.1 2.3 3;5.8 2.7 5.1 1.9 3;6.8 3.2 5.9 2.3 3;6.7 3.3 5.7 2.5 3;6.7 3 5.2 2.3 3;6.3 2.5 5 1.9 3;6.5 3 5.2 2 3;6.2 3.4 5.4 2.3 3;5.9 3 5.1 1.8 3';
const REF = {"iris":{"eig":[32.1919292,0.28539104],"cancorr":[0.98482089,0.47119702],"wilks":[0.02343863,0.77797337],"chi":[546.115296,36.529664],"df":[8,3],"sig":[0.0,6e-08],"std":[[-0.42695485,0.01240753],[-0.52124168,0.73526131],[0.94725725,-0.40103782],[0.57516077,0.58103986]],"raw":[[-0.82937764,0.02410215],[-1.53447307,2.16452123],[2.20121166,-0.93192121],[2.81046031,2.83918785]],"const":[-2.10510645,-6.66147254],"cent":[[-7.60759993,0.21513302],[1.82504949,-0.72789962],[5.78255044,0.5127666]],"struct":[[0.22259594,0.31081172],[-0.11901151,0.86368092],[0.70606538,0.16770138],[0.63317793,0.73724206]],"fisher":[[23.544167,23.58787,-16.430639,-17.398411],[15.698209,7.07251,5.211451,6.434229],[12.445849,3.68528,12.766545,21.079113]],"fconst":[-86.30847,-72.852607,-104.36832],"univL":[0.38129427,0.59921715,0.05862828,0.07111707],"univF":[119.264502,49.16004,1180.161182,960.007147],"boxM":146.66324921251157,"boxF":7.045261695711881,"boxDf1":20.0,"boxDf2":77566.75126903554,"boxP":3.578106019559326e-20,"logdets":[-13.067360326587803,-10.874325040246486,-8.927058478258859],"pooledLogdet":-9.958538770047976,"tab":[[50.0,0.0,0.0],[0.0,48.0,2.0],[0.0,1.0,49.0]],"post":[[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,0.0]],"scores":[[-8.06179978,0.30042062],[-7.12868772,-0.78666043],[-7.48982797,-0.26538449],[-6.81320057,-0.67063107],[-8.13230933,0.51446253],[-7.70194674,1.46172097],[-7.21261762,0.35583621],[-7.60529355,-0.01163384]],"covW":[[0.26500816,0.09272109,0.16751429,0.03840136],[0.09272109,0.11538776,0.05524354,0.0327102],[0.16751429,0.05524354,0.18518776,0.04266531],[0.03840136,0.0327102,0.04266531,0.04188163]],"cv":[[50.0,0.0,0.0],[0.0,48.0,2.0],[0.0,1.0,49.0]]},"faculty":{"eig":[0.26834537,0.08403384,0.02107273,0.00226767],"cancorr":[0.45996871,0.27842336,0.14365874,0.04756618],"wilks":[0.71068841,0.90139836,0.97714632,0.99773746],"chi":[37.055048,11.263167,2.508398,0.245764],"df":[16,9,4,1],"sig":[0.00205998,0.25810068,0.64313267,0.62007376],"std":[[1.01048237,-0.40404524,0.44953172,-0.07222731],[-0.08538609,-0.06027707,0.29522992,1.06114983],[-0.47834177,0.97213262,0.49032648,0.36198358],[0.30117184,0.59249229,-0.77918113,0.16274409]],"raw":[[0.13453336,-0.05379368,0.05984964,-0.00961618],[-0.07969089,-0.05625663,0.27553828,0.99037186],[-0.08000629,0.16259655,0.08201082,0.0605445],[0.70692037,1.39071725,-1.8289194,0.38199825]],"const":[-2.77559288,-5.79654826,-0.0098491,-8.85870313],"cent":[[-0.03086914,-0.16266837,-0.13133733,0.04812079],[-0.23685721,-0.34661465,0.21909606,-0.01361023],[-0.39742768,0.13495042,-0.11115811,-0.06754978],[1.05146342,0.11500261,0.03162233,-0.01957935],[-0.40019148,0.63709189,0.16026661,0.05796074]],"struct":[[0.85595468,0.20154605,0.47337217,-0.05137673],[-0.03464216,-0.33202646,-0.0695166,0.94006691],[0.04382671,0.79336902,0.59575115,-0.11715538],[0.50827819,0.48972829,-0.6617396,0.25282443]],"fisher":[[-0.026731,8.251921,1.22575,13.400018],[-0.022981,8.314105,1.237323,12.334088],[-0.089735,8.155392,1.298121,13.473702],[0.114346,8.127901,1.193571,14.227402],[-0.102081,8.326454,1.409847,13.721616]],"fconst":[-60.919629,-58.826958,-60.675931,-65.471749,-64.894484],"univL":[0.83004979,0.98844323,0.94257861,0.91003985],"univF":[5.579356,0.318604,1.660055,2.693744],"boxM":49.32550285013485,"boxF":1.1170388162273046,"boxDf1":40.0,"boxDf2":11534.486445459612,"boxP":0.282013796333973,"logdets":[4.919526757822086,5.336286516695543,5.262370251673041,5.4008576607695655,3.8907706186075273],"pooledLogdet":5.507918237304126,"tab":[[4.0,13.0,4.0,8.0,6.0],[2.0,8.0,4.0,4.0,4.0],[3.0,7.0,4.0,6.0,5.0],[3.0,1.0,1.0,13.0,2.0],[0.0,0.0,3.0,2.0,7.0]],"post":[[0.336675769,0.343534637,0.166738461,0.110964367,0.042086767],[0.165307368,0.306324219,0.211278501,0.029351336,0.287738576],[0.215558435,0.261769286,0.212397752,0.120278449,0.189996077],[0.219250397,0.165843143,0.217119947,0.173882713,0.2239038],[0.132410971,0.159408503,0.194971039,0.066304998,0.446904489],[0.254998399,0.335667335,0.235976734,0.049489487,0.123868045],[0.23112561,0.36656519,0.196017471,0.076321546,0.129970183],[0.227523812,0.216013596,0.260623363,0.068863251,0.226975978]],"scores":[[0.1275445,-1.87222178,-0.63192636,-0.06493384],[-1.05450476,0.00551411,1.39511558,1.10173056],[-0.08879878,-0.07546769,0.60651458,-0.24024382],[0.17803119,0.46956789,-0.06994552,0.11062985],[-0.47180927,1.13104155,1.21983141,0.91208996],[-0.69659287,-0.86975193,0.07431047,0.01314741],[-0.3337371,-0.7982839,0.79321846,0.005643],[-0.54734357,0.12055366,-0.08443573,0.25739854]],"covW":[[56.41538159,-1.43070186,21.79983057,0.66407674],[-1.43070186,1.1480395,-2.66804575,0.04722892],[21.79983057,-2.66804575,35.74607649,-0.03321625],[0.66407674,0.04722892,-0.03321625,0.18150464]],"cv":[[4.0,13.0,4.0,8.0,6.0],[4.0,5.0,4.0,4.0,5.0],[3.0,7.0,4.0,6.0,5.0],[4.0,1.0,2.0,11.0,2.0],[0.0,1.0,5.0,2.0,4.0]]},"facultyRows":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,50,51,52,53,54,55,56,57,58,60,61,62,63,64,65,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,89,90,91,92,93,94,95,96,97,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118],"facultySize":{"eig":[0.26834537,0.08403384,0.02107273,0.00226767],"cancorr":[0.45996871,0.27842336,0.14365874,0.04756618],"wilks":[0.71068841,0.90139836,0.97714632,0.99773746],"chi":[37.055048,11.263167,2.508398,0.245764],"df":[16,9,4,1],"sig":[0.00205998,0.25810068,0.64313267,0.62007376],"std":[[1.01048237,-0.40404524,0.44953172,-0.07222731],[-0.08538609,-0.06027707,0.29522992,1.06114983],[-0.47834177,0.97213262,0.49032648,0.36198358],[0.30117184,0.59249229,-0.77918113,0.16274409]],"raw":[[0.13453336,-0.05379368,0.05984964,-0.00961618],[-0.07969089,-0.05625663,0.27553828,0.99037186],[-0.08000629,0.16259655,0.08201082,0.0605445],[0.70692037,1.39071725,-1.8289194,0.38199825]],"const":[-2.77559288,-5.79654826,-0.0098491,-8.85870313],"cent":[[-0.03086914,-0.16266837,-0.13133733,0.04812079],[-0.23685721,-0.34661465,0.21909606,-0.01361023],[-0.39742768,0.13495042,-0.11115811,-0.06754978],[1.05146342,0.11500261,0.03162233,-0.01957935],[-0.40019148,0.63709189,0.16026661,0.05796074]],"struct":[[0.85595468,0.20154605,0.47337217,-0.05137673],[-0.03464216,-0.33202646,-0.0695166,0.94006691],[0.04382671,0.79336902,0.59575115,-0.11715538],[0.50827819,0.48972829,-0.6617396,0.25282443]],"fisher":[[-0.026731,8.251921,1.22575,13.400018],[-0.022981,8.314105,1.237323,12.334088],[-0.089735,8.155392,1.298121,13.473702],[0.114346,8.127901,1.193571,14.227402],[-0.102081,8.326454,1.409847,13.721616]],"fconst":[-60.491042,-58.862676,-60.583816,-65.602778,-65.536337],"univL":[0.83004979,0.98844323,0.94257861,0.91003985],"univF":[5.579356,0.318604,1.660055,2.693744],"boxM":49.32550285013485,"boxF":1.1170388162273046,"boxDf1":40.0,"boxDf2":11534.486445459612,"boxP":0.282013796333973,"logdets":[4.919526757822086,5.336286516695543,5.262370251673041,5.4008576607695655,3.8907706186075273],"pooledLogdet":5.507918237304126,"tab":[[22.0,4.0,5.0,4.0,0.0],[11.0,2.0,5.0,3.0,1.0],[11.0,2.0,7.0,4.0,1.0],[9.0,0.0,1.0,10.0,0.0],[6.0,0.0,4.0,1.0,1.0]],"post":[[0.44926795,0.285948511,0.157212639,0.088619425,0.018951475],[0.268225752,0.29917734,0.240110912,0.03114599,0.161340006],[0.32526683,0.244446586,0.226827293,0.105822118,0.097637172],[0.334539786,0.163070705,0.235788003,0.149914104,0.116687402],[0.234771813,0.176576513,0.243248365,0.071915093,0.273488215],[0.363613269,0.293763217,0.239732006,0.042346212,0.060545296],[0.339012195,0.325306446,0.202084105,0.068743571,0.064853683],[0.340119948,0.20425256,0.278903387,0.059816193,0.116907912]],"scores":[[0.1275445,-1.87222178,-0.63192636,-0.06493384],[-1.05450476,0.00551411,1.39511558,1.10173056],[-0.08879878,-0.07546769,0.60651458,-0.24024382],[0.17803119,0.46956789,-0.06994552,0.11062985],[-0.47180927,1.13104155,1.21983141,0.91208996],[-0.69659287,-0.86975193,0.07431047,0.01314741],[-0.3337371,-0.7982839,0.79321846,0.005643],[-0.54734357,0.12055366,-0.08443573,0.25739854]],"covW":[[56.41538159,-1.43070186,21.79983057,0.66407674],[-1.43070186,1.1480395,-2.66804575,0.04722892],[21.79983057,-2.66804575,35.74607649,-0.03321625],[0.66407674,0.04722892,-0.03321625,0.18150464]]},"weighted":{"eig":[0.38929913,0.08481625,0.02466166,2.139e-05],"cancorr":[0.52935112,0.27961562,0.15513897,0.00462436],"wilks":[0.6475276,0.89960953,0.97591103,0.99997862],"chi":[126.249517,30.733293,7.08351,0.006212],"df":[16,9,4,1],"sig":[0.0,0.00032888,0.13154038,0.93717713],"std":[[0.93959642,-0.51088384,0.42902579,-0.04966403],[-0.14790229,0.16237645,0.57482866,0.94286145],[-0.34606379,1.07122347,0.53930549,0.03681714],[0.4065819,0.56694797,-0.70897811,0.25614019]],"raw":[[0.12414,-0.06749826,0.05668313,-0.00656164],[-0.14778377,0.16224633,0.57436801,0.94210588],[-0.05744354,0.17781367,0.08951997,0.00611132],[1.02536821,1.42979906,-1.78798813,0.6459658]],"const":[-3.51298115,-7.32472169,-2.09840622,-8.11787579],"cent":[[0.01126471,-0.08159192,-0.02712175,-0.00688256],[-0.4979307,-0.39744978,0.14079258,0.00371679],[-0.47475806,0.16504199,-0.24529621,0.00335687],[1.14059739,0.02581262,0.01200423,0.00303904],[-0.45372643,0.68401915,0.28805236,-1.499e-05]],"struct":[[0.8642909,0.04604956,0.47415375,-0.16142766],[-0.10752748,-0.15192552,0.16666861,0.96828614],[0.1410458,0.73360415,0.51618236,-0.41891145],[0.5431197,0.46272521,-0.59577289,0.36872894]],"fisher":[[0.012787,9.485439,1.320473,15.505862],[-0.019657,9.615873,1.308655,14.238754],[-0.07663,9.481615,1.372778,15.756854],[0.147885,9.367788,1.278261,16.753863],[-0.078795,9.86587,1.511576,15.564653]],"fconst":[-68.693857,-65.638773,-68.953913,-74.624104,-74.905064],"univL":[0.77128901,0.99288703,0.94342704,0.87584701],"univF":[21.57262,0.521176,4.362482,10.312452],"boxM":150.30743191080091,"boxF":3.626397406854349,"boxDf1":40.0,"boxDf2":71967.43812092945,"boxP":8.176765480924422e-14,"logdets":[4.539526714908744,5.091845084699807,5.061284118814122,5.117458367473548,3.200415619219404],"pooledLogdet":5.266830782810379,"tab":[[44.0,21.0,8.0,15.0,0.0],[21.0,18.0,11.0,7.0,2.0],[26.0,11.0,14.0,8.0,1.0],[24.0,0.0,6.0,31.0,0.0],[13.0,3.0,7.0,3.0,2.0]],"post":[[0.362124006,0.371137002,0.167090843,0.079974135,0.019674014],[0.243886795,0.307232091,0.192233469,0.023946179,0.232701466],[0.358122509,0.242241895,0.193415871,0.106311443,0.099908281],[0.356785613,0.147995219,0.213246034,0.171824921,0.110148212],[0.25884682,0.14592043,0.188764157,0.070873712,0.335594881],[0.311285063,0.361575045,0.225483066,0.036017752,0.065639073],[0.332294805,0.358965827,0.174288722,0.059142003,0.075308644],[0.324502277,0.224023217,0.267324603,0.060745801,0.123404103]],"scores":[[-0.24460367,-1.77603177,-0.38151337,0.4563932],[-1.23495447,0.37783762,1.85867589,0.71153269],[-0.17936706,-0.05915759,0.66559663,-0.37595105],[0.20122347,0.5452113,0.06527498,0.07085644],[-0.42532231,1.39643835,1.54208687,0.3966004],[-0.92781427,-0.72103008,0.28520602,0.12171629],[-0.577457,-0.69858288,0.97642344,-0.05802477],[-0.60149391,0.29574082,0.13360239,0.24038943]],"covW":[[57.28741178,-1.34237154,21.34255833,0.44631351],[-1.34237154,1.00160465,-2.69033605,0.05120772],[21.34255833,-2.69033605,36.29358424,-0.10971926],[0.44631351,0.05120772,-0.10971926,0.15723036]],"cv":[[36.0,22.0,14.0,16.0,0.0],[28.0,8.0,14.0,7.0,2.0],[26.0,11.0,10.0,8.0,5.0],[24.0,0.0,6.0,31.0,0.0],[13.0,3.0,7.0,5.0,0.0]]},"gender":{"eig":[0.03262253,0.01395598],"cancorr":[0.17774117,0.1173196],"wilks":[0.95507902,0.98623611],"chi":[5.032752,1.517614],"df":[8,3],"sig":[0.75406992,0.67821103],"std":[[-0.27761519,-0.44872421],[0.78446562,-0.29833405],[0.40454009,0.93480819],[-0.66854456,-0.08340944]],"raw":[[-0.0340745,-0.05507643],[0.74079827,-0.28172726],[0.06663182,0.1539723],[-1.52199805,-0.18988862]],"const":[-1.47972172,0.31233775],"cent":[[-0.10792831,0.07505282],[0.18767385,-0.06559983],[-0.63775297,-0.57339612]],"struct":[[-0.40948418,0.00648535],[0.59724993,-0.62527819],[-0.0652367,0.85368672],[-0.66441316,-0.21981955]],"fisher":[[-0.080893,8.367699,1.259669,12.648296],[-0.083218,8.626306,1.257709,12.225098],[-0.027125,8.157892,1.124523,13.577821]],"fconst":[-59.702024,-60.194486,-59.479681],"univL":[0.99455912,0.98319416,0.98979552,0.98514848],"univF":[0.303621,0.948668,0.572188,0.836685],"boxM":7.746949623254068,"boxF":0.7429500623384202,"boxDf1":10.0,"boxDf2":46212.03091055197,"boxP":0.6843654752962146,"logdets":[5.783936425600437,5.344898724422818,null],"pooledLogdet":5.730748941431014,"tab":[[20.0,23.0,21.0],[12.0,22.0,13.0],[1.0,0.0,2.0]],"post":[[0.191277599,0.292300732,0.516421669],[0.329473215,0.639200653,0.031326132],[0.405485155,0.427398994,0.167115851],[0.413708152,0.34996091,0.236330938],[0.443656032,0.515844452,0.040499516],[0.326844023,0.472633784,0.200522193],[0.342207358,0.515070223,0.142722419],[0.395073833,0.429186152,0.175740015]],"scores":[[0.17618503,-1.61321441],[1.87565202,0.53239189],[0.23892807,0.33013237],[-0.22171149,0.19783147],[1.00378788,1.12735872],[0.70818482,-0.34890856],[0.83104774,-0.1133133],[0.36747878,0.13715035]],"covW":[[66.37851128,-1.44927097,22.65923583,0.99250131],[-1.44927097,1.12136735,-2.71278143,0.04394026],[22.65923583,-2.71278143,36.86037933,0.04626696],[0.99250131,0.04394026,0.04626696,0.19294455]],"cv":[[15.0,28.0,21.0],[14.0,20.0,13.0],[2.0,1.0,0.0]]},"job":{"eig":[0.00026896],"cancorr":[0.01639783],"wilks":[0.99973111],"chi":[0.030926],"df":[2],"sig":[0.98465575],"std":[[0.93802875],[0.17839794]],"raw":[[0.11383134],[0.40747806]],"const":[-3.78893962],"cent":[[0.01164436],[-0.0227065]],"struct":[[0.98508287],[0.42581179]],"fisher":[[0.155045,13.635479],[0.151135,13.621482]],"fconst":[-21.850882,-20.873621],"univL":[0.99973907,0.99995124],"univF":[0.030276,0.005657],"boxM":3.5423529485137237,"boxF":1.1551720499814837,"boxDf1":3.0,"boxDf2":158573.3984485976,"boxP":0.3252657150818389,"logdets":[2.328711487341481,2.729738902494071],"pooledLogdet":2.494077195440315,"tab":[[0.0,78.0],[0.0,40.0]],"post":[[0.296465828,0.703534172],[0.29707346,0.70292654],[0.300425132,0.699574868],[0.301450481,0.698549519],[0.301506731,0.698493269],[0.295154058,0.704845942],[0.298364104,0.701635896],[0.297196342,0.702803658]],"scores":[[-0.57892549],[-0.47758101],[0.06499717],[0.22798839],[0.23910901],[-0.79210273],[-0.2677686],[-0.46088811]],"covW":[[67.90606764,0.95158538],[0.95158538,0.19167753]],"cv":[[0.0,78.0],[0.0,40.0]]},"ungrouped":{"eig":[0.28255686,0.04203521,0.01114879],"cancorr":[0.46936923,0.20084704,0.1050041],"wilks":[0.7399901,0.94907938,0.98897414],"chi":[29.208491,5.069495,1.075448],"df":[12,6,2],"sig":[0.00366855,0.53493132,0.584076],"std":[[0.97143458,-0.6666686,0.12793289],[-0.01337963,-0.30992352,-0.20196143],[-0.32674316,0.59163345,0.71663085],[0.37200021,0.84495236,-0.44449917]],"raw":[[0.12756892,-0.08754701,0.01680016],[-0.0124464,-0.28830618,-0.1878745],[-0.05378064,0.09738054,0.11795461],[0.86261367,1.95932,-1.03072807]],"const":[-4.11323417,-3.51878115,1.17311055],"cent":[[-0.0866078,-0.01630506,-0.14191035],[-0.31106498,-0.31642658,0.09261452],[-0.42184429,0.27460011,0.07727148],[1.0210405,0.03335295,0.0498778]],"struct":[[0.87354715,-0.14798926,0.46021244],[-0.07244009,-0.33514029,-0.55848009],[0.16360661,0.36071647,0.87431378],[0.54810241,0.69123474,-0.45393117]],"fisher":[[0.051096,8.277304,1.151143,13.483544],[0.052677,8.322563,1.161652,12.460159],[-0.013455,8.156428,1.223355,13.538424],[0.191272,8.213169,1.119031,14.338631]],"fconst":[-60.99229,-58.826639,-60.495602,-66.007163],"univL":[0.82041409,0.99041143,0.97889971,0.90312489],"univF":[7.150624,0.316259,0.704134,3.504041],"boxM":39.97702315679817,"boxF":1.2279743779220649,"boxDf1":30.0,"boxDf2":19894.577349310563,"boxP":0.18211830048314143,"logdets":[4.919526757822086,5.336286516695543,5.262370251673041,5.4008576607695655],"pooledLogdet":5.594042156817656,"tab":[[7.0,14.0,6.0,8.0],[2.0,9.0,7.0,4.0],[3.0,8.0,9.0,5.0],[4.0,0.0,2.0,14.0]],"post":[[0.347515353,0.357101685,0.171204494,0.124178469],[0.240754573,0.412965993,0.298502759,0.047776675],[0.268515518,0.32040979,0.268447998,0.142626694],[0.282826607,0.216133182,0.275852728,0.225187483],[0.244734985,0.279178335,0.347707844,0.128378836],[0.289865583,0.379923418,0.271424416,0.058786583],[0.26953438,0.410476538,0.230685531,0.08930355],[0.14896301,0.141636792,0.167388793,0.542011405]],"scores":[[-0.15619793,-1.20900175,-1.24942804],[-0.98015843,-0.64609941,0.79786741],[-0.13874927,-0.26972468,0.59173908],[0.20380692,0.45634208,0.14187295],[-0.28008674,0.34894143,1.18070204],[-0.83278625,-0.64052623,-0.22430711],[-0.44992643,-0.97281426,0.34572509],[1.25582618,0.51009939,2.1416674]],"covW":[[57.98789891,-1.86514288,23.49419931,0.57373076],[-1.86514288,1.15558305,-2.67211211,0.03563302],[23.49419931,-2.67211211,36.91145243,-0.05944461],[0.57373076,0.03563302,-0.05944461,0.18597463]],"newPost":[[0.29289539,0.280823804,0.333207375,0.093073431],[0.217671158,0.256465527,0.398433953,0.127429361],[0.321864523,0.199675704,0.362570114,0.115889659],[0.180794203,0.221923319,0.584284539,0.012997939],[0.187467094,0.083174282,0.412805311,0.316553314],[0.247291273,0.260233866,0.285246503,0.207228357],[0.167188071,0.27605082,0.543438665,0.013322444],[0.254965069,0.193813438,0.127292231,0.423929262],[0.237949974,0.137647195,0.128119391,0.49628344],[0.219676746,0.384606554,0.364611692,0.031105008],[0.305346522,0.270086172,0.298486898,0.126080408],[0.293808548,0.266043192,0.275661836,0.164486424]],"newPred":[3,3,3,3,3,3,3,4,4,2,1,1],"newScores":[[-0.54962986,0.22763111,-0.02298661],[-0.28916862,0.73752444,1.67117964],[-0.42079093,0.9253263,-0.67046275],[-2.0426187,1.36596668,0.67998925],[0.49844895,2.72783033,1.27281343],[0.15657102,0.22297272,0.99878815],[-1.9997192,0.88390743,1.41835928],[0.99502791,-0.52799049,-0.32430743],[1.15366444,0.05420041,-0.43680453],[-1.33514041,-0.23737443,0.96450315],[-0.29748219,0.13271408,-0.12816411],[-0.05861578,0.06728725,0.10708781]]},"ungroupedRows":[7,10,14,30,38,46,53,67,68,87,93,114],"stepDefault":[[[0,0.8300497929323145,5.579355819406935]],[0]],"stepLow":[[[0,0.8300497929323145,5.579355819406935],[2,0.7545250120774358,2.7025864622662077],[3,0.714289076272759,1.5068287035711365]],[0,2,3]],"stepIris":[[[2,0.05862828094263205,1180.1611822529808],[1,0.036884110985632164,43.03545251448023],[3,0.024975538152184777,34.56868577422066],[0,0.023438630650877798,4.721152090425479]],[2,1,3,0]]} as const;

const STUDENTS = students as unknown as Dataset;
const SPECIES = ['setosa', 'versicolor', 'virginica'];

function irisDataset(): Dataset {
  const rows = IRIS_DATA.split(';').map((r) => r.split(' ').map(Number));
  const names = ['sl', 'sw', 'pl', 'pw'];
  return {
    name: 'iris',
    variables: [
      ...names.map((n) => makeVariable(n)),
      makeVariable('species', { measure: 'nominal', print: { type: 'F', w: 1, d: 0 }, write: { type: 'F', w: 1, d: 0 }, valueLabels: SPECIES.map((label, i) => ({ value: i + 1, label })) }),
    ],
    columns: [0, 1, 2, 3, 4].map((k) => rows.map((r) => r[k])),
    weight: null,
    filter: null,
    split: [],
  };
}

function withColumn(ds: Dataset, name: string, col: Cell[]): Dataset {
  return { ...ds, variables: [...ds.variables, makeVariable(name)], columns: [...ds.columns, col] };
}
const column = (ds: Dataset, name: string) => ds.columns[ds.variables.findIndex((v) => v.name === name)];

function run(syntax: string, ds: Dataset, lang: 'cs' | 'en' = 'en') {
  const r = runExtCommandFull('DISCRIMINANT', syntax, ctxFor(ds, lang));
  return { out: r.items, ds: r.dataset };
}
function table(out: OutputItem[], caption: string, nth = 0) {
  const t = tables(out).filter((x) => x.caption === caption)[nth];
  if (!t) throw new Error(`no table ${caption}`);
  return t;
}
/** Value cells of the row whose stub cells include every label in LABELS. */
function rowNums(out: OutputItem[], caption: string, labels: string[], nth = 0): (number | null)[] {
  const row = table(out, caption, nth).rows.find((r) => r.some((c) => !c.header) && labels.every((l) => r.some((c) => c.header && c.text === l)));
  if (!row) throw new Error(`no row ${labels.join('/')} in ${caption}`);
  return row.filter((c) => !c.header).map((c) => c.num);
}
const warnings = (out: OutputItem[]) => flatItems(out).flatMap((i) => (i.kind === 'message' && i.severity === 'warning' ? [i.text] : []));
const close = (a: number | null | undefined, b: number, tol: number) => expect(Math.abs((a ?? NaN) - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const T3 = 6e-4;

type R = (typeof REF)['iris'];
/** Checks the canonical-function tables (3 decimals) against a reference. */
function checkCanonical(out: OutputItem[], ref: R | (typeof REF)['faculty'] | (typeof REF)['job'], vars: string[], groups: string[], opts: { raw?: boolean; fisher?: boolean } = {}) {
  ref.eig.forEach((l, k) => {
    const r = rowNums(out, 'Eigenvalues', [String(k + 1)]);
    close(r[0], l, T3);
    close(r[3], ref.cancorr[k], T3);
  });
  ref.wilks.forEach((l, k) => {
    const label = k === ref.eig.length - 1 ? String(k + 1) : `${k + 1} through ${ref.eig.length}`;
    const r = rowNums(out, "Wilks' Lambda", [label], tables(out).filter((t) => t.caption === "Wilks' Lambda").length - 1);
    close(r[0], l, T3);
    close(r[1], ref.chi[k], 2e-3);
    expect(r[2]).toBe(ref.df[k]);
    close(r[3], ref.sig[k], T3);
  });
  vars.forEach((v, i) => {
    rowNums(out, 'Standardized Canonical Discriminant Function Coefficients', [v]).forEach((x, k) => close(x, ref.std[i][k], T3));
    rowNums(out, 'Structure Matrix', [v]).forEach((x, k) => close(x, ref.struct[i][k], T3));
    if (opts.raw) rowNums(out, 'Canonical Discriminant Function Coefficients', [v]).forEach((x, k) => close(x, ref.raw[i][k], T3));
    if (opts.fisher) rowNums(out, 'Classification Function Coefficients', [v]).forEach((x, j) => close(x, ref.fisher[j][i], T3));
  });
  if (opts.raw) rowNums(out, 'Canonical Discriminant Function Coefficients', ['(Constant)']).forEach((x, k) => close(x, ref.const[k], T3));
  if (opts.fisher) rowNums(out, 'Classification Function Coefficients', ['(Constant)']).forEach((x, j) => close(x, ref.fconst[j], T3));
  groups.forEach((g, j) => rowNums(out, 'Functions at Group Centroids', [g]).forEach((x, k) => close(x, ref.cent[j][k], T3)));
}
function checkClassTable(out: OutputItem[], kind: 'Original' | 'Cross-validated', groups: string[], tab: readonly (readonly number[])[]) {
  groups.forEach((g, j) => {
    const counts = rowNums(out, 'Classification Results', [kind, 'Count', g]);
    expect(counts.slice(0, groups.length)).toEqual(tab[j].map((x) => x));
    const tot = tab[j].reduce((a, b) => a + b, 0);
    rowNums(out, 'Classification Results', [kind, '%', g])
      .slice(0, groups.length)
      .forEach((x, k) => close(x, (100 * tab[j][k]) / tot, 0.051));
  });
}

describe('DISCRIMINANT on Fisher’s iris data', () => {
  const syntax = 'DISCRIMINANT /GROUPS=species(1,3) /VARIABLES=sl sw pl pw /STATISTICS=ALL /PLOT=COMBINED /SAVE=CLASS SCORES PROBS.';
  const { out, ds } = run(syntax, irisDataset());
  const ref = REF.iris;
  const vars = ['sl', 'sw', 'pl', 'pw'];

  it('reproduces SPSS’s published iris results and the scipy reference', () => {
    expect(errorsOf(out)).toEqual([]);
    expect(warnings(out)).toEqual([]);
    checkCanonical(out, ref, vars, SPECIES, { raw: true, fisher: true });
    // the values SPSS prints for these data
    expect(rowNums(out, 'Eigenvalues', ['1']).slice(0, 4)).toEqual([32.192, 99.1, 99.1, 0.985]);
    expect(rowNums(out, 'Canonical Discriminant Function Coefficients', ['(Constant)'])).toEqual([-2.105, -6.661]);
    expect(rowNums(out, 'Functions at Group Centroids', ['setosa'])).toEqual([-7.608, 0.215]);
  });

  it('univariate tests, pooled matrices, Box’s M and log determinants', () => {
    vars.forEach((v, i) => {
      const r = rowNums(out, 'Tests of Equality of Group Means', [v]);
      close(r[0], ref.univL[i], T3);
      close(r[1], ref.univF[i], 2e-3);
      expect(r.slice(2, 4)).toEqual([2, 147]);
      rowNums(out, 'Pooled Within-Groups Matrices', ['Covariance', v]).forEach((x, k) => close(x, ref.covW[i][k], T3));
    });
    expect(table(out, 'Pooled Within-Groups Matrices').footnotes).toEqual(['The covariance matrix has 147 degrees of freedom.']);
    close(rowNums(out, 'Test Results', ["Box's M"])[0], ref.boxM, T3);
    close(rowNums(out, 'Test Results', ['Approx.'])[0], ref.boxF, T3);
    expect(rowNums(out, 'Test Results', ['df1'])[0]).toBe(ref.boxDf1);
    close(rowNums(out, 'Test Results', ['df2'])[0], ref.boxDf2, T3);
    SPECIES.forEach((g, j) => {
      const r = rowNums(out, 'Log Determinants', [g]);
      expect(r[0]).toBe(4);
      close(r[1], ref.logdets[j]!, T3);
    });
    close(rowNums(out, 'Log Determinants', ['Pooled within-groups'])[1], ref.pooledLogdet, T3);
  });

  it('classification and leave-one-out tables match sklearn', () => {
    checkClassTable(out, 'Original', SPECIES, ref.tab);
    checkClassTable(out, 'Cross-validated', SPECIES, ref.cv);
    expect(table(out, 'Classification Results').footnotes).toEqual([
      '98.0% of original grouped cases correctly classified.',
      'Cross validation is done only for those cases in the analysis. In cross validation, each case is classified by the functions derived from all cases other than that case.',
      '98.0% of cross-validated grouped cases correctly classified.',
    ]);
    expect(rowNums(out, 'Prior Probabilities for Groups', ['setosa'])).toEqual([0.333, 50, 50]);
  });

  it('saves Dis_1, Dis1_1/Dis2_1 scores and Dis1_2… probabilities at full precision', () => {
    expect(ds!.variables.slice(5).map((v) => v.name)).toEqual(['Dis_1', 'Dis1_1', 'Dis2_1', 'Dis1_2', 'Dis2_2', 'Dis3_2']);
    expect(ds!.variables[5].valueLabels.map((l) => l.label)).toEqual(SPECIES);
    expect(ds!.variables[6].label).toBe('Discriminant Scores from Function 1 for Analysis 1');
    for (let i = 0; i < 8; i++) {
      [0, 1].forEach((k) => close(column(ds!, `Dis${k + 1}_1`)[i] as number, ref.scores[i][k], 1e-6));
      [0, 1, 2].forEach((j) => close(column(ds!, `Dis${j + 1}_2`)[i] as number, ref.post[i][j], 1e-7));
    }
    const pred = column(ds!, 'Dis_1');
    expect(pred.filter((x, i) => x !== Math.floor(i / 50) + 1).length).toBe(3);
  });

  it('combined-groups plot: function 1 × 2 scores by group with the centroids', () => {
    const chart = flatItems(out).find((i) => i.kind === 'chart')!;
    const spec = parseChart(chart);
    expect(spec.type).toBe('scatter');
    if (spec.type !== 'scatter') return;
    expect(spec.points.length).toBe(153);
    const cents = spec.points.filter((p) => p.group === 'Group Centroid');
    cents.forEach((c, j) => {
      close(c.x, ref.cent[j][0], 1e-9);
      close(c.y, ref.cent[j][1], 1e-9);
    });
    expect(spec.xlabel).toBe('Function 1');
  });

  it('structure matrix is ordered by function and absolute size, with SPSS footnotes', () => {
    const t = table(out, 'Structure Matrix');
    const order = t.rows.filter((r) => r.some((c) => !c.header)).map((r) => r[0].text);
    const best = vars.map((_, i) => (Math.abs(ref.struct[i][0]) >= Math.abs(ref.struct[i][1]) ? 0 : 1));
    const expected = vars
      .map((v, i) => ({ v, f: best[i], a: Math.abs(ref.struct[i][best[i]]) }))
      .sort((a, b) => a.f - b.f || b.a - a.a)
      .map((x) => x.v);
    expect(order).toEqual(expected);
    expect(t.footnotes[1]).toBe('Largest absolute correlation between each variable and any discriminant function');
  });

  it('stepwise (Wilks) enters petal length, sepal width, petal width, sepal length as the reference', () => {
    const o = run('DISCRIMINANT /GROUPS=species(1,3) /VARIABLES=sl sw pl pw /METHOD=WILKS.', irisDataset()).out;
    const steps = REF.stepIris[0];
    steps.forEach(([x, lam], s) => {
      const r = rowNums(o, 'Variables Entered/Removed', [String(s + 1)]);
      close(r[0], lam, T3);
      expect(table(o, 'Variables Entered/Removed').rows.find((row) => row[0].text === String(s + 1))![1].text).toBe(vars[x]);
    });
    checkCanonical(o, ref, vars, SPECIES);
  });
});

describe('DISCRIMINANT on the students sample', () => {
  const vars = ['Study hours per week', 'Average sleep (hours/night)', 'Perceived stress (0–40)', 'Grade point average'];
  const FAC = ['Science', 'Humanities', 'Economics', 'Medicine', 'Law'];
  const base = 'DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours sleep stress gpa';

  it('faculty, 4 functions: all tables match the reference; listwise missing values', () => {
    const { out } = run(`${base} /STATISTICS=MEAN STDDEV UNIVF BOXM RAW COEFF TABLE CROSSVALID.`, STUDENTS);
    expect(errorsOf(out)).toEqual([]);
    checkCanonical(out, REF.faculty, vars, FAC, { raw: true, fisher: true });
    checkClassTable(out, 'Original', FAC, REF.faculty.tab);
    checkClassTable(out, 'Cross-validated', FAC, REF.faculty.cv);
    close(rowNums(out, 'Test Results', ["Box's M"])[0], REF.faculty.boxM, T3);
    close(rowNums(out, 'Test Results', ['Sig.'])[0], REF.faculty.boxP, T3);
    expect(rowNums(out, 'Analysis Case Processing Summary', ['Valid'])).toEqual([114, 95]);
    expect(rowNums(out, 'Analysis Case Processing Summary', ['At least one missing discriminating variable'])).toEqual([6, 5]);
    expect(rowNums(out, 'Classification Processing Summary', ['Used in Output'])).toEqual([114]);
    expect(rowNums(out, 'Group Statistics', ['Law', 'Study hours per week'])).toEqual([22.175, 6.512, 12, 12]);
  });

  it('PRIORS=SIZE changes the classification constants and posteriors', () => {
    const { out, ds } = run(`${base} /PRIORS=SIZE /STATISTICS=COEFF /SAVE=PROBS.`, STUDENTS);
    rowNums(out, 'Classification Function Coefficients', ['(Constant)']).forEach((x, j) => close(x, REF.facultySize.fconst[j], T3));
    rowNums(out, 'Prior Probabilities for Groups', ['Science']).forEach((x, i) => expect(x).toBe([0.307, 35, 35][i]));
    const rows = REF.facultyRows;
    for (let i = 0; i < 8; i++) FAC.forEach((_, j) => close(column(ds!, `Dis${j + 1}_2`)[rows[i]] as number, REF.facultySize.post[i][j], 1e-7));
  });

  it('frequency weights (WEIGHT BY year) equal replicated cases', () => {
    const { out, ds } = run(`${base} /PRIORS=SIZE /STATISTICS=BOXM TABLE CROSSVALID /SAVE=PROBS.`, { ...STUDENTS, weight: 'year' });
    const ref = REF.weighted;
    checkCanonical(out, ref, vars, FAC);
    close(rowNums(out, 'Test Results', ["Box's M"])[0], ref.boxM, 2e-3);
    checkClassTable(out, 'Original', FAC, ref.tab);
    checkClassTable(out, 'Cross-validated', FAC, ref.cv);
    for (let i = 0; i < 8; i++) FAC.forEach((_, j) => close(column(ds!, `Dis${j + 1}_2`)[REF.facultyRows[i]] as number, ref.post[i][j], 1e-7));
  });

  it('a group with 3 cases (gender): singular group covariance left out of Box’s M', () => {
    const G = ['Female', 'Male', 'Other / prefer not to say'];
    const { out } = run('DISCRIMINANT /GROUPS=gender(1,3) /VARIABLES=hours sleep stress gpa /STATISTICS=BOXM TABLE CROSSVALID.', STUDENTS);
    checkCanonical(out, REF.gender, vars, G);
    const ld = rowNums(out, 'Log Determinants', [G[2]]);
    expect(ld).toEqual([2, null]);
    close(rowNums(out, 'Log Determinants', ['Female'])[1], REF.gender.logdets[0]!, T3);
    close(rowNums(out, 'Test Results', ["Box's M"])[0], REF.gender.boxM, T3);
    expect(rowNums(out, 'Test Results', ['df1'])[0]).toBe(10);
    expect(table(out, 'Test Results').footnotes[1]).toBe('Groups with singular covariance matrices are left out of the test.');
    checkClassTable(out, 'Original', G, REF.gender.tab);
    checkClassTable(out, 'Cross-validated', G, REF.gender.cv);
  });

  it('two groups (one function) with unequal priors; histograms per group', () => {
    const { out } = run('DISCRIMINANT /GROUPS=job(0,1) /VARIABLES=hours gpa /PRIORS=.3 .7 /STATISTICS=RAW COEFF TABLE CROSSVALID /PLOT=COMBINED.', STUDENTS);
    const ref = REF.job;
    checkCanonical(out, ref, ['Study hours per week', 'Grade point average'], ['No', 'Yes'], { raw: true, fisher: true });
    expect(tables(out).filter((t) => t.caption === "Wilks' Lambda")[0].rows.slice(1).map((r) => r[0].text)).toEqual(['1']);
    checkClassTable(out, 'Original', ['No', 'Yes'], ref.tab);
    checkClassTable(out, 'Cross-validated', ['No', 'Yes'], ref.cv);
    const charts = flatItems(out).filter((i) => i.kind === 'chart').map((c) => parseChart(c));
    expect(charts.map((c) => c.type)).toEqual(['histogram', 'histogram']);
    const n = charts.reduce((s, c) => s + (c.type === 'histogram' ? c.bins.reduce((a, b) => a + b[2], 0) : 0), 0);
    expect(n).toBe(118);
  });

  it('ungrouped cases (out of range) are classified and reported', () => {
    const { out, ds } = run('DISCRIMINANT /GROUPS=faculty(1,4) /VARIABLES=hours sleep stress gpa /STATISTICS=TABLE /SAVE=CLASS PROBS.', STUDENTS);
    const ref = REF.ungrouped;
    expect(rowNums(out, 'Analysis Case Processing Summary', ['Missing or out-of-range group codes'])[0]).toBe(13 - 1);
    const counts = [1, 2, 3, 4].map((g) => ref.newPred.filter((x) => x === g).length);
    expect(rowNums(out, 'Classification Results', ['Original', 'Count', 'Ungrouped cases']).slice(0, 5)).toEqual([...counts, ref.newPred.length]);
    REF.ungroupedRows.forEach((r, i) => {
      expect(column(ds!, 'Dis_1')[r]).toBe(ref.newPred[i]);
      [0, 1, 2, 3].forEach((j) => close(column(ds!, `Dis${j + 1}_2`)[r] as number, ref.newPost[i][j], 1e-7));
    });
    checkClassTable(out, 'Original', FAC.slice(0, 4), ref.tab);
  });

  it('stepwise with default FIN/FOUT enters hours only; with FIN=1 FOUT=.5 three variables', () => {
    const o1 = run(`${base} /METHOD=WILKS.`, STUDENTS).out;
    expect(table(o1, 'Variables Entered/Removed').rows.length).toBe(4);
    const [step] = REF.stepDefault[0];
    const r = rowNums(o1, 'Variables Entered/Removed', ['1']);
    close(r[0], step[1], T3);
    close(r[4], step[2], T3);
    expect(table(o1, 'Variables Entered/Removed').footnotes).toEqual([
      "At each step, the variable that minimizes the overall Wilks' Lambda is entered.",
      'Maximum number of steps is 8.',
      'Minimum partial F to enter is 3.84.',
      'Maximum partial F to remove is 2.71.',
    ]);
    expect(rowNums(o1, 'Eigenvalues', ['1'])[2]).toBe(100);
    expect(table(o1, 'Structure Matrix').footnotes[1]).toBe('This variable not used in the analysis.');
    const o2 = run(`${base} /METHOD=WILKS /FIN=1 /FOUT=.5.`, STUDENTS).out;
    REF.stepLow[0].forEach(([x, lam, F], s) => {
      const row = rowNums(o2, 'Variables Entered/Removed', [String(s + 1)]);
      close(row[0], lam, T3);
      const label = table(o2, 'Variables Entered/Removed').rows.find((rr) => rr[0].text === String(s + 1))![1].text;
      expect(label).toBe(vars[x]);
      // F to enter at the previous step
      close(rowNums(o2, 'Variables Not in the Analysis', [String(s), vars[x]])[2], F, T3);
    });
    expect(rowNums(o2, 'Variables in the Analysis', ['3', 'Study hours per week'])[0]).toBeGreaterThan(0.7);
    // approximate F for 3 variables and 5 groups
    expect(table(o2, 'Variables Entered/Removed').rows[1].some((c) => c.text === 'Approximate F')).toBe(true);
    const o3 = run(`${base} /METHOD=WILKS /PIN=.2 /POUT=.3.`, STUDENTS).out;
    expect(table(o3, 'Variables Entered/Removed').footnotes[2]).toBe('Maximum significance of F to enter is .20.');
  });

  it('a collinear predictor fails the tolerance test and is left out', () => {
    const h2 = column(STUDENTS, 'hours').map((x) => (x === null ? null : 2 * (x as number) + 1));
    const ds = withColumn(STUDENTS, 'h2', h2);
    const { out } = run('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours sleep stress gpa h2.', ds);
    expect(errorsOf(out)).toEqual([]);
    const t = table(out, 'Variables Failing Tolerance Test');
    expect(t.rows[1][0].text).toBe('h2');
    expect(t.rows[1][2].num).toBe(0);
    expect(t.footnotes).toEqual(['All variables passing the tolerance criteria are entered simultaneously.', 'Minimum tolerance level is .001.']);
    checkCanonical(out, REF.faculty, vars, FAC);
  });

  it('MEANSUB classifies cases with missing predictors', () => {
    const { out } = run(`${base} /CLASSIFY=NONMISSING POOLED MEANSUB /STATISTICS=TABLE.`, STUDENTS);
    expect(rowNums(out, 'Classification Processing Summary', ['Used in Output'])).toEqual([120]);
    expect(rowNums(out, 'Classification Results', ['Original', 'Count', 'Law'])[5]).toBe(13);
  });

  it('FILTER and SPLIT FILE equal runs on the subsets', () => {
    const sub = (job: number): Dataset => {
      const keep = (column(STUDENTS, 'job') as number[]).map((x, i) => (x === job ? i : -1)).filter((i) => i >= 0);
      return { ...STUDENTS, columns: STUDENTS.columns.map((c) => keep.map((i) => c[i])) };
    };
    const eig = (out: OutputItem[], nth = 0) => table(out, 'Eigenvalues', nth).rows.slice(1).map((r) => r[1].num);
    const s0 = run(`${base}.`, sub(0)).out;
    const s1 = run(`${base}.`, sub(1)).out;
    const isJob = withColumn(STUDENTS, 'isjob', column(STUDENTS, 'job'));
    expect(eig(run(`${base}.`, { ...isJob, filter: 'isjob' }).out)).toEqual(eig(s1));
    const sorted = sub(0);
    const both: Dataset = { ...STUDENTS, columns: STUDENTS.columns.map((c, k) => [...sorted.columns[k], ...sub(1).columns[k]]), split: ['job'] };
    const sp = run(`${base} /SAVE=CLASS.`, both);
    expect(eig(sp.out, 0)).toEqual(eig(s0));
    expect(eig(sp.out, 1)).toEqual(eig(s1));
    expect(flatItems(sp.out).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['Has a job = No', 'Has a job = Yes'].map((x) => x));
  });

  it('errors and warnings', () => {
    const err = (s: string) => errorsOf(run(s, STUDENTS).out);
    expect(err('DISCRIMINANT /GROUPS=faculty(5,9) /VARIABLES=hours.')[0]).toBe('DISCRIMINANT: At least two non-empty groups are needed.');
    expect(err('DISCRIMINANT /GROUPS=faculty(3,3) /VARIABLES=hours.')[0]).toMatch(/GROUPS needs a range/);
    expect(err('DISCRIMINANT /VARIABLES=hours.')[0]).toMatch(/GROUPS=variable/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours faculty.')[0]).toMatch(/cannot also be a discriminating/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours /METHOD=MAHAL.')[0]).toMatch(/METHOD=MAHAL is not available/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours /PRIORS=.5 .5.')[0]).toMatch(/2 values but there are 5/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours /FIN=2 /FOUT=3.')[0]).toMatch(/FOUT must be smaller/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours /BOGUS.')[0]).toMatch(/Unexpected/);
    expect(err('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=commute.')[0]).toMatch(/string variable/);
    const w = warnings(run('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours gpa /PLOT=MAP /PRIORS=5*1 /CLASSIFY=SEPARATE.', STUDENTS).out);
    expect(w).toEqual([
      'CLASSIFY=SEPARATE is not available; the pooled within-groups covariance matrix is used.',
      'The territorial map (PLOT=MAP) is not available.',
      'The prior probabilities do not sum to 1; they have been rescaled.',
    ]);
  });

  it('a second SAVE gets the next free SPSS names', () => {
    const first = run(`${base} /SAVE=CLASS SCORES PROBS.`, STUDENTS).ds!;
    const second = run(`${base} /SAVE=CLASS SCORES PROBS.`, first).ds!;
    expect(second.variables.slice(first.variables.length).map((v) => v.name)).toEqual(['Dis_2', 'Dis1_3', 'Dis2_3', 'Dis3_3', 'Dis4_3', 'Dis1_4', 'Dis2_4', 'Dis3_4', 'Dis4_4', 'Dis5_4']);
    const named = run(`${base} /SAVE=CLASS(pg) SCORES(sc) PROBS(pp).`, STUDENTS).ds!;
    expect(named.variables.slice(STUDENTS.variables.length).map((v) => v.name)).toEqual(['pg', 'sc1', 'sc2', 'sc3', 'sc4', 'pp1', 'pp2', 'pp3', 'pp4', 'pp5']);
    expect(errorsOf(run(`${base} /SAVE=CLASS(gpa).`, STUDENTS).out)[0]).toMatch(/gpa already exists/);
  });

  it('casewise statistics (PLOT=CASES)', () => {
    const { out } = run(`${base} /PLOT=CASES(5).`, STUDENTS);
    const t = table(out, 'Casewise Statistics');
    const body = t.rows.filter((r) => r.some((c) => !c.header));
    expect(body.length).toBe(5);
    const ref = REF.faculty;
    const first = body[0].filter((c) => !c.header);
    const best = ref.post[0].indexOf(Math.max(...ref.post[0]));
    expect(first[1].text).toBe(FAC[best]);
    close(first[4].num, ref.post[0][best], T3);
    ref.scores[0].forEach((s, k) => close(first[10 + k].num, s, T3));
  });

  it('Czech output with decimal comma', () => {
    const r = runExt(`${base} /STATISTICS=TABLE.`, STUDENTS, 'cs', ',');
    const caps = tables(r).map((t) => t.caption);
    expect(caps).toContain('Vlastní čísla');
    expect(caps).toContain('Strukturní matice');
    expect(caps).toContain('Výsledky klasifikace');
    const eig = tables(r).find((t) => t.caption === 'Vlastní čísla')!;
    expect(eig.rows[1][1].text).toBe(',268');
    expect(eig.rows[0][4].text).toBe('Kanonická korelace');
  });
});

describe.skipIf(!haveEngine)('DISCRIMINANT through the engine', () => {
  it('runs after PSPP transformations and the saved variables reach the engine', async () => {
    const r = await runMixed('COMPUTE h2 = hours / 10.\nDISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=h2 sleep stress gpa /SAVE=CLASS.\nFREQUENCIES Dis_1.', STUDENTS);
    expect(errorsOf(r.items)).toEqual([]);
    expect(r.dataset!.variables.some((v) => v.name === 'Dis_1')).toBe(true);
    expect(tables(r.items).some((t) => t.caption === 'Eigenvalues')).toBe(true);
  }, 60000);
});
