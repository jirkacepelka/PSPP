/*
 * DISCRIMINANT – linear discriminant analysis (SPSS syntax and output layout).
 *
 *   DISCRIMINANT /GROUPS=var(min,max) /VARIABLES=varlist
 *     [/ANALYSIS=varlist] [/METHOD={DIRECT**|WILKS}] [/TOLERANCE=.001]
 *     [/FIN=3.84 /FOUT=2.71 | /PIN=n /POUT=n] [/MAXSTEPS=n]
 *     [/PRIORS={EQUAL**|SIZE|value list (n*value allowed)}]
 *     [/STATISTICS=MEAN STDDEV UNIVF BOXM COEFF RAW CORR COV GCOV TCOV TABLE CROSSVALID ALL]
 *     [/CLASSIFY=NONMISSING POOLED MEANSUB] [/PLOT=COMBINED SEPARATE MAP CASES[(n)] ALL]
 *     [/SAVE=CLASS[(name)] SCORES[(root)] PROBS[(root)]] [/MISSING={EXCLUDE**|INCLUDE}]
 *
 * Computation (IBM SPSS Statistics Algorithms, "DISCRIMINANT"), with weighted group sizes n_j,
 * n = Σ n_j, g groups and the q variables in the analysis:
 *   W = within-groups SSCP, T = total SSCP, B = T − W; C = W/(n − g) (pooled covariance).
 *   Variables enter only with tolerance (1 − R² with the variables already entered, within
 *   groups) ≥ TOLERANCE; DIRECT tries them in the order listed, WILKS is the forward stepwise
 *   method with removal (F to enter/remove from the partial Wilks' lambda, or their p values
 *   with PIN/POUT), minimising the overall Wilks' lambda Λ = |W|/|T| at each step.
 *   Canonical functions: B v = λ W v, solved as eig(L⁻¹ B L⁻ᵀ) with W = L Lᵀ (Cholesky) and
 *   v = L⁻ᵀ e, so vᵀ W v = 1; m = min(g − 1, q) functions.
 *   Unstandardised coefficients u = √(n − g)·v (the scores have pooled within-groups variance 1),
 *   constant = −Σ u_i x̄_i (grand means); standardised d_i = u_i √c_ii.
 *   Sign convention: each function is oriented so that the sum of its standardised coefficients
 *   is positive (reproduces SPSS's published iris output; SPSS does not document its rule).
 *   Structure matrix: pooled within-groups correlations of the variables with the functions,
 *   r_ik = Σ_l c_il u_lk / √c_ii (also for variables not in the analysis).
 *   Wilks' lambda of functions k…m: Π_{i≥k} 1/(1 + λ_i), χ² = −(n − 1 − (q + g)/2) ln Λ,
 *   df = (q − k + 1)(g − k).
 *   Fisher classification functions: C⁻¹ x̄_j, constant ln π_j − ½ x̄_jᵀ C⁻¹ x̄_j.
 *   Posterior probabilities P(G = j | x) ∝ π_j exp(−D²_j / 2) with D²_j the squared distance to
 *   the group centroid in the space of all m functions (identical to the Mahalanobis distance
 *   with C for classification); P(D > d | G = j) = χ²_m tail of D²_j.
 *   Leave-one-out: every case is classified with the means and W of all other cases (the whole
 *   case, i.e. its full frequency weight, is left out; the priors and variables stay those of
 *   the full analysis).
 *   Box's M: M = (n' − g') ln|C'| − Σ (n_j − 1) ln|C_j| over the g' groups with non-singular
 *   covariance matrices (C' their pooled covariance), with Box's F approximation.
 * Groups: GROUPS values are truncated to integers; cases with a missing group value or one out
 * of range are left out of the analysis but classified ("Ungrouped cases"). Empty groups are
 * dropped. Missing values are excluded listwise over all VARIABLES; FILTER, frequency WEIGHT and
 * SPLIT FILE are honoured.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { caseCount, isMissing, requireNumeric, splitGroups, valueText, variable, varTitle, weights, type Cell as DataCell } from '../data';
import { chi2Sf, fSf } from '../dist';
import { cholesky, inverse, logDetSpd, matmul, symEigen, transpose, zeros, type Matrix } from '../linalg';
import { isKw, sub, varList, type ParsedCommand, type Token } from '../parse';
import { chartItem, fmt, fmtN, fmtP, groupItem, messageItem, tableItem, td, textItem, th, type Cell } from '../table';
import { ExtError, type ExtCommand, type ExtContext, type ExtResult } from '../types';

const NAME = 'DISCRIMINANT';
const P = 'ext.discrim';

/* ------------------------------------------------------------------ maths */

export interface GroupData {
  /** cases × p values */
  X: number[][];
  /** group index 0…G−1 of every case */
  g: number[];
  /** frequency weights */
  w: number[];
  G: number;
}

export interface Moments {
  p: number;
  G: number;
  n: number;
  /** weighted group sizes */
  nj: number[];
  /** unweighted group sizes */
  cj: number[];
  /** group means G × p, grand means */
  means: Matrix;
  grand: number[];
  W: Matrix;
  T: Matrix;
  /** per-group SSCP */
  Wj: Matrix[];
}

export function moments(d: GroupData): Moments {
  const p = d.X[0]?.length ?? 0;
  const G = d.G;
  const nj = new Array(G).fill(0);
  const cj = new Array(G).fill(0);
  const sums = zeros(G, p);
  d.X.forEach((x, i) => {
    const j = d.g[i];
    nj[j] += d.w[i];
    cj[j]++;
    for (let k = 0; k < p; k++) sums[j][k] += d.w[i] * x[k];
  });
  const n = nj.reduce((a, b) => a + b, 0);
  const means = sums.map((r, j) => r.map((s) => (nj[j] > 0 ? s / nj[j] : 0)));
  const grand = Array.from({ length: p }, (_, k) => sums.reduce((s, r) => s + r[k], 0) / n);
  const Wj = Array.from({ length: G }, () => zeros(p, p));
  const T = zeros(p, p);
  d.X.forEach((x, i) => {
    const j = d.g[i];
    const w = d.w[i];
    for (let a = 0; a < p; a++) {
      const da = x[a] - means[j][a];
      const ta = x[a] - grand[a];
      for (let b = 0; b <= a; b++) {
        Wj[j][a][b] += w * da * (x[b] - means[j][b]);
        T[a][b] += w * ta * (x[b] - grand[b]);
      }
    }
  });
  const W = zeros(p, p);
  for (const M of [...Wj, T]) for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) M[a][b] = M[b][a];
  for (const M of Wj) for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) W[a][b] += M[a][b];
  return { p, G, n, nj, cj, means, grand, W, T, Wj };
}

const subM = (M: Matrix, idx: number[]) => idx.map((i) => idx.map((j) => M[i][j]));

/** Within-groups tolerance of variable X given the set S (1 − R², 0 for a constant variable). */
export function tolerance(W: Matrix, x: number, S: number[]): number {
  if (!(W[x][x] > 0)) return 0;
  if (!S.length) return 1;
  const inv = inverse(subM(W, S), 1e-300);
  if (!inv) return 0;
  const v = S.map((s) => W[x][s]);
  let q = 0;
  for (let a = 0; a < S.length; a++) for (let b = 0; b < S.length; b++) q += v[a] * inv[a][b] * v[b];
  return Math.max(0, (W[x][x] - q) / W[x][x]);
}

/** Wilks' lambda |W_S| / |T_S| (1 for the empty set, null when singular). */
export function wilks(m: Moments, S: number[]): number | null {
  if (!S.length) return 1;
  const a = logDetSpd(subM(m.W, S));
  const b = logDetSpd(subM(m.T, S));
  return a === null || b === null ? null : Math.exp(a - b);
}

/**
 * F transformation of Wilks' lambda for q variables, g groups, n cases (Rao; exact when
 * q ≤ 2 or g ≤ 3).
 */
export function wilksF(lambda: number, q: number, g: number, n: number): { F: number; df1: number; df2: number; p: number; exact: boolean } {
  const a = q;
  const b = g - 1;
  const den = a * a + b * b - 5;
  const t = den > 0 ? Math.sqrt((a * a * b * b - 4) / den) : 1;
  const w = n - 1 - (a + g) / 2;
  const df1 = a * b;
  const df2 = w * t - (a * b - 2) / 2;
  const l = lambda ** (1 / t);
  const F = ((1 - l) / l) * (df2 / df1);
  return { F, df1, df2, p: fSf(F, df1, df2), exact: a <= 2 || b <= 2 };
}

export interface Criteria {
  method: 'DIRECT' | 'WILKS';
  tol: number;
  /** F to enter/remove, or (usePin) their probabilities */
  fin: number;
  fout: number;
  usePin: boolean;
  maxSteps: number | null;
}

export interface StepRecord {
  step: number;
  entered: number | null;
  removed: number | null;
  /** variables in the analysis after the step */
  S: number[];
  lambda: number;
}

/** Partial F of adding variable x to S (|S| = q), and the resulting lambda. */
function fEnter(m: Moments, S: number[], x: number): { F: number; lambda: number } | null {
  const l0 = wilks(m, S);
  const l1 = wilks(m, [...S, x]);
  if (l0 === null || l1 === null) return null;
  const q = S.length;
  const part = l1 / l0;
  return { F: ((m.n - m.G - q) / (m.G - 1)) * ((1 - part) / part), lambda: l1 };
}
/** Partial F of removing x from S, and the lambda of S without x. */
function fRemove(m: Moments, S: number[], x: number): { F: number; lambda: number } | null {
  const rest = S.filter((s) => s !== x);
  const l0 = wilks(m, rest);
  const l1 = wilks(m, S);
  if (l0 === null || l1 === null) return null;
  const q = S.length;
  const part = l1 / l0;
  return { F: ((m.n - m.G - q + 1) / (m.G - 1)) * ((1 - part) / part), lambda: rest.length ? l0 : NaN };
}

/** Minimum tolerance of all variables of S ∪ {x} after x enters, and x's own tolerance. */
function tolerances(m: Moments, S: number[], x: number): { tol: number; minTol: number } {
  const tol = tolerance(m.W, x, S);
  let minTol = tol;
  for (const s of S)
    minTol = Math.min(
      minTol,
      tolerance(
        m.W,
        s,
        [...S, x].filter((y) => y !== s),
      ),
    );
  return { tol, minTol };
}

export interface Selection {
  /** variables in the analysis (indices into the analysis list), in entry order */
  S: number[];
  /** DIRECT: variables failing the tolerance test with their tolerance */
  failed: { x: number; tol: number; minTol: number }[];
  steps: StepRecord[];
  /** WILKS: why stepping stopped */
  stoppedBy: 'criteria' | 'maxsteps';
}

/** Selects the variables of the analysis from CANDIDATES (indices). */
export function selectVariables(m: Moments, candidates: number[], c: Criteria): Selection {
  if (c.method === 'DIRECT') {
    const S: number[] = [];
    const failed: Selection['failed'] = [];
    for (const x of candidates) {
      const t = tolerances(m, S, x);
      if (t.tol < c.tol || t.minTol < c.tol) failed.push({ x, tol: t.tol, minTol: t.minTol });
      else S.push(x);
    }
    return { S, failed, steps: [], stoppedBy: 'criteria' };
  }
  const S: number[] = [];
  const steps: StepRecord[] = [];
  const maxSteps = c.maxSteps ?? 2 * candidates.length;
  const dfE = (q: number) => m.n - m.G - q;
  const enterOk = (F: number, q: number) => (c.usePin ? fSf(F, m.G - 1, dfE(q)) <= c.fin : F >= c.fin);
  const removeOk = (F: number, q: number) => (c.usePin ? fSf(F, m.G - 1, dfE(q - 1)) >= c.fout : F < c.fout);
  let stoppedBy: Selection['stoppedBy'] = 'criteria';
  for (;;) {
    if (steps.length >= maxSteps) {
      stoppedBy = 'maxsteps';
      break;
    }
    // removal first
    if (S.length > 1) {
      let worst: { x: number; F: number } | null = null;
      for (const x of S) {
        const r = fRemove(m, S, x);
        if (r && (!worst || r.F < worst.F)) worst = { x, F: r.F };
      }
      if (worst && removeOk(worst.F, S.length) && steps[steps.length - 1]?.entered !== worst.x) {
        S.splice(S.indexOf(worst.x), 1);
        steps.push({ step: steps.length + 1, entered: null, removed: worst.x, S: [...S], lambda: wilks(m, S) ?? NaN });
        continue;
      }
    }
    let best: { x: number; F: number; lambda: number } | null = null;
    for (const x of candidates) {
      if (S.includes(x)) continue;
      if (dfE(S.length) <= 0) break;
      const t = tolerances(m, S, x);
      if (t.tol < c.tol || t.minTol < c.tol) continue;
      const e = fEnter(m, S, x);
      if (e && Number.isFinite(e.F) && (!best || e.lambda < best.lambda)) best = { x, ...e };
    }
    if (!best || !enterOk(best.F, S.length) || steps[steps.length - 1]?.removed === best.x) break;
    S.push(best.x);
    steps.push({ step: steps.length + 1, entered: best.x, removed: null, S: [...S], lambda: best.lambda });
  }
  return { S, failed: [], steps, stoppedBy };
}

export interface Fit {
  m: Moments;
  S: number[];
  q: number;
  /** number of functions */
  nf: number;
  eigen: number[];
  /** q × nf unstandardised coefficients, nf constants */
  raw: Matrix;
  constants: number[];
  /** q × nf standardised coefficients */
  std: Matrix;
  /** G × nf */
  centroids: Matrix;
  /** pooled within covariance of S (q × q) and its inverse */
  C: Matrix;
  Cinv: Matrix;
  /** Fisher classification functions: G × q coefficients and G constants */
  fisher: Matrix;
  fisherConst: number[];
  priors: number[];
}

/** Canonical analysis of the variables S. Throws ExtError when W_S is singular. */
export function canonical(m: Moments, S: number[], priors: number[]): Fit {
  const q = S.length;
  const G = m.G;
  const dfW = m.n - G;
  const Ws = subM(m.W, S);
  const Bs = S.map((a) => S.map((b) => m.T[a][b] - m.W[a][b]));
  const L = cholesky(Ws);
  const Linv = L && inverse(L, 1e-300);
  if (!L || !Linv) throw new ExtError('singular');
  const A = matmul(matmul(Linv, Bs), transpose(Linv));
  const sym = A.map((r, i) => r.map((x, j) => (x + A[j][i]) / 2));
  const { values, vectors } = symEigen(sym);
  const nf = Math.min(G - 1, q);
  const V = matmul(transpose(Linv), vectors).map((r) => r.slice(0, nf));
  const sdW = S.map((s) => Math.sqrt(m.W[s][s] / dfW));
  // orientation: positive sum of the standardised coefficients
  for (let k = 0; k < nf; k++) {
    const sum = V.reduce((s, r, i) => s + r[k] * Math.sqrt(m.W[S[i]][S[i]]), 0);
    if (sum < 0) V.forEach((r) => (r[k] = -r[k]));
  }
  const raw = V.map((r) => r.map((x) => x * Math.sqrt(dfW)));
  const std = raw.map((r, i) => r.map((x) => x * sdW[i]));
  const constants = Array.from({ length: nf }, (_, k) => -S.reduce((s, v, i) => s + raw[i][k] * m.grand[v], 0));
  const centroids = m.means.map((mu) => Array.from({ length: nf }, (_, k) => constants[k] + S.reduce((s, v, i) => s + raw[i][k] * mu[v], 0)));
  const C = Ws.map((r) => r.map((x) => x / dfW));
  const Cinv = inverse(C, 1e-300)!;
  const fisher = m.means.map((mu) => Cinv.map((r) => r.reduce((s, x, j) => s + x * mu[S[j]], 0)));
  const fisherConst = fisher.map((f, j) => Math.log(priors[j]) - 0.5 * f.reduce((s, x, i) => s + x * m.means[j][S[i]], 0));
  return { m, S, q, nf, eigen: values.slice(0, nf).map((x) => Math.max(0, x)), raw, constants, std, centroids, C, Cinv, fisher, fisherConst, priors };
}

/** Discriminant scores of a case (x: values of the variables in S, in S order). */
export function scores(f: Fit, x: number[]): number[] {
  return f.constants.map((c, k) => c + x.reduce((s, v, i) => s + f.raw[i][k] * v, 0));
}

export interface Classification {
  group: number;
  post: number[];
  /** squared distances to the centroids in function space */
  d2: number[];
  scores: number[];
}

export function classify(f: Fit, x: number[]): Classification {
  const sc = scores(f, x);
  const d2 = f.centroids.map((c) => c.reduce((s, v, k) => s + (sc[k] - v) ** 2, 0));
  const lp = d2.map((d, j) => (f.priors[j] > 0 ? Math.log(f.priors[j]) - d / 2 : -Infinity));
  const mx = Math.max(...lp);
  const e = lp.map((v) => Math.exp(v - mx));
  const tot = e.reduce((a, b) => a + b, 0);
  const post = e.map((v) => v / tot);
  let group = 0;
  for (let j = 1; j < post.length; j++) if (post[j] > post[group] + 1e-12) group = j;
  return { group, post, d2, scores: sc };
}

/**
 * Leave-one-out classification of the analysis cases: each case is classified by the group
 * means and pooled covariance of all other cases (same variables and priors).
 */
export function leaveOneOut(f: Fit, d: GroupData): number[] {
  const { m, S } = f;
  const q = S.length;
  const Ws = subM(m.W, S);
  return d.X.map((row, i) => {
    const x = S.map((s) => row[s]);
    const j = d.g[i];
    const w = d.w[i];
    const nj = m.nj.slice();
    const means = m.means.map((mu) => S.map((s) => mu[s]));
    nj[j] -= w;
    let G = m.G;
    const W = Ws.map((r) => [...r]);
    if (nj[j] > 1e-12) {
      const dev = x.map((v, k) => v - means[j][k]);
      const c = (w * m.nj[j]) / nj[j];
      for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) W[a][b] -= c * dev[a] * dev[b];
      means[j] = means[j].map((mu, k) => (m.nj[j] * mu - w * x[k]) / nj[j]);
    } else G--;
    const df = m.n - w - G;
    const Cinv = df > 0 ? inverse(W.map((r) => r.map((v) => v / df)), 1e-300) : null;
    if (!Cinv) return -1;
    let best = -1;
    let bestV = -Infinity;
    for (let k = 0; k < m.G; k++) {
      if (nj[k] <= 1e-12 || !(f.priors[k] > 0)) continue;
      const dev = x.map((v, a) => v - means[k][a]);
      let d2 = 0;
      for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) d2 += dev[a] * Cinv[a][b] * dev[b];
      const v = Math.log(f.priors[k]) - d2 / 2;
      if (v > bestV + 1e-12) {
        bestV = v;
        best = k;
      }
    }
    return best;
  });
}

/** Box's M test of equal covariance matrices over the variables S. */
export function boxM(m: Moments, S: number[]): {
  rank: number[];
  logDet: (number | null)[];
  pooledRank: number;
  pooledLogDet: number | null;
  M: number | null;
  F: number | null;
  df1: number;
  df2: number | null;
  p: number | null;
  used: number;
} {
  const q = S.length;
  const covs = m.Wj.map((Wj, j) => (m.nj[j] > 1 ? subM(Wj, S).map((r) => r.map((x) => x / (m.nj[j] - 1))) : null));
  const rankOf = (A: Matrix | null) => {
    if (!A) return 0;
    const sd = A.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
    const R = A.map((r, i) => r.map((x, j) => (sd[i] > 0 && sd[j] > 0 ? x / (sd[i] * sd[j]) : 0)));
    return symEigen(R).values.filter((v) => v > 1e-8).length;
  };
  const rank = covs.map(rankOf);
  const logDet = covs.map((A, j) => (A && rank[j] === q ? logDetSpd(A) : null));
  const use = logDet.map((l, j) => (l !== null ? j : -1)).filter((j) => j >= 0);
  const pooled = subM(m.W, S).map((r) => r.map((x) => x / (m.n - m.G)));
  const pooledRank = rankOf(pooled);
  const pooledLogDet = pooledRank === q ? logDetSpd(pooled) : null;
  const g = use.length;
  const df1 = ((g - 1) * q * (q + 1)) / 2;
  if (g < 2) return { rank, logDet, pooledRank, pooledLogDet, M: null, F: null, df1, df2: null, p: null, used: g };
  const nU = use.reduce((s, j) => s + m.nj[j], 0);
  const Wu = zeros(q, q);
  for (const j of use) {
    const Wj = subM(m.Wj[j], S);
    for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) Wu[a][b] += Wj[a][b] / (nU - g);
  }
  const ld = logDetSpd(Wu);
  if (ld === null) return { rank, logDet, pooledRank, pooledLogDet, M: null, F: null, df1, df2: null, p: null, used: g };
  const M = (nU - g) * ld - use.reduce((s, j) => s + (m.nj[j] - 1) * logDet[j]!, 0);
  const s1 = use.reduce((s, j) => s + 1 / (m.nj[j] - 1), 0) - 1 / (nU - g);
  const s2 = use.reduce((s, j) => s + 1 / (m.nj[j] - 1) ** 2, 0) - 1 / (nU - g) ** 2;
  const c1 = (s1 * (2 * q * q + 3 * q - 1)) / (6 * (q + 1) * (g - 1));
  const c2 = (s2 * (q - 1) * (q + 2)) / (6 * (g - 1));
  let F: number;
  let df2: number;
  if (c2 > c1 * c1) {
    df2 = (df1 + 2) / (c2 - c1 * c1);
    const b = df1 / (1 - c1 - df1 / df2);
    F = M / b;
  } else {
    df2 = (df1 + 2) / (c1 * c1 - c2);
    const b = df2 / (1 - c1 + 2 / df2);
    F = (df2 * M) / (df1 * (b - M));
  }
  return { rank, logDet, pooledRank, pooledLogDet, M, F, df1, df2, p: fSf(F, df1, df2), used: g };
}

/* ---------------------------------------------------------------- parsing */

const STATS = ['MEAN', 'STDDEV', 'UNIVF', 'BOXM', 'COEFF', 'RAW', 'CORR', 'COV', 'GCOV', 'TCOV', 'TABLE', 'CROSSVALID'] as const;
type Stat = (typeof STATS)[number];

interface Options {
  group: string;
  lo: number;
  hi: number;
  vars: string[];
  analysis: string[];
  crit: Criteria;
  priors: 'EQUAL' | 'SIZE' | number[];
  stats: Set<Stat>;
  meansub: boolean;
  separate: boolean;
  plotCombined: boolean;
  plotSeparate: boolean;
  plotMap: boolean;
  plotCases: number | null;
  saveClass: string | true | null;
  saveScores: string | true | null;
  saveProbs: string | true | null;
  includeUser: boolean;
  warnings: string[];
}

function kwMatch(t: Token | undefined, list: readonly string[]): string | null {
  if (!t || t.kind !== 'id') return null;
  const u = t.text.toUpperCase();
  if (list.includes(u)) return u;
  if (u.length < 3) return null;
  const hits = list.filter((k) => k.startsWith(u));
  return hits.length === 1 ? hits[0] : null;
}

function oneNumber(tokens: Token[] | null, what: string, ctx: ExtContext): number | null {
  if (!tokens) return null;
  const t = tokens.find((x) => x.kind === 'num');
  if (!t || tokens.filter((x) => x.kind !== 'punct').length !== 1) throw new ExtError(ctx.t(`${P}.badNumber`, { what }));
  return t.value!;
}

function parse(cmd: ParsedCommand, ds: Dataset, ctx: ExtContext): Options {
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const unexpected = (tok: string) => new ExtError(t('unexpected', { token: tok }));
  if (cmd.head.length) throw unexpected(cmd.head[0].text);
  for (const s of cmd.subs)
    if (!sub({ ...cmd, subs: [s] }, 'GROUPS', 'VARIABLES', 'ANALYSIS', 'METHOD', 'TOLERANCE', 'FIN', 'FOUT', 'PIN', 'POUT', 'VIN', 'MAXSTEPS', 'FUNCTIONS', 'PRIORS', 'STATISTICS', 'CLASSIFY', 'PLOT', 'SAVE', 'MISSING', 'HISTORY', 'ROTATE', 'SELECT', 'MATRIX'))
      throw unexpected(`/${s.name}`);
  if (sub(cmd, 'MATRIX')) throw new ExtError(t('noMatrix'));
  if (sub(cmd, 'SELECT')) throw new ExtError(t('noSelect'));
  const warnings: string[] = [];

  const gt = sub(cmd, 'GROUPS');
  if (!gt || gt[0]?.kind !== 'id') throw new ExtError(t('noGroups'));
  const gv = variable(ds, gt[0].text).v;
  requireNumeric(gv);
  const nums = gt.slice(1).filter((x) => x.kind === 'num').map((x) => x.value!);
  if (gt[1]?.text !== '(' || nums.length !== 2 || !(nums[0] < nums[1])) throw new ExtError(t('badRange'));

  const vt = sub(cmd, 'VARIABLES');
  if (!vt) throw new ExtError(t('noVars'));
  const { names, next } = varList(vt, 0, ds.variables);
  if (next < vt.length) throw unexpected(vt[next].text);
  const vars = [...new Set(names)];
  if (!vars.length) throw new ExtError(t('noVars'));
  for (const v of vars) {
    requireNumeric(variable(ds, v).v);
    if (v.toUpperCase() === gv.name.toUpperCase()) throw new ExtError(t('groupInVars', { name: gv.name }));
  }

  let analysis = vars;
  const at = sub(cmd, 'ANALYSIS');
  if (at) {
    const rest: string[] = [];
    let levels = false;
    for (let i = 0; i < at.length; ) {
      if (at[i].text === '(') {
        levels = true;
        while (i < at.length && at[i].text !== ')') i++;
        i++;
        continue;
      }
      if (isKw(at[i], 'ALL')) {
        rest.push(...vars);
        i++;
        continue;
      }
      const r = varList(at, i, ds.variables);
      if (r.next === i) throw unexpected(at[i].text);
      rest.push(...r.names);
      i = r.next;
    }
    const bad = rest.find((n) => !vars.some((v) => v.toUpperCase() === n.toUpperCase()));
    if (bad) throw new ExtError(t('notInVariables', { name: bad }));
    analysis = vars.filter((v) => rest.some((n) => n.toUpperCase() === v.toUpperCase()));
    if (levels) warnings.push(t('levelsIgnored'));
  }

  const crit: Criteria = { method: 'DIRECT', tol: 0.001, fin: 3.84, fout: 2.71, usePin: false, maxSteps: null };
  const mt = sub(cmd, 'METHOD');
  if (mt) {
    const k = kwMatch(mt[0], ['DIRECT', 'WILKS', 'MAHAL', 'MAXMINF', 'MINRESID', 'RAO']);
    if (k === 'DIRECT' || k === 'WILKS') crit.method = k;
    else if (k) throw new ExtError(t('methodUnsupported', { method: k }));
    else throw unexpected(mt[0]?.text ?? '');
  }
  const tol = oneNumber(sub(cmd, 'TOLERANCE'), 'TOLERANCE', ctx);
  if (tol !== null) {
    if (!(tol > 0 && tol < 1)) throw new ExtError(t('badNumber', { what: 'TOLERANCE' }));
    crit.tol = tol;
  }
  const fin = oneNumber(sub(cmd, 'FIN'), 'FIN', ctx);
  const fout = oneNumber(sub(cmd, 'FOUT'), 'FOUT', ctx);
  const pin = oneNumber(sub(cmd, 'PIN'), 'PIN', ctx);
  const pout = oneNumber(sub(cmd, 'POUT'), 'POUT', ctx);
  if ((pin !== null || pout !== null) && (fin !== null || fout !== null)) throw new ExtError(t('finAndPin'));
  if (pin !== null || pout !== null) {
    crit.usePin = true;
    crit.fin = pin ?? 0.05;
    crit.fout = pout ?? 0.1;
    if (!(crit.fin > 0 && crit.fin < crit.fout && crit.fout <= 1)) throw new ExtError(t('badPin'));
  } else {
    crit.fin = fin ?? 3.84;
    crit.fout = fout ?? 2.71;
    if (!(crit.fout >= 0 && crit.fout < crit.fin)) throw new ExtError(t('badFin'));
  }
  const ms = oneNumber(sub(cmd, 'MAXSTEPS'), 'MAXSTEPS', ctx);
  if (ms !== null) {
    if (!(Number.isInteger(ms) && ms >= 1)) throw new ExtError(t('badNumber', { what: 'MAXSTEPS' }));
    crit.maxSteps = ms;
  }
  if (sub(cmd, 'VIN')) warnings.push(t('ignored', { sub: 'VIN' }));
  if (sub(cmd, 'FUNCTIONS')) warnings.push(t('ignored', { sub: 'FUNCTIONS' }));
  if (sub(cmd, 'ROTATE')) warnings.push(t('ignored', { sub: 'ROTATE' }));

  let priors: Options['priors'] = 'EQUAL';
  const pt = sub(cmd, 'PRIORS');
  if (pt) {
    const k = kwMatch(pt[0], ['EQUAL', 'SIZE']);
    if (k) {
      if (pt.length > 1) throw unexpected(pt[1].text);
      priors = k as 'EQUAL' | 'SIZE';
    } else {
      const vals: number[] = [];
      for (let i = 0; i < pt.length; i++) {
        const x = pt[i];
        if (x.text === ',') continue;
        if (x.kind !== 'num') throw unexpected(x.text);
        if (pt[i + 1]?.text === '*' && pt[i + 2]?.kind === 'num') {
          if (!(Number.isInteger(x.value!) && x.value! > 0)) throw new ExtError(t('badPriors'));
          for (let r = 0; r < x.value!; r++) vals.push(pt[i + 2].value!);
          i += 2;
        } else vals.push(x.value!);
      }
      if (!vals.length || vals.some((v) => !(v >= 0))) throw new ExtError(t('badPriors'));
      priors = vals;
    }
  }

  const stats = new Set<Stat>();
  const st = sub(cmd, 'STATISTICS');
  if (st)
    for (const x of st) {
      if (x.kind === 'punct') continue;
      const k = kwMatch(x, [...STATS, 'ALL', 'TCOV', 'FPAIR']);
      if (k === 'ALL') STATS.forEach((s) => stats.add(s));
      else if (k === 'FPAIR') warnings.push(t('ignored', { sub: 'STATISTICS=FPAIR' }));
      else if (k) stats.add(k as Stat);
      else throw unexpected(x.text);
    }

  let meansub = false;
  let separate = false;
  const ct = sub(cmd, 'CLASSIFY');
  if (ct)
    for (const x of ct) {
      if (x.kind === 'punct') continue;
      const k = kwMatch(x, ['NONMISSING', 'UNSELECTED', 'UNCLASSIFIED', 'POOLED', 'SEPARATE', 'MEANSUB']);
      if (k === 'MEANSUB') meansub = true;
      else if (k === 'SEPARATE') separate = true;
      else if (k === 'UNCLASSIFIED' || k === 'UNSELECTED') warnings.push(t('ignored', { sub: `CLASSIFY=${k}` }));
      else if (!k) throw unexpected(x.text);
    }

  let plotCombined = false;
  let plotSeparate = false;
  let plotMap = false;
  let plotCases: number | null = null;
  const pl = sub(cmd, 'PLOT');
  if (pl)
    for (let i = 0; i < pl.length; i++) {
      const x = pl[i];
      if (x.kind === 'punct') continue;
      const k = kwMatch(x, ['COMBINED', 'SEPARATE', 'MAP', 'CASES', 'ALL']);
      if (k === 'COMBINED') plotCombined = true;
      else if (k === 'SEPARATE') plotSeparate = true;
      else if (k === 'MAP') plotMap = true;
      else if (k === 'ALL') plotCombined = plotSeparate = plotMap = true;
      else if (k === 'CASES') {
        plotCases = Infinity;
        if (pl[i + 1]?.text === '(') {
          const n = pl[i + 2];
          if (n?.kind !== 'num' || !(n.value! >= 1) || pl[i + 3]?.text !== ')') throw new ExtError(t('badNumber', { what: 'CASES' }));
          plotCases = Math.floor(n.value!);
          i += 3;
        }
      } else throw unexpected(x.text);
    }

  let saveClass: Options['saveClass'] = null;
  let saveScores: Options['saveScores'] = null;
  let saveProbs: Options['saveProbs'] = null;
  const sv = sub(cmd, 'SAVE');
  if (sv)
    for (let i = 0; i < sv.length; i++) {
      const x = sv[i];
      if (x.kind === 'punct') continue;
      const k = kwMatch(x, ['CLASS', 'SCORES', 'PROBS']);
      if (!k) throw unexpected(x.text);
      let name: string | true = true;
      if (sv[i + 1]?.text === '(') {
        if (sv[i + 2]?.kind !== 'id' || sv[i + 3]?.text !== ')') throw unexpected(sv[i + 2]?.text ?? '(');
        name = sv[i + 2].text;
        i += 3;
      }
      if (k === 'CLASS') saveClass = name;
      else if (k === 'SCORES') saveScores = name;
      else saveProbs = name;
    }

  let includeUser = false;
  const mi = sub(cmd, 'MISSING');
  if (mi)
    for (const x of mi) {
      const k = kwMatch(x, ['EXCLUDE', 'INCLUDE']);
      if (k) includeUser = k === 'INCLUDE';
      else if (x.kind !== 'punct') throw unexpected(x.text);
    }

  return {
    group: gv.name,
    lo: nums[0],
    hi: nums[1],
    vars,
    analysis,
    crit,
    priors,
    stats,
    meansub,
    separate,
    plotCombined,
    plotSeparate,
    plotMap,
    plotCases,
    saveClass,
    saveScores,
    saveProbs,
    includeUser,
    warnings,
  };
}

/* ----------------------------------------------------------------- output */

const pct1 = (x: number, n: number, ctx: ExtContext) => (n > 0 ? fmt((100 * x) / n, 1, ctx) : '');

interface Saved {
  cls: (number | null)[];
  sc: (number | null)[][];
  pr: Map<number, (number | null)[]>;
  nf: number;
  groups: number[];
}

function run(cmd: ParsedCommand, ctx: ExtContext): ExtResult {
  const ds = ctx.dataset;
  const o = parse(cmd, ds, ctx);
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const items: OutputItem[] = [];
  const warn = (text: string) => items.push(messageItem('warning', text, ctx.line));
  o.warnings.forEach(warn);
  if (o.separate) warn(t('separateIgnored'));
  if (o.plotMap) warn(t('noMap'));

  const gcol = variable(ds, o.group);
  const vcols = o.vars.map((v) => variable(ds, v));
  const aIdx = o.analysis.map((a) => o.vars.findIndex((v) => v === a));
  const W8 = weights(ds);
  const N = caseCount(ds);
  const saved: Saved = { cls: new Array(N).fill(null), sc: [], pr: new Map(), nf: 0, groups: [] };
  const children: OutputItem[] = [];

  for (const split of splitGroups(ds)) {
    if (split.label) children.push(textItem(split.label));
    try {
      analyse(split.rows);
    } catch (e) {
      if (!(e instanceof ExtError)) throw e;
      children.push(messageItem('error', `${NAME}: ${e.message}`, ctx.line));
    }
  }

  function analyse(rows: number[]) {
    const grpOf = (r: number): number | null => {
      const x = gcol.col[r] as DataCell;
      if (isMissing(gcol.v, x, o.includeUser) || typeof x !== 'number') return null;
      const v = Math.trunc(x);
      return v >= o.lo && v <= o.hi ? v : null;
    };
    const missVar = (r: number) => vcols.some((c) => isMissing(c.v, c.col[r] as DataCell, o.includeUser));
    let nBadGroup = 0;
    let nMissVar = 0;
    let nBoth = 0;
    const valid: number[] = [];
    for (const r of rows) {
      const bg = grpOf(r) === null;
      const mv = missVar(r);
      if (bg && mv) nBoth++;
      else if (bg) nBadGroup++;
      else if (mv) nMissVar++;
      else valid.push(r);
    }
    const total = rows.length;
    const excl = nBadGroup + nMissVar + nBoth;
    children.push(
      tableItem(
        {
          caption: t('caseSummary'),
          head: [[th(t('unweightedCases'), { colspan: 2 }), th('N'), th(t('percent'))]],
          body: [
            [th(t('valid'), { colspan: 2 }), td(String(valid.length)), td(pct1(valid.length, total, ctx))],
            [th(t('excluded'), { rowspan: 4 }), th(t('exclGroup')), td(String(nBadGroup)), td(pct1(nBadGroup, total, ctx))],
            [th(t('exclVar')), td(String(nMissVar)), td(pct1(nMissVar, total, ctx))],
            [th(t('exclBoth')), td(String(nBoth)), td(pct1(nBoth, total, ctx))],
            [th(t('total')), td(String(excl)), td(pct1(excl, total, ctx))],
            [th(t('total'), { colspan: 2 }), td(String(total)), td(pct1(total, total, ctx))],
          ],
        },
        NAME,
      ),
    );
    const codes = [...new Set(valid.map((r) => grpOf(r)!))].sort((a, b) => a - b);
    const G = codes.length;
    if (G < 2) throw new ExtError(t('tooFewGroups'));
    const p = o.vars.length;
    const data: GroupData = {
      X: valid.map((r) => vcols.map((c) => c.col[r] as number)),
      g: valid.map((r) => codes.indexOf(grpOf(r)!)),
      w: valid.map((r) => W8[r]),
      G,
    };
    const m = moments(data);
    if (!(m.n - G > 0)) throw new ExtError(t('tooFewCases'));
    const gLabel = (j: number) => valueText(gcol.v, codes[j]);
    const vTitle = (k: number) => varTitle(vcols[k].v);
    const dfW = m.n - G;
    const dec = (k: number) => Math.min(6, (vcols[k].v.print?.d ?? 2) + 2);

    // Group Statistics
    {
      const showMean = o.stats.has('MEAN');
      const showSd = o.stats.has('STDDEV');
      const head: Cell[][] = [
        [
          th(varTitle(gcol.v), { rowspan: 2 }),
          th('', { rowspan: 2 }),
          ...(showMean ? [th(t('mean'), { rowspan: 2 })] : []),
          ...(showSd ? [th(t('stddev'), { rowspan: 2 })] : []),
          th(t('validN'), { colspan: 2 }),
        ],
        [th(t('unweighted')), th(t('weighted'))],
      ];
      const body: Cell[][] = [];
      const block = (label: string, mean: (k: number) => number, sd: (k: number) => number, cnt: number, wsum: number) =>
        o.vars.forEach((_, k) =>
          body.push([
            ...(k === 0 ? [th(label, { rowspan: p })] : []),
            th(vTitle(k)),
            ...(showMean ? [td(fmt(mean(k), dec(k), ctx))] : []),
            ...(showSd ? [td(fmt(sd(k), dec(k), ctx))] : []),
            td(String(cnt)),
            td(fmt(wsum, 3, ctx)),
          ]),
        );
      for (let j = 0; j < G; j++) block(gLabel(j), (k) => m.means[j][k], (k) => (m.nj[j] > 1 ? Math.sqrt(m.Wj[j][k][k] / (m.nj[j] - 1)) : NaN), m.cj[j], m.nj[j]);
      block(t('total'), (k) => m.grand[k], (k) => (m.n > 1 ? Math.sqrt(m.T[k][k] / (m.n - 1)) : NaN), valid.length, m.n);
      children.push(tableItem({ caption: t('groupStats'), head, body }, NAME));
    }

    if (o.stats.has('UNIVF')) {
      children.push(
        tableItem(
          {
            caption: t('univf'),
            head: [[th(''), th(t('wilksLambda')), th('F'), th('df1'), th('df2'), th(t('sig'))]],
            body: o.vars.map((_, k) => {
              const w = m.W[k][k];
              const tt = m.T[k][k];
              const lam = tt > 0 ? w / tt : NaN;
              const F = w > 0 ? ((tt - w) / (G - 1)) / (w / dfW) : NaN;
              return [th(vTitle(k)), td(fmt(lam, 3, ctx)), td(fmt(F, 3, ctx)), td(String(G - 1)), td(fmtN(dfW, ctx)), td(fmtP(Number.isFinite(F) ? fSf(F, G - 1, dfW) : NaN, ctx))];
            }),
          },
          NAME,
        ),
      );
    }

    const all = o.vars.map((_, k) => k);
    const matrixBlock = (M: (a: number, b: number) => number, label: string, idx: number[], body: Cell[][]) =>
      idx.forEach((a, i) => body.push([...(i === 0 ? [th(label, { rowspan: idx.length })] : []), th(vTitle(a)), ...idx.map((b) => td(fmt(M(a, b), 3, ctx)))]));
    if (o.stats.has('COV') || o.stats.has('CORR')) {
      const body: Cell[][] = [];
      if (o.stats.has('COV')) matrixBlock((a, b) => m.W[a][b] / dfW, t('covariance'), all, body);
      if (o.stats.has('CORR')) matrixBlock((a, b) => (m.W[a][a] > 0 && m.W[b][b] > 0 ? m.W[a][b] / Math.sqrt(m.W[a][a] * m.W[b][b]) : NaN), t('correlation'), all, body);
      children.push(
        tableItem(
          {
            caption: t('pooledMatrices'),
            head: [[th('', { colspan: 2 }), ...all.map((k) => th(vTitle(k)))]],
            body,
            footnotes: o.stats.has('COV') ? [t('covDf', { df: fmtN(dfW, ctx) })] : [],
          },
          NAME,
        ),
      );
    }
    if (o.stats.has('GCOV') || o.stats.has('TCOV')) {
      const body: Cell[][] = [];
      if (o.stats.has('GCOV')) for (let j = 0; j < G; j++) matrixBlock((a, b) => (m.nj[j] > 1 ? m.Wj[j][a][b] / (m.nj[j] - 1) : NaN), gLabel(j), all, body);
      if (o.stats.has('TCOV')) matrixBlock((a, b) => m.T[a][b] / (m.n - 1), t('total'), all, body);
      children.push(
        tableItem(
          {
            caption: t('covMatrices'),
            head: [[th(varTitle(gcol.v)), th(''), ...all.map((k) => th(vTitle(k)))]],
            body,
            footnotes: o.stats.has('TCOV') ? [t('tcovDf', { df: fmtN(m.n - 1, ctx) })] : [],
          },
          NAME,
        ),
      );
    }

    // variable selection
    const sel = selectVariables(m, aIdx, o.crit);
    if (o.crit.method === 'WILKS') stepwiseTables(m, sel);
    if (sel.failed.length) {
      children.push(
        tableItem(
          {
            caption: t('failingTol'),
            head: [[th(''), th(t('withinVar')), th(t('tolerance')), th(t('minTolerance'))]],
            body: sel.failed.map((f) => [th(vTitle(f.x)), td(fmt(m.W[f.x][f.x] / dfW, 3, ctx)), td(fmt(f.tol, 3, ctx)), td(fmt(f.minTol, 3, ctx))]),
            footnotes: [t('allPassing'), t('minTolLevel', { tol: fmt(o.crit.tol, 3, ctx) })],
          },
          NAME,
        ),
      );
    }
    if (!sel.S.length) throw new ExtError(t('noVarsEntered'));
    const S = sel.S.slice().sort((a, b) => a - b);
    const q = S.length;

    if (o.stats.has('BOXM')) {
      const bm = boxM(m, S);
      const caption = t('logDets');
      children.push(
        tableItem(
          {
            caption,
            head: [[th(varTitle(gcol.v)), th(t('rank')), th(t('logDet'))]],
            body: [
              ...codes.map((_, j) => [th(gLabel(j)), td(String(bm.rank[j])), td(fmt(bm.logDet[j], 3, ctx))]),
              [th(t('pooledWithin')), td(String(bm.pooledRank)), td(fmt(bm.pooledLogDet, 3, ctx))],
            ],
            footnotes: [t('logDetNote')],
          },
          NAME,
        ),
      );
      if (bm.M !== null) {
        children.push(
          tableItem(
            {
              caption: t('testResults'),
              head: [],
              body: [
                [th(t('boxM'), { colspan: 2 }), td(fmt(bm.M, 3, ctx))],
                [th('F', { rowspan: 4 }), th(t('approx')), td(fmt(bm.F, 3, ctx))],
                [th('df1'), td(fmtN(bm.df1, ctx))],
                [th('df2'), td(fmt(bm.df2, 3, ctx))],
                [th(t('sig')), td(fmtP(bm.p, ctx))],
              ],
              footnotes: [t('boxNote'), ...(bm.used < G ? [t('boxSingular')] : [])],
            },
            NAME,
          ),
        );
      } else children.push(messageItem('warning', t('boxImpossible'), ctx.line));
    }

    // priors
    let priors: number[];
    if (o.priors === 'EQUAL') priors = codes.map(() => 1 / G);
    else if (o.priors === 'SIZE') priors = m.nj.map((x) => x / m.n);
    else {
      if (o.priors.length !== G) throw new ExtError(t('priorsCount', { n: o.priors.length, g: G }));
      const s = o.priors.reduce((a, b) => a + b, 0);
      if (!(s > 0)) throw new ExtError(t('badPriors'));
      if (Math.abs(s - 1) > 1e-6) children.push(messageItem('warning', t('priorsScaled'), ctx.line));
      priors = o.priors.map((x) => x / s);
    }

    let fit: Fit;
    try {
      fit = canonical(m, S, priors);
    } catch {
      throw new ExtError(t('singular'));
    }
    const nf = fit.nf;
    const fnHead = (label = '') => [[th(label, { rowspan: 2 }), th(t('function'), { colspan: nf })], Array.from({ length: nf }, (_, k) => th(String(k + 1)))];

    // Summary of canonical discriminant functions
    const eigSum = fit.eigen.reduce((a, b) => a + b, 0);
    let cum = 0;
    children.push(
      tableItem(
        {
          caption: t('eigenvalues'),
          head: [[th(t('function')), th(t('eigenvalue')), th(t('pctVariance')), th(t('cumPct')), th(t('canCorr'))]],
          body: fit.eigen.map((l, k) => {
            const pc = eigSum > 0 ? (100 * l) / eigSum : 0;
            cum += pc;
            return [th(String(k + 1), { sup: 'a' }), td(fmt(l, 3, ctx)), td(fmt(pc, 1, ctx)), td(fmt(cum, 1, ctx)), td(fmt(Math.sqrt(l / (1 + l)), 3, ctx))];
          }),
          footnotes: [t('firstUsed', { n: nf })],
        },
        NAME,
      ),
    );
    const chiFactor = m.n - 1 - (q + G) / 2;
    children.push(
      tableItem(
        {
          caption: t('wilksLambda'),
          head: [[th(t('testOfFunctions')), th(t('wilksLambda')), th(t('chiSquare')), th('df'), th(t('sig'))]],
          body: fit.eigen.map((_, k) => {
            const lam = fit.eigen.slice(k).reduce((s, l) => s / (1 + l), 1);
            const chi = -chiFactor * Math.log(lam);
            const df = (q - k) * (G - 1 - k);
            return [th(k === nf - 1 ? String(k + 1) : t('through', { a: k + 1, b: nf })), td(fmt(lam, 3, ctx)), td(fmt(chi, 3, ctx)), td(String(df)), td(fmtP(chi2Sf(chi, df), ctx))];
          }),
        },
        NAME,
      ),
    );
    children.push(
      tableItem(
        {
          caption: t('stdCoef'),
          head: fnHead(),
          body: S.map((v, i) => [th(vTitle(v)), ...fit.std[i].map((x) => td(fmt(x, 3, ctx)))]),
        },
        NAME,
      ),
    );

    // Structure matrix (all variables, unused ones flagged)
    {
      const Sset = new Set(S);
      const C = (a: number, b: number) => m.W[a][b] / dfW;
      const r = all.map((a) => Array.from({ length: nf }, (_, k) => (C(a, a) > 0 ? S.reduce((s, v, i) => s + C(a, v) * fit.raw[i][k], 0) / Math.sqrt(C(a, a)) : NaN)));
      const best = r.map((row) => row.reduce((bi, x, k) => (Math.abs(x) > Math.abs(row[bi]) ? k : bi), 0));
      const order = all.slice().sort((a, b) => best[a] - best[b] || Math.abs(r[b][best[b]]) - Math.abs(r[a][best[a]]) || a - b);
      const anyUnused = all.some((a) => !Sset.has(a));
      children.push(
        tableItem(
          {
            caption: t('structure'),
            head: fnHead(),
            body: order.map((a) => [th(vTitle(a), Sset.has(a) ? {} : { sup: 'b' }), ...r[a].map((x, k) => td(fmt(x, 3, ctx), k === best[a] ? { sup: '*' } : {}))]),
            footnotes: [
              t('structureNote'),
              ...(anyUnused ? [t('notUsed')] : []),
              { mark: '*', text: t('largestCorr') },
            ],
          },
          NAME,
        ),
      );
    }
    if (o.stats.has('RAW')) {
      children.push(
        tableItem(
          {
            caption: t('rawCoef'),
            head: fnHead(),
            body: [...S.map((v, i) => [th(vTitle(v)), ...fit.raw[i].map((x) => td(fmt(x, 3, ctx)))]), [th(t('constant')), ...fit.constants.map((x) => td(fmt(x, 3, ctx)))]],
            footnotes: [t('unstandardized')],
          },
          NAME,
        ),
      );
    }
    children.push(
      tableItem(
        {
          caption: t('centroids'),
          head: fnHead(varTitle(gcol.v)),
          body: codes.map((_, j) => [th(gLabel(j)), ...fit.centroids[j].map((x) => td(fmt(x, 3, ctx)))]),
          footnotes: [t('centroidsNote')],
        },
        NAME,
      ),
    );

    // Classification
    const caseX = (r: number): number[] | null => {
      const x: number[] = [];
      for (const v of S) {
        const c = vcols[v];
        const val = c.col[r] as DataCell;
        if (isMissing(c.v, val, o.includeUser)) {
          if (!o.meansub) return null;
          x.push(m.grand[v]);
        } else x.push(val as number);
      }
      return x;
    };
    const classified: { r: number; actual: number | null; c: Classification }[] = [];
    let nExclMiss = 0;
    for (const r of rows) {
      const x = caseX(r);
      if (!x) {
        nExclMiss++;
        continue;
      }
      const gr = grpOf(r);
      const actual = gr === null ? null : codes.indexOf(gr);
      classified.push({ r, actual: actual !== null && actual >= 0 ? actual : null, c: classify(fit, x) });
    }
    children.push(
      tableItem(
        {
          caption: t('classSummary'),
          head: [],
          body: [
            [th(t('processed'), { colspan: 2 }), td(String(rows.length))],
            [th(t('excluded'), { rowspan: 2 }), th(t('exclGroup')), td('0')],
            [th(t('exclVarAny')), td(String(nExclMiss))],
            [th(t('usedInOutput'), { colspan: 2 }), td(String(classified.length))],
          ],
        },
        NAME,
      ),
    );
    children.push(
      tableItem(
        {
          caption: t('priorsTable'),
          head: [
            [th(varTitle(gcol.v), { rowspan: 2 }), th(t('prior'), { rowspan: 2 }), th(t('casesUsed'), { colspan: 2 })],
            [th(t('unweighted')), th(t('weighted'))],
          ],
          body: [
            ...codes.map((_, j) => [th(gLabel(j)), td(fmt(priors[j], 3, ctx)), td(String(m.cj[j])), td(fmt(m.nj[j], 3, ctx))]),
            [th(t('total')), td(fmt(1, 3, ctx)), td(String(valid.length)), td(fmt(m.n, 3, ctx))],
          ],
        },
        NAME,
      ),
    );
    if (o.stats.has('COEFF')) {
      children.push(
        tableItem(
          {
            caption: t('classFun'),
            head: [[th('', { rowspan: 2 }), th(varTitle(gcol.v), { colspan: G })], codes.map((_, j) => th(gLabel(j)))],
            body: [...S.map((v, i) => [th(vTitle(v)), ...codes.map((_, j) => td(fmt(fit.fisher[j][i], 3, ctx)))]), [th(t('constant')), ...fit.fisherConst.map((x) => td(fmt(x, 3, ctx)))]],
            footnotes: [t('fisher')],
          },
          NAME,
        ),
      );
    }

    // Casewise statistics
    if (o.plotCases !== null) {
      const chiTail = (d2: number) => chi2Sf(d2, nf);
      const body: Cell[][] = classified.slice(0, o.plotCases).map(({ r, actual, c }, i) => {
        const ord = c.post.map((_, j) => j).sort((a, b) => c.post[b] - c.post[a] || a - b);
        const [h, s] = ord;
        const mis = actual !== null && actual !== c.group;
        return [
          ...(i === 0 ? [th(t('original'), { rowspan: Math.min(classified.length, o.plotCases!) })] : []),
          th(String(r + 1)),
          td(actual === null ? t('ungrouped') : gLabel(actual)),
          td(gLabel(h), mis ? { sup: '**' } : {}),
          td(fmtP(chiTail(c.d2[h]), ctx)),
          td(String(nf)),
          td(fmt(c.post[h], 3, ctx)),
          td(fmt(c.d2[h], 3, ctx)),
          td(s === undefined ? '' : gLabel(s)),
          td(s === undefined ? '' : fmt(c.post[s], 3, ctx)),
          td(s === undefined ? '' : fmt(c.d2[s], 3, ctx)),
          ...c.scores.map((x) => td(fmt(x, 3, ctx))),
        ];
      });
      children.push(
        tableItem(
          {
            caption: t('casewise'),
            head: [
              [th('', { rowspan: 3 }), th(t('caseNumber'), { rowspan: 3 }), th(t('actualGroup'), { rowspan: 3 }), th(t('highestGroup'), { colspan: 5 }), th(t('secondGroup'), { colspan: 3 }), th(t('discScores'), { rowspan: 2, colspan: nf })],
              [th(t('predictedGroup'), { rowspan: 2 }), th('P(D>d | G=g)', { colspan: 2 }), th('P(G=g | D=d)', { rowspan: 2 }), th(t('mahal'), { rowspan: 2 }), th(t('group'), { rowspan: 2 }), th('P(G=g | D=d)', { rowspan: 2 }), th(t('mahal'), { rowspan: 2 })],
              [th('p'), th('df'), ...Array.from({ length: nf }, (_, k) => th(t('functionN', { n: k + 1 })))],
            ],
            body,
            footnotes: [{ mark: '**', text: t('misclassified') }],
          },
          NAME,
        ),
      );
    }

    // Classification results
    if (o.stats.has('TABLE') || o.stats.has('CROSSVALID')) {
      const tab = zeros(G, G);
      const ung = new Array(G).fill(0);
      let nUng = 0;
      for (const { r, actual, c } of classified) {
        if (actual === null) {
          ung[c.group] += W8[r];
          nUng += W8[r];
        } else tab[actual][c.group] += W8[r];
      }
      const cv = o.stats.has('CROSSVALID') ? leaveOneOut(fit, data) : null;
      const cvTab = zeros(G, G);
      if (cv) cv.forEach((k, i) => k >= 0 && (cvTab[data.g[i]][k] += data.w[i]));
      const body: Cell[][] = [];
      const block = (label: string, T: Matrix, ungrouped: boolean, sup?: string) => {
        const rowsN = (G + (ungrouped ? 1 : 0)) * 2;
        const rt = T.map((row) => row.reduce((a, b) => a + b, 0));
        const lines: [string, number[], number][] = T.map((row, j) => [gLabel(j), row, rt[j]]);
        if (ungrouped) lines.push([t('ungroupedCases'), ung, nUng]);
        ['count', 'pctRow'].forEach((kind, ki) =>
          lines.forEach(([lab, row, tot], li) =>
            body.push([
              ...(ki === 0 && li === 0 ? [th(label, { rowspan: rowsN, sup })] : []),
              ...(li === 0 ? [th(t(kind), { rowspan: lines.length })] : []),
              th(lab),
              ...row.map((x) => td(kind === 'count' ? fmtN(round(x), ctx) : pct1(x, tot, ctx))),
              td(kind === 'count' ? fmtN(round(tot), ctx) : pct1(tot, tot, ctx)),
            ]),
          ),
        );
      };
      const correct = (T: Matrix) => {
        const tot = T.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
        return tot > 0 ? fmt((100 * T.reduce((s, r, j) => s + r[j], 0)) / tot, 1, ctx) : '';
      };
      block(t('original'), tab, nUng > 0);
      if (cv) block(t('crossValidated'), cvTab, false, 'b');
      children.push(
        tableItem(
          {
            caption: t('classResults'),
            head: [
              [th('', { rowspan: 2, colspan: 2 }), th(varTitle(gcol.v), { rowspan: 2 }), th(t('predicted'), { colspan: G }), th(t('total'), { rowspan: 2 })],
              codes.map((_, j) => th(gLabel(j))),
            ],
            body,
            footnotes: [
              t('pctCorrect', { pct: correct(tab) }),
              ...(cv ? [t('cvNote'), { mark: 'c', text: t('pctCorrectCv', { pct: correct(cvTab) }) }] : []),
            ],
          },
          NAME,
        ),
      );
    }

    // Plots
    const fnLabel = (k: number) => t('functionN', { n: k + 1 });
    if ((o.plotCombined || o.plotSeparate) && nf === 1) {
      const sc = classified.filter((x) => x.actual !== null);
      const vals = sc.map((x) => x.c.scores[0]);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const nb = Math.max(5, Math.min(30, Math.ceil(Math.log2(Math.max(vals.length, 2)) + 1) * 2));
      const wd = hi > lo ? (hi - lo) / nb : 1;
      for (let j = 0; j < G; j++) {
        const mine = sc.filter((x) => x.actual === j);
        if (!mine.length) continue;
        const bins: [number, number, number][] = Array.from({ length: nb }, (_, b) => [lo + b * wd, lo + (b + 1) * wd, 0]);
        let sw = 0;
        let s1 = 0;
        let s2 = 0;
        for (const x of mine) {
          const v = x.c.scores[0];
          const w = W8[x.r];
          bins[Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / wd)))][2] += w;
          sw += w;
          s1 += w * v;
          s2 += w * v * v;
        }
        const mean = s1 / sw;
        const sd = sw > 1 ? Math.sqrt(Math.max(0, (s2 - sw * mean * mean) / (sw - 1))) : null;
        const title = `${fnLabel(0)}: ${varTitle(gcol.v)} = ${gLabel(j)}`;
        children.push(chartItem(title, { type: 'histogram', title, n: sw, mean, stddev: sd, showNormal: false, bins }));
      }
    } else if (nf >= 2 && (o.plotCombined || o.plotSeparate)) {
      const centroidLabel = t('groupCentroid');
      const point = (x: (typeof classified)[number]) => [x.c.scores[0], x.c.scores[1], x.actual === null ? t('ungroupedCases') : gLabel(x.actual)];
      const spec = (title: string, pts: unknown[]) => ({ type: 'scatter', title, xlabel: fnLabel(0), ylabel: fnLabel(1), xMin: null, xMax: null, yMin: null, yMax: null, byvar: varTitle(gcol.v), points: pts });
      const cents = (js: number[]) => js.map((j) => [fit.centroids[j][0], fit.centroids[j][1], centroidLabel]);
      if (o.plotCombined) {
        const title = t('combinedPlot');
        children.push(chartItem(title, spec(title, [...classified.map(point), ...cents(codes.map((_, j) => j))])));
      }
      if (o.plotSeparate)
        for (let j = 0; j < G; j++) {
          const title = `${t('canonicalFns')}: ${varTitle(gcol.v)} = ${gLabel(j)}`;
          children.push(chartItem(title, spec(title, [...classified.filter((x) => x.actual === j).map(point), ...cents([j])])));
        }
    }

    // Save
    if (o.saveClass || o.saveScores || o.saveProbs) {
      saved.nf = Math.max(saved.nf, nf);
      saved.groups = [...new Set([...saved.groups, ...codes])].sort((a, b) => a - b);
      for (const { r, c } of classified) {
        saved.cls[r] = codes[c.group];
        c.scores.forEach((s, k) => {
          (saved.sc[k] ??= new Array(N).fill(null))[r] = s;
        });
        codes.forEach((code, j) => {
          if (!saved.pr.has(code)) saved.pr.set(code, new Array(N).fill(null));
          saved.pr.get(code)![r] = c.post[j];
        });
      }
    }
  }

  function stepwiseTables(m: Moments, sel: Selection) {
    const G = m.G;
    const dfW = m.n - G;
    const vTitle = (k: number) => varTitle(vcols[k].v);
    const anyRemoved = sel.steps.some((s) => s.removed !== null);
    const fs = sel.steps.map((s) => wilksF(s.lambda, s.S.length, G, m.n));
    const anyApprox = fs.some((f) => !f.exact);
    const anyExact = fs.some((f) => f.exact);
    const fHead = (exact: boolean) => th(t(exact ? 'exactF' : 'approxF'), { colspan: 4 });
    const fCells = (f: ReturnType<typeof wilksF>, exact: boolean) =>
      f.exact === exact ? [td(fmt(f.F, 3, ctx)), td(fmtN(f.df1, ctx)), td(fmt(f.df2, 3, ctx).replace(/[.,]000$/, '')), td(fmtP(f.p, ctx))] : [td(''), td(''), td(''), td('')];
    const groupsF = [...(anyExact ? [true] : []), ...(anyApprox ? [false] : [])];
    const sub3 = groupsF.flatMap(() => [th(t('statistic')), th('df1'), th('df2'), th(t('sig'))]);
    if (sel.steps.length) {
      children.push(
        tableItem(
          {
            caption: t('enteredRemoved'),
            head: [
              [th(t('step'), { rowspan: 3 }), th(t('entered'), { rowspan: 3 }), ...(anyRemoved ? [th(t('removed'), { rowspan: 3 })] : []), th(t('wilksLambda'), { colspan: 4 + 4 * groupsF.length })],
              [th(t('statistic'), { rowspan: 2 }), th('df1', { rowspan: 2 }), th('df2', { rowspan: 2 }), th('df3', { rowspan: 2 }), ...groupsF.map(fHead)],
              sub3,
            ],
            body: sel.steps.map((s, i) => [
              th(String(s.step)),
              td(s.entered !== null ? vTitle(s.entered) : ''),
              ...(anyRemoved ? [td(s.removed !== null ? vTitle(s.removed) : '')] : []),
              td(fmt(s.lambda, 3, ctx)),
              td(String(s.S.length)),
              td(String(G - 1)),
              td(fmtN(dfW, ctx)),
              ...groupsF.flatMap((e) => fCells(fs[i], e)),
            ]),
            footnotes: [
              t('stepNote'),
              t('maxSteps', { n: o.crit.maxSteps ?? 2 * aIdx.length }),
              o.crit.usePin ? t('maxSigEnter', { v: fmt(o.crit.fin, 2, ctx) }) : t('minFEnter', { v: fmt(o.crit.fin, 2, ctx) }),
              o.crit.usePin ? t('minSigRemove', { v: fmt(o.crit.fout, 2, ctx) }) : t('maxFRemove', { v: fmt(o.crit.fout, 2, ctx) }),
            ],
          },
          NAME,
        ),
      );
    }
    // Variables in the Analysis
    const inBody: Cell[][] = [];
    sel.steps.forEach((s) => {
      s.S.forEach((x, i) => {
        const r = fRemove(m, s.S, x);
        inBody.push([
          ...(i === 0 ? [th(String(s.step), { rowspan: s.S.length })] : []),
          th(vTitle(x)),
          td(fmt(tolerance(m.W, x, s.S.filter((y) => y !== x)), 3, ctx)),
          td(fmt(r?.F, 3, ctx)),
          td(s.S.length > 1 ? fmt(r?.lambda, 3, ctx) : ''),
        ]);
      });
    });
    if (inBody.length)
      children.push(tableItem({ caption: t('varsIn'), head: [[th(t('step')), th(''), th(t('tolerance')), th(t('fToRemove')), th(t('wilksLambda'))]], body: inBody }, NAME));
    // Variables Not in the Analysis
    const notBody: Cell[][] = [];
    const states = [{ step: 0, S: [] as number[] }, ...sel.steps.map((s) => ({ step: s.step, S: s.S }))];
    for (const st of states) {
      const out = aIdx.filter((x) => !st.S.includes(x));
      out.forEach((x, i) => {
        const tl = tolerances(m, st.S, x);
        const e = fEnter(m, st.S, x);
        notBody.push([
          ...(i === 0 ? [th(String(st.step), { rowspan: out.length })] : []),
          th(vTitle(x)),
          td(fmt(tl.tol, 3, ctx)),
          td(fmt(tl.minTol, 3, ctx)),
          td(fmt(e?.F, 3, ctx)),
          td(fmt(e?.lambda, 3, ctx)),
        ]);
      });
    }
    if (notBody.length)
      children.push(
        tableItem({ caption: t('varsNotIn'), head: [[th(t('step')), th(''), th(t('tolerance')), th(t('minTolerance')), th(t('fToEnter')), th(t('wilksLambda'))]], body: notBody }, NAME),
      );
    // Wilks' Lambda by step
    if (sel.steps.length)
      children.push(
        tableItem(
          {
            caption: t('wilksLambda'),
            head: [
              [th(t('step'), { rowspan: 2 }), th(t('nVars'), { rowspan: 2 }), th(t('lambda'), { rowspan: 2 }), th('df1', { rowspan: 2 }), th('df2', { rowspan: 2 }), th('df3', { rowspan: 2 }), ...groupsF.map(fHead)],
              sub3,
            ],
            body: sel.steps.map((s, i) => [
              th(String(s.step)),
              td(String(s.S.length)),
              td(fmt(s.lambda, 3, ctx)),
              td(String(s.S.length)),
              td(String(G - 1)),
              td(fmtN(dfW, ctx)),
              ...groupsF.flatMap((e) => fCells(fs[i], e)),
            ]),
          },
          NAME,
        ),
      );
  }

  items.push(groupItem(t('title'), NAME, children));
  if (!o.saveClass && !o.saveScores && !o.saveProbs) return items;
  if (!saved.groups.length) return items;

  // new variables (SPSS names: Dis_m class, Dis<k>_m scores and Dis<k>_<m+1> probabilities)
  const has = (n: string, extra: string[] = []) => ds.variables.some((v) => v.name.toUpperCase() === n.toUpperCase()) || extra.some((x) => x.toUpperCase() === n.toUpperCase());
  const vars: Variable[] = [...ds.variables];
  const columns = [...ds.columns];
  const taken: string[] = [];
  const add = (name: string, label: string, col: (number | null)[], init: Partial<Variable> = {}) => {
    if (has(name, taken)) throw new ExtError(t('varExists', { name }));
    taken.push(name);
    vars.push(makeVariable(name, { label, ...init }));
    columns.push(col);
  };
  let analysisNo = 1;
  if (o.saveClass) {
    let name = typeof o.saveClass === 'string' ? o.saveClass : '';
    if (!name) {
      for (analysisNo = 1; has(`Dis_${analysisNo}`); ) analysisNo++;
      name = `Dis_${analysisNo}`;
    }
    add(name, t('labelClass', { n: analysisNo }), saved.cls, {
      print: { ...gcol.v.print },
      write: { ...gcol.v.write },
      valueLabels: gcol.v.valueLabels.map((x) => ({ ...x })),
      measure: 'nominal',
    });
  }
  let k0 = 1;
  if ((o.saveScores === true || o.saveProbs === true) && (o.saveScores || o.saveProbs)) {
    const nScores = o.saveScores === true ? saved.nf : 0;
    const nProbs = o.saveProbs === true ? saved.groups.length : 0;
    const free = (mm: number) =>
      Array.from({ length: nScores }, (_, k) => `Dis${k + 1}_${mm}`).every((n) => !has(n, taken)) && Array.from({ length: nProbs }, (_, k) => `Dis${k + 1}_${mm + 1}`).every((n) => !has(n, taken));
    while (!free(k0)) k0++;
  }
  if (o.saveScores) {
    for (let k = 0; k < saved.nf; k++) {
      const name = o.saveScores === true ? `Dis${k + 1}_${k0}` : `${o.saveScores}${k + 1}`;
      add(name, t('labelScore', { k: k + 1, n: analysisNo }), saved.sc[k] ?? new Array(N).fill(null), { print: { type: 'F', w: 10, d: 5 }, write: { type: 'F', w: 10, d: 5 } });
    }
  }
  if (o.saveProbs) {
    saved.groups.forEach((code, j) => {
      const name = o.saveProbs === true ? `Dis${j + 1}_${k0 + 1}` : `${o.saveProbs}${j + 1}`;
      add(name, t('labelProb', { g: valueText(gcol.v, code), n: analysisNo }), saved.pr.get(code) ?? new Array(N).fill(null), { print: { type: 'F', w: 10, d: 5 }, write: { type: 'F', w: 10, d: 5 } });
    });
  }
  return { items, dataset: { ...ds, variables: vars, columns } };
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

export const commands: ExtCommand[] = [{ name: NAME, run }];
