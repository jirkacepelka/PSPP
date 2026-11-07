/*
 * GLM – multivariate (several dependent variables) and repeated measures (/WSFACTOR) general
 * linear model, SPSS syntax and output. PSPP's own GLM is univariate without within-subject
 * factors, so this extension claims only those forms (see EXT_CONDITIONAL in names.ts); a plain
 * `GLM y BY a` still runs in the engine.
 *
 * Method (as SPSS's GLM algorithms describe it):
 * - Between-subjects model with intercept, factor effects and covariates. Type III sums of
 *   squares and cross-products: H = SSCP_E(model without the effect) − SSCP_E(full model) with
 *   sigma-restricted (effect, "deviation") coding of the factors – identical to SPSS's Type III
 *   for designs without empty cells. Columns are swept in order with a tolerance, so aliased
 *   columns (e.g. empty cells) are skipped like SPSS's redundant parameters.
 * - Parameter estimates and estimated marginal means use the full indicator ("dummy")
 *   parameterisation with a generalized (g2) inverse: the last level of every factor is redundant.
 * - Repeated measures: the dependent variables are transformed with orthonormalized contrasts
 *   (POLYNOMIAL by default) per within-subjects effect; the multivariate tests use E⁻¹H of the
 *   transformed SSCP matrices, the univariate (averaged) tests their traces, Mauchly's W and the
 *   epsilons the transformed error SSCP. Between-subjects effects use the average transform
 *   1/√k·Σ y.
 * - Huynh–Feldt epsilon in SPSS's (Lecoutre-corrected) form:
 *     ε_HF = min(1, ((dfE + 1)·d·ε_GG − 2) / (d·(dfE − d·ε_GG))),  dfE = N − rank(X),
 *   i.e. the original Huynh & Feldt (1976) formula with N − g + 1 instead of N in the numerator.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem, Variable } from '../../engine/types';
import { isMissing, requireNumeric, splitGroups, valueText, variable, weights, type Cell as DCell } from '../data';
import { chi2Sf, fSf, tInv, tTwoTail } from '../dist';
import { genEigenvalues, transpose, zeros, type Matrix } from '../linalg';
import { isKw, keywords, kwArg, sub, varList, type ParsedCommand, type Token } from '../parse';
import { fmt, fmtN, groupItem, messageItem, tableItem, td, textItem, th, type Cell } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';

const NAME = 'GLM';
const P = 'ext.glm';

type Val = number | string;
type Effect = string[];
type Contrast =
  | { kind: 'POLYNOMIAL'; metric?: number[] }
  | { kind: 'SIMPLE' | 'DEVIATION'; ref?: number }
  | { kind: 'DIFFERENCE' | 'HELMERT' | 'REPEATED' };
interface WsFactor {
  name: string;
  levels: number;
  contrast: Contrast;
}
type Adjust = 'LSD' | 'BONFERRONI' | 'SIDAK';
interface EmmRequest {
  /** factor names (between or within); empty = OVERALL */
  term: string[];
  compare: string | null;
  adj: Adjust;
}
interface Spec {
  dvs: string[];
  factors: string[];
  covariates: string[];
  ws: WsFactor[];
  measure: string;
  effects: Effect[];
  print: { descriptive: boolean; etasq: boolean; homogeneity: boolean; parameter: boolean };
  emmeans: EmmRequest[];
  alpha: number;
  includeUser: boolean;
}

/* ------------------------------------------------------------------ parsing */

const SUBS = ['WSFACTOR', 'WSDESIGN', 'MEASURE', 'METHOD', 'INTERCEPT', 'PRINT', 'EMMEANS', 'CRITERIA', 'DESIGN', 'PLOT', 'MISSING', 'POSTHOC', 'CONTRAST', 'SAVE', 'OUTFILE', 'LMATRIX', 'MMATRIX', 'KMATRIX', 'RANDOM', 'REGWGT', 'ROBUST'];
const subIs = (s: string, n: string) => n === s || (s.length >= 3 && n.startsWith(s));
const kwIs = (t: Token | undefined, n: string) => !!t && t.kind === 'id' && subIs(t.text.toUpperCase(), n);

function findVar(vars: Variable[], name: string): string | null {
  return vars.find((v) => v.name.toUpperCase() === name.toUpperCase())?.name ?? null;
}

/** Effects of /DESIGN or /WSDESIGN: `a b a*b`, `a BY b`; names resolved by RESOLVE. */
function parseEffects(tokens: Token[], resolve: (n: string) => string | null, what: string): Effect[] {
  const out: Effect[] = [];
  let cur: string[] = [];
  let joining = false;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const t of tokens) {
    if (t.text === '(' || t.text === ')' || isKw(t, 'WITHIN')) throw new ExtError('Nested effects are not supported.');
    if (t.text === ',') {
      flush();
      continue;
    }
    if (t.text === '*' || isKw(t, 'BY')) {
      joining = true;
      continue;
    }
    if (t.kind !== 'id') throw new ExtError(`Unexpected '${t.text}' on ${what}.`);
    if (isKw(t, 'INTERCEPT')) continue;
    const n = resolve(t.text);
    if (!n) throw new ExtError(`${t.text} is not a ${what === 'WSDESIGN' ? 'within-subjects factor' : 'factor or covariate'} of the model.`);
    if (!joining) flush();
    joining = false;
    if (cur.includes(n)) throw new ExtError(`${n} appears twice in an effect.`);
    cur.push(n);
  }
  flush();
  return out;
}

/** All main effects and interactions of FACTORS (smaller effects first), then covariates as main effects. */
function factorial(factors: string[]): Effect[] {
  const out: Effect[] = [];
  for (let mask = 1; mask < 1 << factors.length; mask++) out.push(factors.filter((_, i) => mask & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

function parseContrast(tokens: Token[], i: number, levels: number): { contrast: Contrast; next: number } {
  const t = tokens[i];
  const k = t.text.toUpperCase();
  const args: number[] = [];
  let next = i + 1;
  if (tokens[next]?.text === '(') {
    next++;
    while (next < tokens.length && tokens[next].text !== ')') {
      if (tokens[next].kind === 'num') args.push(tokens[next].value!);
      else if (tokens[next].text !== ',') throw new ExtError(`Unexpected '${tokens[next].text}' in a contrast specification.`);
      next++;
    }
    next++;
  }
  const m = (n: string) => subIs(k, n);
  if (m('POLYNOMIAL')) {
    if (args.length && args.length !== levels) throw new ExtError(`POLYNOMIAL needs ${levels} metric values.`);
    if (args.length && new Set(args).size !== args.length) throw new ExtError('POLYNOMIAL metric values must be distinct.');
    return { contrast: { kind: 'POLYNOMIAL', metric: args.length ? args : undefined }, next };
  }
  if (m('SIMPLE') || m('DEVIATION')) {
    const ref = args[0];
    if (ref !== undefined && (!Number.isInteger(ref) || ref < 1 || ref > levels)) throw new ExtError(`The reference category must be between 1 and ${levels}.`);
    return { contrast: { kind: m('SIMPLE') ? 'SIMPLE' : 'DEVIATION', ref }, next };
  }
  if (m('DIFFERENCE')) return { contrast: { kind: 'DIFFERENCE' }, next };
  if (m('HELMERT')) return { contrast: { kind: 'HELMERT' }, next };
  if (m('REPEATED')) return { contrast: { kind: 'REPEATED' }, next };
  if (m('SPECIAL')) throw new ExtError('SPECIAL contrasts are not supported.');
  throw new ExtError(`Unknown contrast ${t.text}.`);
}

const CONTRASTS = ['POLYNOMIAL', 'SIMPLE', 'DEVIATION', 'DIFFERENCE', 'HELMERT', 'REPEATED', 'SPECIAL'];

function parseWsFactors(tokens: Token[], vars: Variable[]): WsFactor[] {
  const out: WsFactor[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.text === ',') {
      i++;
      continue;
    }
    if (t.kind !== 'id') throw new ExtError('A within-subjects factor name is expected on WSFACTOR.');
    const n = tokens[i + 1];
    if (!n || n.kind !== 'num' || !Number.isInteger(n.value) || n.value! < 2) throw new ExtError(`The number of levels of ${t.text} must be an integer of at least 2.`);
    if (findVar(vars, t.text)) throw new ExtError(`The within-subjects factor name ${t.text} is already a variable name.`);
    if (out.some((f) => f.name.toUpperCase() === t.text.toUpperCase())) throw new ExtError(`${t.text} is defined twice on WSFACTOR.`);
    let contrast: Contrast = { kind: 'POLYNOMIAL' };
    i += 2;
    if (tokens[i]?.kind === 'id' && CONTRASTS.some((c) => kwIs(tokens[i], c))) {
      const r = parseContrast(tokens, i, n.value!);
      contrast = r.contrast;
      i = r.next;
    }
    out.push({ name: t.text, levels: n.value!, contrast });
  }
  if (!out.length) throw new ExtError('WSFACTOR needs at least one factor.');
  return out;
}

function parseEmmeans(tokens: Token[], resolve: (n: string) => string | null): EmmRequest {
  const tab = kwArg(tokens, 'TABLES');
  if (!tab) throw new ExtError('EMMEANS needs TABLES(…).');
  const term: string[] = [];
  for (const t of tab) {
    if (t.text === '*' || isKw(t, 'BY')) continue;
    if (isKw(t, 'OVERALL')) continue;
    const n = t.kind === 'id' ? resolve(t.text) : null;
    if (!n) throw new ExtError(`${t.text} on EMMEANS TABLES is not a factor of the model.`);
    if (term.includes(n)) throw new ExtError(`${n} appears twice on EMMEANS TABLES.`);
    term.push(n);
  }
  let compare: string | null = null;
  const ci = tokens.findIndex((t) => kwIs(t, 'COMPARE'));
  if (ci >= 0) {
    if (!term.length) throw new ExtError('COMPARE needs a factor on TABLES.');
    if (tokens[ci + 1]?.text === '(') {
      const n = resolve(tokens[ci + 2]?.text ?? '');
      if (!n || !term.includes(n)) throw new ExtError('The COMPARE factor must be one of the factors on TABLES.');
      compare = n;
    } else if (term.length === 1) compare = term[0];
    else throw new ExtError('COMPARE(factor) must name the factor to compare when TABLES has an interaction.');
  }
  const adjTok = kwArg(tokens, 'ADJ');
  let adj: Adjust = 'LSD';
  if (adjTok?.length) {
    if (kwIs(adjTok[0], 'BONFERRONI')) adj = 'BONFERRONI';
    else if (kwIs(adjTok[0], 'SIDAK')) adj = 'SIDAK';
    else if (kwIs(adjTok[0], 'LSD')) adj = 'LSD';
    else throw new ExtError('ADJ must be LSD, BONFERRONI or SIDAK.');
  }
  const withTok = kwArg(tokens, 'WITH');
  if (withTok?.some((t) => t.kind === 'num')) throw new ExtError('EMMEANS WITH covariate values are not supported (covariates are evaluated at their means).');
  return { term, compare, adj };
}

function parseSpec(cmd: ParsedCommand, ds: Dataset, warn: (k: string, a?: Record<string, unknown>) => void): Spec {
  const vars = ds.variables;
  for (const s of cmd.subs) if (!SUBS.some((n) => subIs(s.name, n))) throw new ExtError(`Unknown subcommand ${s.name}.`);
  const h = cmd.head;
  const d = varList(h, 0, vars, ['BY', 'WITH']);
  let i = d.next;
  let factors: string[] = [];
  let covariates: string[] = [];
  if (isKw(h[i], 'BY')) {
    const r = varList(h, i + 1, vars, ['WITH']);
    factors = r.names;
    i = r.next;
  }
  if (isKw(h[i], 'WITH')) {
    const r = varList(h, i + 1, vars, []);
    covariates = r.names;
    i = r.next;
  }
  if (i < h.length) throw new ExtError(`Unexpected '${h[i].text}' in the variable list.`);
  if (!d.names.length) throw new ExtError('A dependent variable list is expected.');
  const all = [...d.names, ...factors, ...covariates];
  const dup = all.find((n, k) => all.indexOf(n) !== k);
  if (dup) throw new ExtError(`${dup} is specified more than once.`);
  for (const n of [...d.names, ...covariates]) requireNumeric(variable(ds, n).v);

  for (const s of ['LMATRIX', 'MMATRIX', 'KMATRIX']) if (cmd.subs.some((x) => subIs(x.name, s))) throw new ExtError(`The ${s} subcommand is not supported.`);
  if (sub(cmd, 'RANDOM')) throw new ExtError('Random factors are not supported.');
  if (sub(cmd, 'REGWGT')) throw new ExtError('REGWGT (weighted least squares) is not supported; use WEIGHT for frequency weights.');
  if (sub(cmd, 'ROBUST')) throw new ExtError('Robust standard errors are not supported.');
  const meth = sub(cmd, 'METHOD');
  const sst = kwArg(meth, 'SSTYPE');
  if (sst?.length && sst[0].value !== 3) throw new ExtError('Only Type III sums of squares (SSTYPE(3)) are supported for multivariate and repeated measures GLM.');
  if (isKw(sub(cmd, 'INTERCEPT')?.[0], 'EXCLUDE')) throw new ExtError('INTERCEPT=EXCLUDE is not supported for multivariate and repeated measures GLM.');

  const wsTok = sub(cmd, 'WSFACTORS', 'WSFACTOR');
  const ws = wsTok ? parseWsFactors(wsTok, vars) : [];
  if (ws.length) {
    const k = ws.reduce((p, f) => p * f.levels, 1);
    if (k !== d.names.length) throw new ExtError(`The number of dependent variables (${d.names.length}) must equal the product of the levels of the within-subjects factors (${k}).`);
  } else if (sub(cmd, 'WSDESIGN')) throw new ExtError('WSDESIGN requires WSFACTOR.');
  const wsDes = sub(cmd, 'WSDESIGN');
  if (wsDes?.length) {
    const eff = parseEffects(wsDes, (n) => ws.find((f) => f.name.toUpperCase() === n.toUpperCase())?.name ?? null, 'WSDESIGN');
    const full = factorial(ws.map((f) => f.name));
    const key = (e: Effect) => [...e].sort().join('*');
    if (eff.length !== full.length || !full.every((e) => eff.some((x) => key(x) === key(e)))) throw new ExtError('Only the full factorial within-subjects design is supported on WSDESIGN.');
  }
  const meas = sub(cmd, 'MEASURE');
  if (meas && meas.filter((t) => t.kind === 'id').length > 1) throw new ExtError('Doubly multivariate designs (several names on MEASURE) are not supported.');
  const measure = meas?.find((t) => t.kind === 'id')?.text ?? 'MEASURE_1';

  const resolveBetween = (n: string) => [...factors, ...covariates].find((x) => x.toUpperCase() === n.toUpperCase()) ?? null;
  const desTok = sub(cmd, 'DESIGN');
  const effects = desTok?.length ? parseEffects(desTok, resolveBetween, 'DESIGN') : [...covariates.map((c) => [c]), ...factorial(factors)];
  const key = (e: Effect) => [...e].sort().join('*');
  const seen = new Set<string>();
  for (const e of effects) {
    if (seen.has(key(e))) throw new ExtError(`The effect ${e.join(' * ')} is specified twice on DESIGN.`);
    seen.add(key(e));
  }

  const print = { descriptive: false, etasq: false, homogeneity: false, parameter: false };
  for (const t of sub(cmd, 'PRINT') ?? []) {
    if (t.kind !== 'id') continue;
    const k = t.text.toUpperCase();
    if (subIs(k, 'DESCRIPTIVE')) print.descriptive = true;
    else if (subIs(k, 'ETASQ') || subIs(k, 'ETASQU')) print.etasq = true;
    else if (subIs(k, 'HOMOGENEITY')) print.homogeneity = true;
    else if (subIs(k, 'PARAMETER')) print.parameter = true;
    else if (['OPOWER', 'TEST', 'LOF', 'GEF', 'SSCP', 'RSSCP', 'ETASQUARED', 'MMATRIX', 'TRANSFORM', 'SPREADLEVEL', 'RESIDUALPLOT'].some((n) => subIs(k, n))) warn('keywordIgnored', { keyword: k });
    else throw new ExtError(`Unknown keyword ${t.text} on PRINT.`);
  }

  const resolveFactor = (n: string) => factors.find((x) => x.toUpperCase() === n.toUpperCase()) ?? ws.find((f) => f.name.toUpperCase() === n.toUpperCase())?.name ?? null;
  const emmeans = cmd.subs.filter((s) => subIs(s.name, 'EMMEANS')).map((s) => parseEmmeans(s.tokens, resolveFactor));
  const alphaTok = kwArg(sub(cmd, 'CRITERIA'), 'ALPHA');
  const alpha = alphaTok?.[0]?.value ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) throw new ExtError('ALPHA must be between 0 and 1.');
  const includeUser = keywords(sub(cmd, 'MISSING')).has('INCLUDE');
  if (sub(cmd, 'PLOT')) warn('plotSkipped');
  for (const s of ['POSTHOC', 'CONTRAST', 'SAVE', 'OUTFILE']) if (cmd.subs.some((x) => subIs(x.name, s))) warn('subIgnored', { sub: s });
  return { dvs: d.names, factors, covariates, ws, measure, effects, print, emmeans, alpha, includeUser };
}

/* -------------------------------------------------------------- linear algebra */

/** Kronecker product (A outer, B inner – the last factor changes fastest). */
function kron(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = [];
  for (const ra of a)
    for (const rb of b) {
      const row: number[] = [];
      for (const x of ra) for (const y of rb) row.push(x * y);
      out.push(row);
    }
  return out;
}

/** Gram–Schmidt orthonormalization of the columns of A (dependent columns dropped). */
function orthonormalCols(a: Matrix): Matrix {
  const cols: number[][] = [];
  for (const c of transpose(a)) {
    const v = [...c];
    for (const q of cols) {
      const d = v.reduce((s, x, i) => s + x * q[i], 0);
      for (let i = 0; i < v.length; i++) v[i] -= d * q[i];
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (n > 1e-10) cols.push(v.map((x) => x / n));
  }
  return cols.length ? transpose(cols) : a.map(() => []);
}

/** M'AM */
function quad(m: Matrix, a: Matrix): Matrix {
  const am = a.map((r) => m[0].map((_, j) => r.reduce((s, x, k) => s + x * m[k][j], 0)));
  return m[0].map((_, i) => m[0].map((__, j) => m.reduce((s, r, k) => s + r[i] * am[k][j], 0)));
}
const qform = (v: number[], a: Matrix) => v.reduce((s, x, i) => s + x * a[i].reduce((t, y, j) => t + y * v[j], 0), 0);
const trace = (a: Matrix) => a.reduce((s, r, i) => s + r[i], 0);
const sub2 = (a: Matrix, b: Matrix) => a.map((r, i) => r.map((x, j) => x - b[i][j]));

/** Determinant of a symmetric matrix by Gaussian elimination with partial pivoting. */
function det(a: Matrix): number {
  const n = a.length;
  const m = a.map((r) => [...r]);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) {
      [m[p], m[c]] = [m[c], m[p]];
      d = -d;
    }
    d *= m[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let j = c; j < n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return d;
}

interface Sweep {
  rank: number;
  /** residual SSCP of the dependent block */
  E: Matrix;
  /** coefficients (rows = selected X columns; aliased rows zero) */
  B: Matrix;
  /** generalized inverse of X'WX over the selected columns (aliased rows/columns zero) */
  G: Matrix;
  aliased: boolean[];
}

/**
 * Sweeps the X columns XS (in order) of the cross-product matrix C = [X Y]'W[X Y]; Y occupies the
 * columns from YS (K of them). A column whose residual diagonal falls below 1e-9 of its original
 * value is aliased (redundant) and skipped.
 */
function sweep(C: Matrix, xs: number[], ys: number, k: number): Sweep {
  const idx = [...xs, ...Array.from({ length: k }, (_, j) => ys + j)];
  const a = idx.map((i) => idx.map((j) => C[i][j]));
  const q = xs.length;
  const aliased = new Array(q).fill(false);
  let rank = 0;
  for (let p = 0; p < q; p++) {
    const d = a[p][p];
    const orig = C[xs[p]][xs[p]];
    if (!(orig > 0) || !(d > 1e-9 * orig)) {
      aliased[p] = true;
      continue;
    }
    rank++;
    const n = a.length;
    for (let i = 0; i < n; i++) {
      if (i === p) continue;
      const f = a[i][p] / d;
      if (f === 0) continue;
      for (let j = 0; j < n; j++) if (j !== p) a[i][j] -= f * a[p][j];
    }
    for (let i = 0; i < n; i++) if (i !== p) {
      a[i][p] = a[i][p] / d;
      a[p][i] = a[p][i] / d;
    }
    a[p][p] = -1 / d;
  }
  const E = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => a[q + i][q + j]));
  const B = Array.from({ length: q }, (_, i) => Array.from({ length: k }, (__, j) => (aliased[i] ? 0 : a[i][q + j])));
  const G = Array.from({ length: q }, (_, i) => Array.from({ length: q }, (__, j) => (aliased[i] || aliased[j] ? 0 : -a[i][j])));
  return { rank, E, B, G, aliased };
}

/* ------------------------------------------------------- multivariate tests */

interface MvRow {
  value: number;
  F: number;
  df1: number;
  df2: number;
  sig: number;
  eta: number;
  exact: boolean;
  bound: boolean;
}

/** Pillai, Wilks, Hotelling, Roy for H and E (p×p), hypothesis df Q, error df V (SPSS formulas). */
export function multivariateTests(H: Matrix, E: Matrix, q: number, v: number): MvRow[] | null {
  const p = H.length;
  if (p === 0 || q <= 0 || v <= 0) return null;
  const ev = genEigenvalues(H, E);
  if (!ev || v < p) return null;
  const lam = ev.map((x) => Math.max(0, x));
  const s = Math.min(p, q);
  const m = (Math.abs(p - q) - 1) / 2;
  const n = (v - p - 1) / 2;
  const exact = s === 1;
  const pillai = lam.reduce((a, x) => a + x / (1 + x), 0);
  const wilks = lam.reduce((a, x) => a / (1 + x), 1);
  const hot = lam.reduce((a, x) => a + x, 0);
  const roy = lam[0];
  const rows: MvRow[] = [];
  {
    const df1 = s * (2 * m + s + 1);
    const df2 = s * (2 * n + s + 1);
    const F = (df2 / df1) * (pillai / (s - pillai));
    rows.push({ value: pillai, F, df1, df2, sig: fSf(F, df1, df2), eta: pillai / s, exact, bound: false });
  }
  {
    const t = p * p + q * q - 5 > 0 ? Math.sqrt((p * p * q * q - 4) / (p * p + q * q - 5)) : 1;
    const df1 = p * q;
    const w = v + q - (p + q + 1) / 2;
    const df2 = w * t - (p * q - 2) / 2;
    const l = Math.pow(wilks, 1 / t);
    const F = ((1 - l) / l) * (df2 / df1);
    rows.push({ value: wilks, F, df1, df2, sig: fSf(F, df1, df2), eta: 1 - Math.pow(wilks, 1 / s), exact, bound: false });
  }
  {
    const df1 = s * (2 * m + s + 1);
    const df2 = 2 * (s * n + 1);
    const F = (df2 * hot) / (s * s * (2 * m + s + 1));
    rows.push({ value: hot, F, df1, df2, sig: fSf(F, df1, df2), eta: hot / s / (hot / s + 1), exact, bound: false });
  }
  {
    const r = Math.max(p, q);
    const df1 = r;
    const df2 = v - r + q;
    const F = (roy * df2) / df1;
    rows.push({ value: roy, F, df1, df2, sig: fSf(F, df1, df2), eta: roy / (1 + roy), exact, bound: !exact });
  }
  return rows;
}

/** Mauchly's W, chi-square, df, sig and the three epsilons for the transformed error SSCP EM (d×d). */
export function sphericity(EM: Matrix, dfE: number) {
  const d = EM.length;
  const tr = trace(EM);
  const tr2 = EM.reduce((s, r, i) => s + r.reduce((t, x, j) => t + x * EM[j][i], 0), 0);
  const gg = d === 1 ? 1 : (tr * tr) / (d * tr2);
  const hf = d === 1 ? 1 : Math.min(1, ((dfE + 1) * d * gg - 2) / (d * (dfE - d * gg)));
  const lb = 1 / d;
  if (d === 1) return { W: 1, chi: 0, df: 0, sig: NaN, gg, hf, lb };
  const W = Math.max(0, det(EM) / Math.pow(tr / d, d));
  const chi = -(dfE - (2 * d * d + d + 2) / (6 * d)) * Math.log(W);
  const df = (d * (d + 1)) / 2 - 1;
  return { W, chi, df, sig: chi2Sf(chi, df), gg, hf: hf < 0 ? NaN : hf, lb };
}

/* ------------------------------------------------------------- contrasts */

/** Contrast matrix (levels × levels−1) and labels for one within-subjects factor. */
function contrastMatrix(f: WsFactor, t: (k: string, a?: Record<string, unknown>) => string): { C: Matrix; labels: string[] } {
  const L = f.levels;
  const c = f.contrast;
  const e = (i: number) => Array.from({ length: L }, (_, j) => (j === i ? 1 : 0));
  const cols: number[][] = [];
  const labels: string[] = [];
  if (c.kind === 'POLYNOMIAL') {
    const x = c.metric ?? Array.from({ length: L }, (_, i) => i + 1);
    const pow = Array.from({ length: L }, (_, p) => x.map((v) => Math.pow(v, p)));
    const q = orthonormalCols(transpose(pow));
    const Q = transpose(q).slice(1);
    Q.forEach((col, i) => {
      // sign: increasing for the linear term (positive leading coefficient for higher orders)
      const s = col[L - 1] < 0 ? -1 : 1;
      cols.push(col.map((v) => v * s));
      labels.push(i === 0 ? t('linear') : i === 1 ? t('quadratic') : i === 2 ? t('cubic') : t('order', { n: i + 1 }));
    });
  } else if (c.kind === 'SIMPLE' || c.kind === 'DEVIATION') {
    const ref = (c.ref ?? L) - 1;
    for (let i = 0; i < L; i++) {
      if (i === ref) continue;
      cols.push(c.kind === 'SIMPLE' ? e(i).map((v, j) => v - (j === ref ? 1 : 0)) : e(i).map((v) => v - 1 / L));
      labels.push(c.kind === 'SIMPLE' ? t('levelVs', { i: i + 1, j: ref + 1 }) : t('levelVsMean', { i: i + 1 }));
    }
  } else if (c.kind === 'DIFFERENCE') {
    for (let i = 1; i < L; i++) {
      cols.push(e(i).map((v, j) => v - (j < i ? 1 / i : 0)));
      labels.push(i === 1 ? t('levelVs', { i: 2, j: 1 }) : t('levelVsPrevious', { i: i + 1 }));
    }
  } else if (c.kind === 'HELMERT') {
    for (let i = 0; i < L - 1; i++) {
      cols.push(e(i).map((v, j) => v - (j > i ? 1 / (L - 1 - i) : 0)));
      labels.push(i === L - 2 ? t('levelVs', { i: L - 1, j: L }) : t('levelVsLater', { i: i + 1 }));
    }
  } else {
    for (let i = 0; i < L - 1; i++) {
      cols.push(e(i).map((v, j) => v - (j === i + 1 ? 1 : 0)));
      labels.push(t('levelVs', { i: i + 1, j: i + 2 }));
    }
  }
  return { C: transpose(cols), labels };
}

/* -------------------------------------------------------------- formatting */

class Notes {
  list: { mark: string; text: string }[] = [];
  mark(text: string): string {
    const f = this.list.find((x) => x.text === text);
    if (f) return f.mark;
    const mark = String.fromCharCode(97 + this.list.filter((x) => /^[a-z]$/.test(x.mark)).length);
    this.list.push({ mark, text });
    return mark;
  }
  special(mark: string, text: string) {
    if (!this.list.some((x) => x.mark === mark)) this.list.push({ mark, text });
  }
}

/* ------------------------------------------------------------------ analysis */

interface Factor {
  name: string;
  v: Variable;
  col: DCell[];
  levels: Val[];
}

const cellVal = (x: DCell): Val => (typeof x === 'number' ? x : String(x).trimEnd());

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const ds = ctx.dataset;
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const pre: OutputItem[] = [];
  const spec = parseSpec(cmd, ds, (k, a) => pre.push(messageItem(k === 'plotSkipped' ? 'note' : 'warning', t(k, a), ctx.line)));
  const children: OutputItem[] = [...pre];
  const w = weights(ds);
  for (const group of splitGroups(ds)) {
    if (group.label) children.push(textItem(group.label));
    children.push(...analyse(spec, ds, group.rows, w, ctx, t));
  }
  return [groupItem(t('title'), NAME, children)];
}

function analyse(spec: Spec, ds: Dataset, groupRows: number[], wAll: number[], ctx: ExtContext, t: (k: string, a?: Record<string, unknown>) => string): OutputItem[] {
  const out: OutputItem[] = [];
  const F3 = (x: number) => fmt(x, 3, ctx);
  const fDf = (x: number) => (Number.isInteger(x) ? String(x) : fmt(x, 3, ctx));
  const dvs = spec.dvs.map((n) => variable(ds, n));
  const fac = spec.factors.map((n) => variable(ds, n));
  const cov = spec.covariates.map((n) => variable(ds, n));
  const rows = groupRows.filter((r) => [...dvs, ...fac, ...cov].every((x) => !isMissing(x.v, x.col[r], spec.includeUser)));
  const W = rows.map((r) => wAll[r]);
  const N = W.reduce((a, b) => a + b, 0);
  if (!rows.length || N <= 0) {
    out.push(messageItem('warning', t('noValid'), ctx.line));
    return out;
  }
  const k = dvs.length;
  const Y = rows.map((r) => dvs.map((d) => d.col[r] as number));
  const factors: Factor[] = fac.map((f, i) => {
    const vals = [...new Map(rows.map((r) => [JSON.stringify(cellVal(f.col[r])), cellVal(f.col[r])])).values()];
    vals.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
    return { name: spec.factors[i], v: f.v, col: f.col, levels: vals };
  });
  const levelOf = factors.map((f) => {
    const m = new Map(f.levels.map((l, i) => [JSON.stringify(l), i]));
    return rows.map((r) => m.get(JSON.stringify(cellVal(f.col[r])))!);
  });
  const covMean = cov.map((c) => rows.reduce((s, r, i) => s + W[i] * (c.col[r] as number), 0) / N);
  const fIdx = (n: string) => spec.factors.indexOf(n);
  const cIdx = (n: string) => spec.covariates.indexOf(n);

  // ---------- design matrices
  const effectRow = (e: Effect, i: number, indicator: boolean): number[] => {
    let v = [1];
    for (const n of e) {
      const fi = fIdx(n);
      let c: number[];
      if (fi >= 0) {
        const L = factors[fi].levels.length;
        const l = levelOf[fi][i];
        c = indicator ? Array.from({ length: L }, (_, j) => (j === l ? 1 : 0)) : Array.from({ length: L - 1 }, (_, j) => (l === j ? 1 : l === L - 1 ? -1 : 0));
      } else c = [cov[cIdx(n)].col[rows[i]] as number];
      const nv: number[] = [];
      for (const a of v) for (const b of c) nv.push(a * b);
      v = nv;
    }
    return v;
  };
  const build = (indicator: boolean) => {
    const ranges: [number, number][] = [];
    let q = 1;
    for (const e of spec.effects) {
      const len = effectRow(e, 0, indicator).length;
      ranges.push([q, q + len]);
      q += len;
    }
    const C = zeros(q + k, q + k);
    rows.forEach((_, i) => {
      const z = [1, ...spec.effects.flatMap((e) => effectRow(e, i, indicator)), ...Y[i]];
      const wi = W[i];
      for (let a = 0; a < z.length; a++) {
        if (z[a] === 0) continue;
        const wa = wi * z[a];
        for (let b = 0; b < z.length; b++) C[a][b] += wa * z[b];
      }
    });
    return { C, q, ranges };
  };
  const eff = build(false);
  const all = Array.from({ length: eff.q }, (_, i) => i);
  const full = sweep(eff.C, all, eff.q, k);
  const E = full.E;
  const dfE = N - full.rank;
  const sources: { name: string; H: Matrix; df: number; effect: Effect | null }[] = [];
  const termRanges: [number, number][] = [[0, 1], ...eff.ranges];
  [null, ...spec.effects].forEach((e, ti) => {
    const [a, b] = termRanges[ti];
    const red = sweep(eff.C, all.filter((x) => x < a || x >= b), eff.q, k);
    sources.push({ name: e ? e.join(' * ') : t('intercept'), H: sub2(red.E, E), df: full.rank - red.rank, effect: e });
  });
  const icpt = sweep(eff.C, [0], eff.q, k);
  const Hmodel = sub2(icpt.E, E);
  const dfModel = full.rank - icpt.rank;
  const Ctot = icpt.E;
  const Ytot = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => eff.C[eff.q + i][eff.q + j]));

  // indicator parameterisation (parameters, EMMs, residuals)
  const ind = build(true);
  const indAll = Array.from({ length: ind.q }, (_, i) => i);
  const par = sweep(ind.C, indAll, ind.q, k);
  const S = dfE > 0 ? E.map((r) => r.map((x) => x / dfE)) : E.map((r) => r.map(() => NaN));

  const designNote = t('design', { terms: [t('intercept'), ...spec.effects.map((e) => e.join(' * '))].join(' + ') });
  const isRM = spec.ws.length > 0;
  const wsNames = spec.ws.map((f) => f.name);
  const wsEffects = factorial(wsNames);
  const fullDesign = isRM ? `${designNote} ${t('wsDesign', { terms: wsEffects.map((e) => e.join(' * ')).join(' + ') })}` : designNote;
  const measureLayer = { mark: '', text: t('measureLayer', { name: spec.measure }) };
  if (dfE <= 0) out.push(messageItem('warning', t('dfE0'), ctx.line));

  // ---------- Within-Subjects Factors
  const Ls = spec.ws.map((f) => f.levels);
  const levelIndex = (j: number): number[] => {
    const idx: number[] = [];
    let r = j;
    for (let f = Ls.length - 1; f >= 0; f--) {
      idx[f] = r % Ls[f];
      r = Math.floor(r / Ls[f]);
    }
    return idx;
  };
  if (isRM)
    out.push(
      tableItem(
        {
          caption: t('wsFactors'),
          head: [[...wsNames.map((n) => th(n)), th(t('dependentVariable'))]],
          body: dvs.map((d, j) => [...levelIndex(j).map((l) => th(String(l + 1))), td(d.v.name)]),
          footnotes: [measureLayer],
        },
        NAME,
      ),
    );

  // ---------- Between-Subjects Factors
  if (factors.length) {
    const anyLabels = factors.some((f) => (f.v.valueLabels ?? []).length > 0);
    const body: Cell[][] = [];
    factors.forEach((f, fi) => {
      f.levels.forEach((l, li) => {
        const n = W.reduce((s, wi, i) => s + (levelOf[fi][i] === li ? wi : 0), 0);
        const lab = (f.v.valueLabels ?? []).find((vl) => (typeof l === 'number' ? vl.value === l : String(vl.value).trimEnd() === l));
        body.push([...(li === 0 ? [th(f.name, { rowspan: f.levels.length })] : []), th(String(l)), ...(anyLabels ? [td(lab?.label ?? '')] : []), td(fmtN(n, ctx))]);
      });
    });
    out.push(tableItem({ caption: t('bsFactors'), head: [[th(''), th(''), ...(anyLabels ? [th(t('valueLabel'))] : []), th(t('n'))]], body }, NAME));
  }

  // ---------- Descriptive Statistics
  const levelName = (fi: number, li: number) => valueText(factors[fi].v, factors[fi].levels[li] as DCell);
  if (spec.print.descriptive) {
    const combos: (number | null)[][] = [];
    const rec = (prefix: (number | null)[]) => {
      if (prefix.length === factors.length) return void combos.push(prefix);
      for (let l = 0; l < factors[prefix.length].levels.length; l++) rec([...prefix, l]);
      rec([...prefix, null]);
    };
    rec([]);
    const body: Cell[][] = [];
    dvs.forEach((d, j) => {
      combos.forEach((c, ci) => {
        let sw = 0;
        let s = 0;
        rows.forEach((_, i) => {
          if (c.every((l, fi) => l === null || levelOf[fi][i] === l)) {
            sw += W[i];
            s += W[i] * Y[i][j];
          }
        });
        const m = sw > 0 ? s / sw : NaN;
        let ss = 0;
        rows.forEach((_, i) => {
          if (c.every((l, fi) => l === null || levelOf[fi][i] === l)) ss += W[i] * (Y[i][j] - m) ** 2;
        });
        const stub: Cell[] = [];
        if (ci === 0) stub.push(th(d.v.label || d.v.name, { rowspan: combos.length }));
        c.forEach((l, fi) => {
          // span repeated outer labels
          const first = ci === 0 || combos[ci - 1].slice(0, fi + 1).some((x, z) => x !== c[z]);
          if (!first) return;
          let span = 1;
          while (ci + span < combos.length && combos[ci + span].slice(0, fi + 1).every((x, z) => x === c[z])) span++;
          stub.push(th(l === null ? t('total') : levelName(fi, l), { rowspan: span }));
        });
        body.push([...stub, td(sw > 0 ? F3(m) : ''), td(sw > 1 ? F3(Math.sqrt(ss / (sw - 1))) : ''), td(fmtN(sw, ctx))]);
      });
    });
    out.push(tableItem({ caption: t('descriptives'), head: [[th(''), ...factors.map((f) => th(f.name)), th(t('mean')), th(t('sd')), th(t('n'))]], body }, NAME));
  }

  // cells of all factor combinations (for Box's M and Levene)
  const cellKey = (i: number) => levelOf.map((l) => l[i]).join(',');
  const cells = new Map<string, number[]>();
  rows.forEach((_, i) => {
    const key = cellKey(i);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(i);
  });

  // ---------- Box's M
  if (spec.print.homogeneity && factors.length) {
    const notes = new Notes();
    const covs: { n: number; S: Matrix }[] = [];
    for (const idx of cells.values()) {
      const n = idx.reduce((s, i) => s + W[i], 0);
      if (n - 1 <= 0) continue;
      const m = Array.from({ length: k }, (_, j) => idx.reduce((s, i) => s + W[i] * Y[i][j], 0) / n);
      const Sc = zeros(k, k);
      for (const i of idx) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) Sc[a][b] += (W[i] * (Y[i][a] - m[a]) * (Y[i][b] - m[b])) / (n - 1);
      if (det(Sc) > 1e-12 * Math.max(1e-300, Sc.reduce((p, r, i) => p * Math.max(r[i], 1e-300), 1))) covs.push({ n, S: Sc });
    }
    const g = covs.length;
    let body: Cell[][];
    if (g >= 2) {
      const Nn = covs.reduce((s, c) => s + c.n, 0);
      const Sp = zeros(k, k);
      for (const c of covs) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) Sp[a][b] += ((c.n - 1) * c.S[a][b]) / (Nn - g);
      const M = (Nn - g) * Math.log(det(Sp)) - covs.reduce((s, c) => s + (c.n - 1) * Math.log(det(c.S)), 0);
      const p = k;
      const c1 = (covs.reduce((s, c) => s + 1 / (c.n - 1), 0) - 1 / (Nn - g)) * ((2 * p * p + 3 * p - 1) / (6 * (p + 1) * (g - 1)));
      const c2 = (covs.reduce((s, c) => s + 1 / (c.n - 1) ** 2, 0) - 1 / (Nn - g) ** 2) * (((p - 1) * (p + 2)) / (6 * (g - 1)));
      const df1 = ((g - 1) * p * (p + 1)) / 2;
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
      body = [[th(t('boxMStat')), td(F3(M))], [th(t('f')), td(F3(F))], [th(t('df1')), td(fDf(df1))], [th(t('df2')), td(F3(df2))], [th(t('sig')), td(F3(fSf(F, df1, df2)))]];
    } else body = [[th(t('boxMStat')), td('')]];
    const dmark = notes.mark(fullDesign);
    body[0][0] = { ...body[0][0], sup: dmark };
    out.push(
      tableItem(
        {
          caption: t('boxM'),
          head: [],
          body,
          footnotes: [{ mark: '', text: t('boxNote') }, ...(g < 2 ? [{ mark: '', text: t('boxNone') }] : []), ...notes.list],
        },
        NAME,
      ),
    );
  }

  // ---------- within-subjects transforms
  const cm = spec.ws.map((f) => contrastMatrix(f, t));
  const Pm = cm.map((c) => orthonormalCols(c.C));
  const U = Ls.map((L) => Array.from({ length: L }, () => [1 / Math.sqrt(L)]));
  const kronAll = (parts: Matrix[]) => parts.reduce((a, b) => kron(a, b), [[1]] as Matrix);
  const etaHead = spec.print.etasq ? [th(t('eta'))] : [];

  // ---------- Multivariate Tests
  const mvBlocks: { name: string; H: Matrix; E: Matrix; q: number }[] = [];
  if (isRM) {
    for (const we of wsEffects) {
      const M = kronAll(spec.ws.map((f, i) => (we.includes(f.name) ? Pm[i] : U[i])));
      const EM = quad(M, E);
      sources.forEach((s) => mvBlocks.push({ name: s.effect ? `${we.join(' * ')} * ${s.name}` : we.join(' * '), H: quad(M, s.H), E: EM, q: s.df }));
    }
  } else for (const s of sources) mvBlocks.push({ name: s.name, H: s.H, E, q: s.df });
  {
    const notes = new Notes();
    const body: Cell[][] = [];
    let failed = false;
    const statNames = [t('pillai'), t('wilks'), t('hotelling'), t('roy')];
    for (const b of mvBlocks) {
      if (b.q <= 0) continue;
      const r = dfE > 0 ? multivariateTests(b.H, b.E, b.q, dfE) : null;
      if (!r) failed = true;
      statNames.forEach((sn, si) => {
        const x = r?.[si];
        const mark = x ? (x.exact ? notes.mark(t('exact')) : x.bound ? notes.mark(t('upperBound')) : undefined) : undefined;
        body.push([
          ...(si === 0 ? [th(b.name, { rowspan: 4 })] : []),
          th(sn),
          td(x ? F3(x.value) : ''),
          td(x ? F3(x.F) : '', { sup: mark }),
          td(x ? fDf(Math.round(x.df1 * 1000) / 1000) : ''),
          td(x ? fDf(Math.round(x.df2 * 1000) / 1000) : ''),
          td(x ? F3(x.sig) : ''),
          ...(spec.print.etasq ? [td(x ? F3(x.eta) : '')] : []),
        ]);
      });
    }
    const dmark = notes.mark(fullDesign);
    if (failed) notes.special('', t('mvSingular'));
    if (body.length)
      out.push(
        tableItem(
          {
            caption: t('mvTests'),
            head: [[th(t('effect'), { sup: dmark }), th(''), th(t('value')), th(t('f')), th(t('hypDf')), th(t('errDf')), th(t('sig')), ...etaHead]],
            body,
            footnotes: notes.list,
          },
          NAME,
        ),
      );
  }

  // ---------- RM: Mauchly, within effects, contrasts
  if (isRM) {
    const notes = new Notes();
    const epsMark = notes.mark(t('epsilonNote'));
    const dmark = notes.mark(fullDesign);
    const eps: Record<string, { gg: number; hf: number; lb: number }> = {};
    const body: Cell[][] = [];
    for (const we of wsEffects) {
      const M = kronAll(spec.ws.map((f, i) => (we.includes(f.name) ? Pm[i] : U[i])));
      const sp = sphericity(quad(M, E), dfE);
      eps[we.join(' * ')] = sp;
      body.push([th(we.join(' * ')), td(F3(sp.W)), td(F3(sp.chi)), td(String(sp.df)), td(sp.df === 0 ? '.' : F3(sp.sig)), td(F3(sp.gg)), td(F3(sp.hf)), td(F3(sp.lb))]);
    }
    out.push(
      tableItem(
        {
          caption: t('mauchly'),
          head: [
            [th(t('wsEffect'), { rowspan: 2, sup: dmark }), th(t('mauchlyW'), { rowspan: 2 }), th(t('approxChi'), { rowspan: 2 }), th(t('df'), { rowspan: 2 }), th(t('sig'), { rowspan: 2 }), th(t('epsilon'), { colspan: 3, sup: epsMark })],
            [th(t('gg')), th(t('hf')), th(t('lb'))],
          ],
          body,
          footnotes: [measureLayer, { mark: '', text: t('mauchlyNote') }, ...notes.list],
        },
        NAME,
      ),
    );

    // Tests of Within-Subjects Effects
    const corr = [
      [t('sphericity'), (_: string) => 1],
      [t('gg'), (e: string) => eps[e].gg],
      [t('hf'), (e: string) => eps[e].hf],
      [t('lb'), (e: string) => eps[e].lb],
    ] as const;
    const wb: Cell[][] = [];
    for (const we of wsEffects) {
      const en = we.join(' * ');
      const M = kronAll(spec.ws.map((f, i) => (we.includes(f.name) ? Pm[i] : U[i])));
      const d = M[0].length;
      const EM = quad(M, E);
      const sse = trace(EM);
      for (const s of sources) {
        if (s.df <= 0) continue;
        const ssh = trace(quad(M, s.H));
        const name = s.effect ? `${en} * ${s.name}` : en;
        corr.forEach(([label, ef], ci) => {
          const e = ef(en);
          const df1 = s.df * d * e;
          const df2 = dfE * d * e;
          const F = ssh / df1 / (sse / df2);
          wb.push([...(ci === 0 ? [th(name, { rowspan: 4 })] : []), th(label), td(F3(ssh)), td(fDf(df1)), td(F3(ssh / df1)), td(dfE > 0 ? F3(F) : ''), td(dfE > 0 ? F3(fSf(F, df1, df2)) : ''), ...(spec.print.etasq ? [td(F3(ssh / (ssh + sse)))] : [])]);
        });
      }
      corr.forEach(([label, ef], ci) => {
        const df2 = dfE * d * ef(en);
        wb.push([...(ci === 0 ? [th(t('error', { effect: en }), { rowspan: 4 })] : []), th(label), td(F3(sse)), td(fDf(df2)), td(F3(sse / df2)), td(''), td(''), ...(spec.print.etasq ? [td('')] : [])]);
      });
    }
    out.push(
      tableItem(
        {
          caption: t('wsEffects'),
          head: [[th(t('source')), th(''), th(t('ss')), th(t('df')), th(t('ms')), th(t('f')), th(t('sig')), ...etaHead]],
          body: wb,
          footnotes: [measureLayer],
        },
        NAME,
      ),
    );

    // Tests of Within-Subjects Contrasts
    const cb: Cell[][] = [];
    const nf = spec.ws.length;
    for (const we of wsEffects) {
      const en = we.join(' * ');
      const Mc = kronAll(spec.ws.map((f, i) => (we.includes(f.name) ? cm[i].C : U[i])));
      // labels of the columns of Mc: combination of the per-factor contrast labels
      const labelSets = spec.ws.map((f, i) => (we.includes(f.name) ? cm[i].labels : ['']));
      const combos: string[][] = [[]];
      const lab = labelSets.reduce((acc, ls) => acc.flatMap((a) => ls.map((l) => [...a, l])), combos);
      const blocks: { name: string; rows: Cell[][] }[] = [];
      const errRows: Cell[][] = [];
      for (const s of [...sources.filter((x) => x.df > 0), null]) {
        const rowsOut: Cell[][] = [];
        Mc[0].forEach((_, ci) => {
          const c = Mc.map((r) => r[ci]);
          const sse = qform(c, E);
          const labCells = lab[ci].map((l) => th(l));
          if (!s) {
            rowsOut.push([...labCells, td(F3(sse)), td(fDf(dfE)), td(dfE > 0 ? F3(sse / dfE) : ''), td(''), td(''), ...(spec.print.etasq ? [td('')] : [])]);
            return;
          }
          const ssh = qform(c, s.H);
          const F = ssh / s.df / (sse / dfE);
          rowsOut.push([...labCells, td(F3(ssh)), td(fDf(s.df)), td(F3(ssh / s.df)), td(dfE > 0 ? F3(F) : ''), td(dfE > 0 ? F3(fSf(F, s.df, dfE)) : ''), ...(spec.print.etasq ? [td(F3(ssh / (ssh + sse)))] : [])]);
        });
        if (s) blocks.push({ name: s.effect ? `${en} * ${s.name}` : en, rows: rowsOut });
        else errRows.push(...rowsOut);
      }
      for (const b of [...blocks, { name: t('error', { effect: en }), rows: errRows }]) b.rows.forEach((r, i) => cb.push([...(i === 0 ? [th(b.name, { rowspan: b.rows.length })] : []), ...r]));
    }
    out.push(
      tableItem(
        {
          caption: t('wsContrasts'),
          head: [[th(t('source')), ...wsNames.slice(0, nf).map((n) => th(n)), th(t('ss')), th(t('df')), th(t('ms')), th(t('f')), th(t('sig')), ...etaHead]],
          body: cb,
          footnotes: [measureLayer],
        },
        NAME,
      ),
    );
  }

  // ---------- residuals (indicator model) for Levene
  if (spec.print.homogeneity && factors.length) {
    const notes = new Notes();
    const body: Cell[][] = [];
    const g = cells.size;
    dvs.forEach((d, j) => {
      const z = rows.map((_, i) => {
        const x = [1, ...spec.effects.flatMap((e) => effectRow(e, i, true))];
        return Math.abs(Y[i][j] - x.reduce((s, v, c) => s + v * par.B[c][j], 0));
      });
      const zbar = z.reduce((s, v, i) => s + W[i] * v, 0) / N;
      let ssb = 0;
      let ssw = 0;
      for (const idx of cells.values()) {
        const n = idx.reduce((s, i) => s + W[i], 0);
        const m = idx.reduce((s, i) => s + W[i] * z[i], 0) / n;
        ssb += n * (m - zbar) ** 2;
        for (const i of idx) ssw += W[i] * (z[i] - m) ** 2;
      }
      const df1 = g - 1;
      const df2 = N - g;
      const F = df1 > 0 && df2 > 0 && ssw > 0 ? ssb / df1 / (ssw / df2) : NaN;
      body.push([th(d.v.label || d.v.name), td(F3(F)), td(fDf(df1)), td(fDf(df2)), td(Number.isFinite(F) ? F3(fSf(F, df1, df2)) : '')]);
    });
    const dmark = notes.mark(fullDesign);
    out.push(
      tableItem(
        {
          caption: t('levene'),
          head: [[th('', { sup: dmark }), th(t('f')), th(t('df1')), th(t('df2')), th(t('sig'))]],
          body,
          footnotes: [{ mark: '', text: t('leveneNote') }, ...notes.list],
        },
        NAME,
      ),
    );
  }

  // ---------- Tests of Between-Subjects Effects
  {
    const notes = new Notes();
    const body: Cell[][] = [];
    const row = (src: Cell[], ss: number, df: number, test: boolean, sse: number) => {
      const F = ss / df / (sse / dfE);
      return [
        ...src,
        td(F3(ss)),
        td(fDf(df)),
        td(df > 0 ? F3(ss / df) : ''),
        td(test && df > 0 && dfE > 0 ? F3(F) : ''),
        td(test && df > 0 && dfE > 0 ? F3(fSf(F, df, dfE)) : ''),
        ...(spec.print.etasq ? [td(test && df > 0 ? F3(ss / (ss + sse)) : '')] : []),
      ];
    };
    if (isRM) {
      const m0 = Array.from({ length: k }, () => 1 / Math.sqrt(k));
      const sse = qform(m0, E);
      for (const s of sources) body.push(row([th(s.name)], qform(m0, s.H), s.df, true, sse));
      body.push(row([th(t('errorRow'))], sse, dfE, false, sse));
      out.push(
        tableItem(
          {
            caption: t('bsEffects'),
            head: [[th(t('source')), th(t('ss')), th(t('df')), th(t('ms')), th(t('f')), th(t('sig')), ...etaHead]],
            body,
            footnotes: [measureLayer, { mark: '', text: t('average') }],
          },
          NAME,
        ),
      );
    } else {
      const span = (label: string) => (j: number) => (j === 0 ? [th(label, { rowspan: k })] : []);
      const dvCell = (j: number, sup?: string) => th(dvs[j].v.label || dvs[j].v.name, sup ? { sup } : {});
      dvs.forEach((_, j) => {
        const r2 = Hmodel[j][j] / Ctot[j][j];
        const adj = 1 - ((1 - r2) * (N - 1)) / dfE;
        const mark = notes.mark(t('rSquared', { r2: F3(r2), adj: F3(adj) }));
        body.push(row([...span(t('correctedModel'))(j), dvCell(j, mark)], Hmodel[j][j], dfModel, true, E[j][j]));
      });
      for (const s of sources) dvs.forEach((_, j) => body.push(row([...span(s.name)(j), dvCell(j)], s.H[j][j], s.df, true, E[j][j])));
      dvs.forEach((_, j) => body.push(row([...span(t('errorRow'))(j), dvCell(j)], E[j][j], dfE, false, E[j][j])));
      dvs.forEach((_, j) => body.push(row([...span(t('totalRow'))(j), dvCell(j)], Ytot[j][j], N, false, E[j][j])));
      dvs.forEach((_, j) => body.push(row([...span(t('correctedTotal'))(j), dvCell(j)], Ctot[j][j], N - 1, false, E[j][j])));
      out.push(
        tableItem(
          {
            caption: t('bsEffects'),
            head: [[th(t('source')), th(t('dependentVariable')), th(t('ss')), th(t('df')), th(t('ms')), th(t('f')), th(t('sig')), ...etaHead]],
            body,
            footnotes: notes.list,
          },
          NAME,
        ),
      );
    }
  }

  // ---------- Parameter Estimates
  const conf = 100 * (1 - spec.alpha);
  if (spec.print.parameter) {
    const notes = new Notes();
    const names: string[] = [t('intercept')];
    for (const e of spec.effects) {
      let labs = [''];
      for (const n of e) {
        const fi = fIdx(n);
        const parts = fi >= 0 ? factors[fi].levels.map((l) => `[${n}=${l}]`) : [n];
        labs = labs.flatMap((a) => parts.map((p) => (a ? `${a} * ${p}` : p)));
      }
      names.push(...labs);
    }
    const tq = tInv(1 - spec.alpha / 2, dfE);
    const body: Cell[][] = [];
    dvs.forEach((d, j) => {
      names.forEach((pn, c) => {
        const stub = [...(c === 0 ? [th(d.v.label || d.v.name, { rowspan: names.length })] : []), th(pn)];
        if (par.aliased[c]) {
          body.push([...stub, td('0', { sup: notes.mark(t('redundant')) }), td(''), td(''), td(''), td(''), td(''), ...(spec.print.etasq ? [td('')] : [])]);
          return;
        }
        const b = par.B[c][j];
        const se = Math.sqrt(par.G[c][c] * S[j][j]);
        const tv = b / se;
        body.push([...stub, td(F3(b)), td(F3(se)), td(F3(tv)), td(F3(tTwoTail(tv, dfE))), td(F3(b - tq * se)), td(F3(b + tq * se)), ...(spec.print.etasq ? [td(F3((tv * tv) / (tv * tv + dfE)))] : [])]);
      });
    });
    out.push(
      tableItem(
        {
          caption: t('params'),
          head: [
            [th(t('dependentVariable'), { rowspan: 2 }), th(t('parameter'), { rowspan: 2 }), th(t('b'), { rowspan: 2 }), th(t('se'), { rowspan: 2 }), th(t('t'), { rowspan: 2 }), th(t('sig'), { rowspan: 2 }), th(t('ci', { level: conf }), { colspan: 2 }), ...(spec.print.etasq ? [th(t('eta'), { rowspan: 2 })] : [])],
            [th(t('lower')), th(t('upper'))],
          ],
          body,
          footnotes: notes.list,
        },
        NAME,
      ),
    );
  }

  // ---------- Estimated Marginal Means
  if (spec.emmeans.length) {
    const emmItems: OutputItem[] = [];
    // X'WX of the indicator model (for estimability)
    const XtX = Array.from({ length: ind.q }, (_, i) => ind.C[i].slice(0, ind.q));
    const GX = par.G.map((r) => XtX[0].map((_, j) => r.reduce((s, x, c) => s + x * XtX[c][j], 0)));
    const lvec = (assign: Map<string, number>): number[] => {
      const l = [1];
      for (const e of spec.effects) {
        let v = [1];
        for (const n of e) {
          const fi = fIdx(n);
          let c: number[];
          if (fi >= 0) {
            const L = factors[fi].levels.length;
            const a = assign.get(n);
            c = Array.from({ length: L }, (_, z) => (a === undefined ? 1 / L : z === a ? 1 : 0));
          } else c = [covMean[cIdx(n)]];
          const nv: number[] = [];
          for (const x of v) for (const y of c) nv.push(x * y);
          v = nv;
        }
        l.push(...v);
      }
      return l;
    };
    const estimable = (l: number[]) => {
      const lh = XtX[0].map((_, j) => l.reduce((s, x, c) => s + x * GX[c][j], 0));
      const sc = Math.max(1, ...l.map(Math.abs));
      return lh.every((x, j) => Math.abs(x - l[j]) < 1e-6 * sc);
    };
    const mvec = (assign: Map<string, number>): number[] =>
      isRM ? kronAll(spec.ws.map((f) => Array.from({ length: f.levels }, (_, z) => [assign.has(f.name) ? (z === assign.get(f.name) ? 1 : 0) : 1 / f.levels]))).map((r) => r[0]) : [];
    const est = (l: number[], m: number[]) => {
      const lb = par.B.map((r) => r.reduce((s, x, j) => s + x * m[j], 0));
      const value = l.reduce((s, x, c) => s + x * lb[c], 0);
      const v = qform(l, par.G) * qform(m, S);
      return { value, se: Math.sqrt(Math.max(0, v)) };
    };
    const covNote = cov.length ? t('covAt', { list: cov.map((c, i) => `${c.v.label || c.v.name} = ${fmt(covMean[i], 2, ctx)}`).join(', ') }) : null;
    const tq = tInv(1 - spec.alpha / 2, dfE);
    const isWithin = (n: string) => wsNames.includes(n);
    const levelsOf = (n: string) => (isWithin(n) ? spec.ws.find((f) => f.name === n)!.levels : factors[fIdx(n)].levels.length);
    const levelLabel = (n: string, li: number) => (isWithin(n) ? String(li + 1) : levelName(fIdx(n), li));
    // per dependent variable (MANOVA) or one measure (RM)
    const targets = isRM ? [{ label: '', m: null as number[] | null }] : dvs.map((d, j) => ({ label: d.v.label || d.v.name, m: Array.from({ length: k }, (_, z) => (z === j ? 1 : 0)) }));
    for (const req of spec.emmeans) {
      const notes = new Notes();
      const term = req.term;
      const combos: number[][] = term.reduce((acc, n) => acc.flatMap((a) => Array.from({ length: levelsOf(n) }, (_, li) => [...a, li])), [[]] as number[][]);
      const caption = term.length ? (req.compare ? t('estimates') : term.join(' * ')) : t('grandMean');
      const body: Cell[][] = [];
      for (const tg of targets) {
        combos.forEach((c, ci) => {
          const assign = new Map(term.map((n, z) => [n, c[z]]));
          const bAssign = new Map([...assign].filter(([n]) => !isWithin(n)));
          const l = lvec(bAssign);
          const m = tg.m ?? mvec(new Map([...assign].filter(([n]) => isWithin(n))));
          const ok = estimable(l);
          const r = est(l, m);
          const stub: Cell[] = [];
          if (tg.label && ci === 0) stub.push(th(tg.label, { rowspan: combos.length }));
          c.forEach((li, z) => {
            const first = ci === 0 || combos[ci - 1].slice(0, z + 1).some((x, y) => x !== c[y]);
            if (!first) return;
            let sp = 1;
            while (ci + sp < combos.length && combos[ci + sp].slice(0, z + 1).every((x, y) => x === c[y])) sp++;
            stub.push(th(levelLabel(term[z], li), { rowspan: sp }));
          });
          const mk = ok ? undefined : notes.mark(t('notEstimable'));
          body.push([...stub, td(ok ? F3(r.value) : '.', { sup: mk }), td(ok ? F3(r.se) : '.'), td(ok ? F3(r.value - tq * r.se) : '.'), td(ok ? F3(r.value + tq * r.se) : '.')]);
        });
      }
      const covMark = covNote ? notes.mark(covNote) : undefined;
      const tbl = tableItem(
        {
          caption,
          head: [
            [...(targets[0].label ? [th(t('dependentVariable'), { rowspan: 2 })] : []), ...term.map((n) => th(n, { rowspan: 2 })), th(t('mean'), { rowspan: 2, sup: covMark }), th(t('se'), { rowspan: 2 }), th(t('ci', { level: conf }), { colspan: 2 })],
            [th(t('lower')), th(t('upper'))],
          ],
          body,
          footnotes: [...(isRM ? [measureLayer] : []), ...notes.list],
        },
        NAME,
      );
      const items: OutputItem[] = [tbl];
      if (req.compare) items.push(pairwise(req, term, targets));
      emmItems.push(term.length ? groupItem(term.join(' * '), NAME, items) : groupItem(t('grandMean'), NAME, items));
    }
    out.push(groupItem(t('emm'), NAME, emmItems));

    // pairwise comparisons of REQ.compare within each combination of the other factors
    function pairwise(req: EmmRequest, term: string[], targets: { label: string; m: number[] | null }[]): OutputItem {
      const notes = new Notes();
      const F = req.compare!;
      const others = term.filter((n) => n !== F);
      const LF = levelsOf(F);
      const nc = (LF * (LF - 1)) / 2;
      const outer: number[][] = others.reduce((acc, n) => acc.flatMap((a) => Array.from({ length: levelsOf(n) }, (_, li) => [...a, li])), [[]] as number[][]);
      const alphaAdj = req.adj === 'BONFERRONI' ? spec.alpha / nc : req.adj === 'SIDAK' ? 1 - Math.pow(1 - spec.alpha, 1 / nc) : spec.alpha;
      const tqA = tInv(1 - alphaAdj / 2, dfE);
      const adjNote = t(req.adj === 'BONFERRONI' ? 'adjBonferroni' : req.adj === 'SIDAK' ? 'adjSidak' : 'adjLsd');
      const body: Cell[][] = [];
      const rowsPerTarget = outer.length * LF * (LF - 1);
      const sigMarkText = t('diffSig', { alpha: fmt(spec.alpha, 2, ctx) });
      let anySig = false;
      const adjMark = notes.mark(adjNote);
      for (const tg of targets) {
        let first = true;
        outer.forEach((o) => {
          const assignFor = (li: number) => {
            const a = new Map<string, number>(others.map((n, z) => [n, o[z]]));
            a.set(F, li);
            return a;
          };
          const lm = (li: number) => {
            const a = assignFor(li);
            const l = lvec(new Map([...a].filter(([n]) => !isWithin(n))));
            const m = tg.m ?? mvec(new Map([...a].filter(([n]) => isWithin(n))));
            return { l, m };
          };
          for (let i = 0; i < LF; i++) {
            for (let j = 0; j < LF; j++) {
              if (i === j) continue;
              const a = lm(i);
              const b = lm(j);
              const dl = a.l.map((x, z) => x - b.l[z]);
              const dm = a.m.map((x, z) => x - b.m[z]);
              const within = isWithin(F);
              const diff = est(a.l, a.m).value - est(b.l, b.m).value;
              const v = within ? qform(a.l, par.G) * qform(dm, S) : qform(dl, par.G) * qform(a.m, S);
              const se = Math.sqrt(Math.max(0, v));
              const ok = estimable(a.l) && estimable(b.l);
              const tv = diff / se;
              const p0 = tTwoTail(Math.abs(tv), dfE);
              const p = req.adj === 'BONFERRONI' ? Math.min(1, p0 * nc) : req.adj === 'SIDAK' ? 1 - Math.pow(1 - p0, nc) : p0;
              const sig = ok && p < spec.alpha;
              if (sig) anySig = true;
              const stub: Cell[] = [];
              if (tg.label && first) stub.push(th(tg.label, { rowspan: rowsPerTarget }));
              first = false;
              if (others.length && i === 0 && j === 1) {
                o.forEach((li, z) => stub.push(th(levelLabel(others[z], li), { rowspan: LF * (LF - 1) })));
              }
              if (j === (i === 0 ? 1 : 0)) stub.push(th(levelLabel(F, i), { rowspan: LF - 1 }));
              stub.push(th(levelLabel(F, j)));
              body.push([...stub, td(ok ? F3(diff) : '.', sig ? { sup: '*' } : {}), td(ok ? F3(se) : '.'), td(ok ? F3(p) : '.'), td(ok ? F3(diff - tqA * se) : '.'), td(ok ? F3(diff + tqA * se) : '.')]);
            }
          }
        });
      }
      const foot = [...(isRM ? [measureLayer] : []), { mark: '', text: t('basedOnEmm') }];
      if (anySig) foot.push({ mark: '*', text: sigMarkText });
      foot.push(...notes.list);
      return tableItem(
        {
          caption: t('pairwise'),
          head: [
            [
              ...(targets[0].label ? [th(t('dependentVariable'), { rowspan: 2 })] : []),
              ...others.map((n) => th(n, { rowspan: 2 })),
              th(t('iCol', { name: F }), { rowspan: 2 }),
              th(t('jCol', { name: F }), { rowspan: 2 }),
              th(t('meanDiff'), { rowspan: 2 }),
              th(t('se'), { rowspan: 2 }),
              th(t('sig'), { rowspan: 2, sup: adjMark }),
              th(t('ciDiff', { level: conf }), { colspan: 2, sup: adjMark }),
            ],
            [th(t('lower')), th(t('upper'))],
          ],
          body,
          footnotes: foot,
        },
        NAME,
      );
    }
  }
  return out;
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
