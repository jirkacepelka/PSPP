/*
 * Shared machinery for the categorical-response regressions (PLUM, NOMREG): model effects,
 * SPSS-style dummy design with redundant (aliased) columns, subpopulations, the full and kernel
 * multinomial log-likelihood, link functions and common output tables.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem, Variable } from '../engine/types';
import { variable, isMissing, valueText, varTitle, weights, type Cell } from './data';
import { isKw, varList, type Token } from './parse';
import { chi2Sf, lgamma, normCdf, normInv } from './dist';
import { fmt, fmtN, td, th, tableItem, type Cell as TCell } from './table';
import { ExtError, type ExtContext } from './types';
import { inverse, solve, type Matrix } from './linalg';

export type Value = number | string;

/** A model effect: names of the variables multiplied together (one name = main effect). */
export type Effect = string[];

export interface Column {
  label: string;
  /** index of the effect */
  effect: number;
  redundant: boolean;
}

export interface Pattern {
  /** design row restricted to non-redundant columns */
  x: number[];
  /** weighted case count */
  n: number;
  /** weighted count per dependent category */
  y: number[];
}

export interface ModelData {
  dep: Variable;
  /** observed dependent categories, ascending */
  cats: Value[];
  /** factor variables and their observed levels (ascending) */
  factors: { v: Variable; levels: Value[] }[];
  covariates: Variable[];
  effects: Effect[];
  /** all design columns (redundant ones included), in parameter order */
  columns: Column[];
  /** subpopulations (distinct combinations of predictor values) */
  patterns: Pattern[];
  /** weighted counts */
  nValid: number;
  nMissing: number;
  catCount: number[];
  levelCount: number[][];
  /** ln of the multinomial constant Σ ln(n_i!/Π y_ij!) (full minus kernel log-likelihood) */
  logConst: number;
}

const norm = (v: Variable, x: Cell): Value => (v.type === 'string' ? String(x).trimEnd() : (x as number));
export const cmpValue = (a: Value, b: Value) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** Value as SPSS prints it in parameter labels (print format decimals, SET DECIMAL). */
export function valueCode(v: Variable, x: Value, ctx: Pick<ExtContext, 'decimal'>): string {
  if (typeof x === 'string') return x;
  const d = v.print?.d ?? 0;
  const s = x.toFixed(d);
  return ctx.decimal === ',' ? s.replace('.', ',') : s;
}

/**
 * Head of PLUM/NOMREG: `dep [(options)] [BY factors] [WITH covariates]`. Returns the dependent,
 * the tokens of its parenthesised options, factors and covariates.
 */
export function parseHead(head: Token[], vars: Variable[]): { dep: string; opts: Token[]; factors: string[]; covariates: string[] } {
  const d = varList(head, 0, vars, ['BY', 'WITH']);
  if (d.names.length !== 1) throw new ExtError('Exactly one dependent variable is required.');
  let i = d.next;
  const opts: Token[] = [];
  if (head[i]?.text === '(') {
    for (i++; i < head.length && head[i].text !== ')'; i++) opts.push(head[i]);
    i++;
  }
  let factors: string[] = [];
  let covariates: string[] = [];
  while (i < head.length) {
    if (isKw(head[i], 'BY')) {
      const r = varList(head, i + 1, vars, ['WITH']);
      factors = r.names;
      i = r.next;
    } else if (isKw(head[i], 'WITH')) {
      const r = varList(head, i + 1, vars, ['BY']);
      covariates = r.names;
      i = r.next;
    } else throw new ExtError(`Unexpected '${head[i].text}' in the variable specification.`);
  }
  const all = [d.names[0], ...factors, ...covariates].map((n) => n.toUpperCase());
  if (new Set(all).size !== all.length) throw new ExtError('A variable may appear only once among the dependent variable, factors and covariates.');
  return { dep: d.names[0], opts, factors, covariates };
}

/** Effects of /LOCATION or /MODEL: `a b a*b a BY b`; nesting is not supported. */
export function parseEffects(tokens: Token[] | null, factors: string[], covariates: string[]): Effect[] {
  const def = [...covariates.map((c) => [c]), ...factors.map((f) => [f])];
  if (!tokens || !tokens.length) return def;
  const known = new Map([...factors, ...covariates].map((n) => [n.toUpperCase(), n]));
  const effects: Effect[] = [];
  let cur: string[] = [];
  let join = false;
  const push = () => {
    if (cur.length) effects.push(cur);
    cur = [];
  };
  for (const t of tokens) {
    if (t.text === '(' || t.text === ')' || isKw(t, 'WITHIN')) throw new ExtError('Nested effects are not supported.');
    if (t.text === ',') continue;
    if (t.text === '*' || isKw(t, 'BY')) {
      if (!cur.length) throw new ExtError(`Unexpected '${t.text}' in the model specification.`);
      join = true;
      continue;
    }
    if (t.kind !== 'id') throw new ExtError(`Unexpected '${t.text}' in the model specification.`);
    const name = known.get(t.text.toUpperCase());
    if (!name) throw new ExtError(`${t.text} is not a factor or covariate of the model.`);
    if (join) {
      if (cur.some((c) => c.toUpperCase() === name.toUpperCase())) throw new ExtError(`${name} appears twice in an interaction.`);
      cur.push(name);
      join = false;
    } else {
      push();
      cur = [name];
    }
  }
  if (join) throw new ExtError('Incomplete interaction in the model specification.');
  push();
  const keys = effects.map((e) => e.map((n) => n.toUpperCase()).sort().join('*'));
  if (new Set(keys).size !== keys.length) throw new ExtError('An effect appears more than once in the model.');
  return effects;
}

export interface PrepareOptions {
  dep: string;
  factors: string[];
  covariates: string[];
  effects: Effect[];
  includeUser: boolean;
  /** the model has an intercept-like constant (thresholds or NOMREG intercept) for aliasing */
  constant: boolean;
  /** dependent category order (NOMREG ORDER=DESCENDING) */
  descending?: boolean;
}

/** Listwise selection, dummy design, aliasing and subpopulations for the rows of one split group. */
export function prepare(ds: Dataset, rows: number[], o: PrepareOptions, ctx: Pick<ExtContext, 'decimal'>): ModelData {
  const dep = variable(ds, o.dep);
  const fac = o.factors.map((n) => variable(ds, n));
  const cov = o.covariates.map((n) => variable(ds, n));
  for (const c of cov) if (c.v.type === 'string') throw new ExtError(`${c.v.name} is a string variable; covariates must be numeric.`);
  const w = weights(ds);
  const model = [dep, ...fac, ...cov];
  const valid: number[] = [];
  let nMissing = 0;
  for (const r of rows) {
    if (model.some((m) => isMissing(m.v, m.col[r], o.includeUser))) nMissing += w[r];
    else valid.push(r);
  }
  const uniq = (col: Cell[], v: Variable) => [...new Set(valid.map((r) => norm(v, col[r])))].sort(cmpValue);
  let cats = uniq(dep.col, dep.v);
  if (o.descending) cats = cats.reverse();
  const factors = fac.map((f) => ({ v: f.v, levels: uniq(f.col, f.v) }));
  const catIdx = new Map(cats.map((c, i) => [c, i]));
  const lvlIdx = factors.map((f) => new Map(f.levels.map((l, i) => [l, i])));
  const facPos = new Map(o.factors.map((n, i) => [n.toUpperCase(), i]));
  const covPos = new Map(o.covariates.map((n, i) => [n.toUpperCase(), i]));

  // columns: per effect, all combinations of factor levels (first factor slowest)
  const columns: Column[] = [];
  const colSpec: { fac: [number, number][]; cov: number[] }[] = [];
  o.effects.forEach((e, ei) => {
    const fs = e.filter((n) => facPos.has(n.toUpperCase())).map((n) => facPos.get(n.toUpperCase())!);
    const cs = e.filter((n) => covPos.has(n.toUpperCase())).map((n) => covPos.get(n.toUpperCase())!);
    let combos: number[][] = [[]];
    for (const f of fs) combos = combos.flatMap((c) => factors[f].levels.map((_, l) => [...c, l]));
    for (const combo of combos) {
      const label = e
        .map((n) => {
          const fi = facPos.get(n.toUpperCase());
          if (fi === undefined) return cov[covPos.get(n.toUpperCase())!].v.name;
          const f = factors[fi];
          return `[${f.v.name}=${valueCode(f.v, f.levels[combo[fs.indexOf(fi)]], ctx)}]`;
        })
        .join(' * ');
      columns.push({ label, effect: ei, redundant: false });
      colSpec.push({ fac: fs.map((f, k) => [f, combo[k]]), cov: cs });
    }
  });

  // subpopulations by the values of all predictors
  const byKey = new Map<string, { x: number[]; n: number; y: number[] }>();
  const catCount = new Array(cats.length).fill(0);
  const levelCount = factors.map((f) => new Array(f.levels.length).fill(0));
  let nValid = 0;
  for (const r of valid) {
    const lv = fac.map((f, i) => lvlIdx[i].get(norm(f.v, f.col[r]))!);
    const cv = cov.map((c) => c.col[r] as number);
    const key = JSON.stringify([lv, cv]);
    let p = byKey.get(key);
    if (!p) {
      const x = colSpec.map((s) => (s.fac.every(([f, l]) => lv[f] === l) ? s.cov.reduce((a, c) => a * cv[c], 1) : 0));
      p = { x, n: 0, y: new Array(cats.length).fill(0) };
      byKey.set(key, p);
    }
    const k = catIdx.get(norm(dep.v, dep.col[r]))!;
    p.n += w[r];
    p.y[k] += w[r];
    catCount[k] += w[r];
    lv.forEach((l, i) => (levelCount[i][l] += w[r]));
    nValid += w[r];
  }
  const pats = [...byKey.values()];
  aliasing(pats.map((p) => p.x), pats.map((p) => p.n), o.constant).forEach((red, j) => (columns[j].redundant = red));
  const keep = columns.map((c, j) => (c.redundant ? -1 : j)).filter((j) => j >= 0);
  let logConst = 0;
  for (const p of pats) logConst += lgamma(p.n + 1) - p.y.reduce((s, y) => s + lgamma(y + 1), 0);
  return {
    dep: dep.v,
    cats,
    factors,
    covariates: cov.map((c) => c.v),
    effects: o.effects,
    columns,
    patterns: pats.map((p) => ({ x: keep.map((j) => p.x[j]), n: p.n, y: p.y })),
    nValid,
    nMissing,
    catCount,
    levelCount,
    logConst,
  };
}

/**
 * Columns linearly dependent on earlier ones (and on a leading constant when CONSTANT), by a
 * weighted Gram–Schmidt sweep in column order – the SPSS rule that makes e.g. the last level of
 * a factor redundant.
 */
export function aliasing(rows: number[][], w: number[], constant: boolean, tol = 1e-8): boolean[] {
  const m = rows[0]?.length ?? 0;
  const basis: number[][] = [];
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + w[i] * x * b[i], 0);
  if (constant) basis.push(rows.map(() => 1));
  const out: boolean[] = [];
  for (let j = 0; j < m; j++) {
    const v = rows.map((r) => r[j]);
    const n0 = dot(v, v);
    for (let pass = 0; pass < 2; pass++)
      for (const b of basis) {
        const c = dot(v, b) / dot(b, b);
        for (let i = 0; i < v.length; i++) v[i] -= c * b[i];
      }
    const n1 = dot(v, v);
    const red = n0 === 0 || n1 <= tol * n0;
    out.push(red);
    if (!red) basis.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- link functions

export type LinkName = 'LOGIT' | 'PROBIT' | 'CLOGLOG' | 'NLOGLOG' | 'CAUCHIT';
export interface Link {
  /** P(X ≤ u) */
  cdf(u: number): number;
  /** P(X > u), accurate in the upper tail */
  sf(u: number): number;
  pdf(u: number): number;
  /** derivative of the density */
  dpdf(u: number): number;
  quantile(p: number): number;
}

/** Upper normal tail, accurate far into the tail (continued fraction for the Mills ratio). */
function normSf(z: number): number {
  if (z < 5) return normCdf(-z);
  let f = z;
  for (let k = 60; k >= 1; k--) f = z + k / f;
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) / f;
}

export const LINKS: Record<LinkName, Link> = {
  LOGIT: {
    cdf: (u) => 1 / (1 + Math.exp(-u)),
    sf: (u) => 1 / (1 + Math.exp(u)),
    pdf: (u) => {
      const e = Math.exp(-Math.abs(u));
      return e / ((1 + e) * (1 + e));
    },
    dpdf: (u) => {
      const e = Math.exp(-Math.abs(u));
      const f = e / ((1 + e) * (1 + e));
      const F = 1 / (1 + Math.exp(-u));
      return f * (1 - 2 * F);
    },
    quantile: (p) => Math.log(p / (1 - p)),
  },
  PROBIT: {
    cdf: (u) => (u > 0 ? 1 - normSf(u) : normSf(-u)),
    sf: (u) => (u > 0 ? normSf(u) : 1 - normSf(-u)),
    pdf: (u) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI),
    dpdf: (u) => (-u * Math.exp(-0.5 * u * u)) / Math.sqrt(2 * Math.PI),
    quantile: (p) => normInv(p),
  },
  CLOGLOG: {
    cdf: (u) => -Math.expm1(-Math.exp(u)),
    sf: (u) => Math.exp(-Math.exp(u)),
    pdf: (u) => Math.exp(u - Math.exp(u)),
    dpdf: (u) => Math.exp(u - Math.exp(u)) * (1 - Math.exp(u)),
    quantile: (p) => Math.log(-Math.log1p(-p)),
  },
  NLOGLOG: {
    cdf: (u) => Math.exp(-Math.exp(-u)),
    sf: (u) => -Math.expm1(-Math.exp(-u)),
    pdf: (u) => Math.exp(-u - Math.exp(-u)),
    dpdf: (u) => Math.exp(-u - Math.exp(-u)) * (Math.exp(-u) - 1),
    quantile: (p) => -Math.log(-Math.log(p)),
  },
  CAUCHIT: {
    cdf: (u) => 0.5 + Math.atan(u) / Math.PI,
    sf: (u) => 0.5 - Math.atan(u) / Math.PI,
    pdf: (u) => 1 / (Math.PI * (1 + u * u)),
    dpdf: (u) => (-2 * u) / (Math.PI * (1 + u * u) * (1 + u * u)),
    quantile: (p) => Math.tan(Math.PI * (p - 0.5)),
  },
};

// ---------------------------------------------------------------- criteria

export interface Criteria {
  cin: number;
  delta: number;
  lconverge: number;
  mxiter: number;
  mxstep: number;
  pconverge: number;
  singular: number;
  chksep: number;
}

export function parseCriteria(tokens: Token[] | null): Criteria {
  const c: Criteria = { cin: 95, delta: 0, lconverge: 0, mxiter: 100, mxstep: 5, pconverge: 1e-6, singular: 1e-8, chksep: 20 };
  if (!tokens) return c;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'id') continue;
    const k = t.text.toUpperCase();
    if (k === 'DEFAULT') continue;
    const key = (['CIN', 'DELTA', 'LCONVERGE', 'MXITER', 'MXSTEP', 'PCONVERGE', 'SINGULAR', 'CHKSEP'] as const).find((n) => n === k || (k.length >= 3 && n.startsWith(k)));
    if (!key) throw new ExtError(`Unknown keyword ${t.text} on CRITERIA.`);
    if (tokens[i + 1]?.text !== '(' || tokens[i + 2]?.kind !== 'num' || tokens[i + 3]?.text !== ')') throw new ExtError(`${key} requires a number in parentheses.`);
    const x = tokens[i + 2].value!;
    if (key === 'CIN' && !(x > 0 && x < 100)) throw new ExtError('CIN must be between 0 and 100.');
    if ((key === 'MXITER' || key === 'MXSTEP' || key === 'CHKSEP') && !(x >= 0 && Number.isInteger(x))) throw new ExtError(`${key} must be a non-negative integer.`);
    if (key === 'DELTA' && !(x >= 0 && x <= 1)) throw new ExtError('DELTA must be between 0 and 1.');
    if (x < 0) throw new ExtError(`${key} must not be negative.`);
    c[key.toLowerCase() as keyof Criteria] = x;
    i += 3;
  }
  return c;
}

/** Adds DELTA to empty cells (SPSS CRITERIA DELTA). */
export function applyDelta(md: ModelData, delta: number) {
  if (delta > 0)
    for (const p of md.patterns)
      p.y.forEach((y, j) => {
        if (y === 0) {
          p.y[j] = delta;
          p.n += delta;
        }
      });
}

// ---------------------------------------------------------------- shared output

export interface Fit {
  /** kernel log-likelihood */
  ll: number;
  converged: boolean;
  iterations: number;
  stepFailed: boolean;
  /** fitted probabilities per pattern × category */
  probs: number[][];
}

/** Pearson and deviance statistics over subpopulations × categories. */
export function goodness(md: ModelData, probs: number[][]): { pearson: number; deviance: number; zeroCells: number; cells: number } {
  let pearson = 0;
  let deviance = 0;
  let zeroCells = 0;
  md.patterns.forEach((p, i) =>
    p.y.forEach((y, j) => {
      const e = p.n * probs[i][j];
      if (e > 0) pearson += ((y - e) * (y - e)) / e;
      if (y > 0) deviance += 2 * y * Math.log(y / e);
      if (y === 0) zeroCells++;
    }),
  );
  return { pearson, deviance, zeroCells, cells: md.patterns.length * md.cats.length };
}

export const pseudoR2 = (ll0: number, ll1: number, n: number) => {
  const cs = 1 - Math.exp((2 * (ll0 - ll1)) / n);
  return { coxSnell: cs, nagelkerke: cs / (1 - Math.exp((2 * ll0) / n)), mcfadden: 1 - ll1 / ll0 };
};

const pct = (x: number, tot: number, ctx: ExtContext) => (tot > 0 ? `${fmt((100 * x) / tot, 1, ctx)}%` : '');

/** Case Processing Summary (dependent categories, factor levels, valid, missing, total). */
export function cpsTable(md: ModelData, ctx: ExtContext, p: string, name: string, extra: TCell[][] = [], footnotes: string[] = []): OutputItem {
  const body: TCell[][] = [];
  const block = (v: Variable, levels: Value[], counts: number[]) =>
    levels.forEach((l, i) =>
      body.push([...(i === 0 ? [th(varTitle(v), { rowspan: levels.length })] : []), th(valueText(v, l)), td(fmtN(counts[i], ctx)), td(pct(counts[i], md.nValid, ctx))]),
    );
  block(md.dep, md.cats, md.catCount);
  md.factors.forEach((f, i) => block(f.v, f.levels, md.levelCount[i]));
  body.push([th(ctx.t(`${p}.valid`), { colspan: 2 }), td(fmtN(md.nValid, ctx)), td(md.nValid > 0 ? `${fmt(100, 1, ctx)}%` : '')]);
  body.push([th(ctx.t(`${p}.missing`), { colspan: 2 }), td(fmtN(md.nMissing, ctx)), td('')]);
  body.push([th(ctx.t(`${p}.total`), { colspan: 2 }), td(fmtN(md.nValid + md.nMissing, ctx)), td('')]);
  body.push(...extra);
  return tableItem({ caption: ctx.t(`${p}.cps`), head: [[th('', { colspan: 2 }), th(ctx.t(`${p}.n`)), th(ctx.t(`${p}.marginal`))]], body, footnotes }, name);
}

/** Model Fitting Information: −2LL of the null and final models and the LR chi-square. */
export function mfiTable(ctx: ExtContext, p: string, name: string, nullLabel: string, m2ll0: number, m2ll1: number, df: number, grouped: boolean, footnotes: string[] = []): OutputItem {
  const chi = m2ll0 - m2ll1;
  const cols = [th(ctx.t(`${p}.m2ll`)), th(ctx.t(`${p}.chisq`)), th(ctx.t(`${p}.df`)), th(ctx.t(`${p}.sig`))];
  return tableItem(
    {
      caption: ctx.t(`${p}.mfi`),
      head: grouped
        ? [[th(ctx.t(`${p}.model`), { rowspan: 2 }), th(ctx.t(`${p}.criteria`)), th(ctx.t(`${p}.lrt`), { colspan: 3 })], cols]
        : [[th(ctx.t(`${p}.model`)), ...cols]],
      body: [
        [th(nullLabel), td(fmt(m2ll0, 3, ctx)), td(''), td(''), td('')],
        [th(ctx.t(`${p}.final`)), td(fmt(m2ll1, 3, ctx)), td(fmt(chi, 3, ctx)), td(String(df)), td(df > 0 ? fmt(chiP(chi, df), 3, ctx) : '')],
      ],
      footnotes,
    },
    name,
  );
}

export const chiP = (x: number, df: number) => chi2Sf(Math.max(0, x), df);

export function gofTable(ctx: ExtContext, p: string, name: string, g: { pearson: number; deviance: number }, df: number, footnotes: string[] = []): OutputItem {
  const row = (label: string, x: number) => [th(label), td(fmt(x, 3, ctx)), td(String(df)), td(df > 0 ? fmt(chiP(x, df), 3, ctx) : '')];
  return tableItem(
    {
      caption: ctx.t(`${p}.gof`),
      head: [[th(''), th(ctx.t(`${p}.chisq`)), th(ctx.t(`${p}.df`)), th(ctx.t(`${p}.sig`))]],
      body: [row(ctx.t(`${p}.pearson`), g.pearson), row(ctx.t(`${p}.deviance`), g.deviance)],
      footnotes,
    },
    name,
  );
}

export function pseudoTable(ctx: ExtContext, p: string, name: string, r: ReturnType<typeof pseudoR2>, footnotes: string[] = []): OutputItem {
  return tableItem(
    {
      caption: ctx.t(`${p}.pseudo`),
      head: [],
      body: [
        [th(ctx.t(`${p}.coxSnell`)), td(fmt(r.coxSnell, 3, ctx))],
        [th(ctx.t(`${p}.nagelkerke`)), td(fmt(r.nagelkerke, 3, ctx))],
        [th(ctx.t(`${p}.mcfadden`)), td(fmt(r.mcfadden, 3, ctx))],
      ],
      footnotes,
    },
    name,
  );
}

/** Superscript footnote marker for the I-th footnote (a, b, c …) as plain text. */
export const mark = (i: number) => ['ᵃ', 'ᵇ', 'ᶜ', 'ᵈ', 'ᵉ', 'ᶠ'][i] ?? '';

/** Log-likelihood ready for display: full (default) or kernel (PRINT=KERNEL). */
export const m2ll = (md: ModelData, ll: number, kernel: boolean) => -2 * (kernel ? ll : ll + md.logConst);

// ---------------------------------------------------------------- Newton–Raphson

export interface Eval {
  ok: boolean;
  /** kernel log-likelihood */
  ll: number;
  g?: number[];
  /** observed Hessian of the log-likelihood (negative definite at a maximum) */
  H?: Matrix;
  /** expected information, used when the observed Hessian is not negative definite */
  info?: () => Matrix;
}

export interface NewtonResult {
  params: number[];
  ll: number;
  converged: boolean;
  iterations: number;
  stepFailed: boolean;
  /** stopped because no ascent direction could be computed */
  singular: boolean;
  history: { iter: number; ll: number; halvings: number; params: number[] }[];
  H: Matrix;
}

/** Newton–Raphson (Fisher scoring fallback) with step halving and SPSS-style convergence. */
export function newton(f: (b: number[], deriv: boolean) => Eval, start: number[], crit: Criteria): NewtonResult {
  let b = [...start];
  let e = f(b, true);
  if (!e.ok) throw new ExtError('Invalid starting values.');
  const history: NewtonResult['history'] = [{ iter: 0, ll: e.ll, halvings: 0, params: [...b] }];
  let converged = false;
  let stepFailed = false;
  let singular = false;
  let it = 0;
  while (it < crit.mxiter) {
    const g = e.g!;
    let delta: number[] | null = null;
    const negH = e.H!.map((r) => r.map((x) => -x));
    delta = solve(negH, g);
    const bad = (d: number[] | null) => !d || d.some((x) => !Number.isFinite(x)) || dotv(d, g) <= 0;
    if (bad(delta) && e.info) delta = solve(e.info(), g);
    if (bad(delta)) {
      // singular (e.g. separation): a slightly ridged step keeps moving along the free direction
      const scale = Math.max(1e-300, ...negH.map((r, i) => Math.abs(r[i])));
      delta = solve(negH.map((r, i) => r.map((x, j) => (i === j ? x + 1e-8 * scale : x))), g);
    }
    if (!delta || bad(delta)) {
      singular = true;
      break;
    }
    const step = delta;
    let lambda = 1;
    let accepted: { b: number[]; e: Eval } | null = null;
    let halvings = 0;
    for (; halvings <= crit.mxstep; halvings++) {
      const nb = b.map((x, i) => x + lambda * step[i]);
      const ne = f(nb, false);
      if (ne.ok && ne.ll >= e.ll - 1e-10 * Math.abs(e.ll)) {
        accepted = { b: nb, e: ne };
        break;
      }
      lambda /= 2;
    }
    if (!accepted) {
      stepFailed = true;
      break;
    }
    it++;
    const change = Math.max(0, ...accepted.b.map((x, i) => Math.abs(x - b[i])));
    const llOld = e.ll;
    b = accepted.b;
    e = f(b, true);
    history.push({ iter: it, ll: e.ll, halvings, params: [...b] });
    const lconv = crit.lconverge > 0 && Math.abs(e.ll - llOld) <= crit.lconverge * Math.abs(llOld);
    if (change < crit.pconverge || lconv || change === 0) {
      converged = true;
      break;
    }
  }
  return { params: b, ll: e.ll, converged, iterations: it, stepFailed, singular, history, H: e.H! };
}

const dotv = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Covariance −H⁻¹, or null when H is singular (relative pivot below SINGULAR). */
export function covariance(H: Matrix, singular: number): Matrix | null {
  const n = H.length;
  if (!n) return [];
  const d = H.map((r, i) => -r[i]);
  if (d.some((x) => !(x > 0))) return null;
  const s = d.map(Math.sqrt);
  const scaled = H.map((r, i) => r.map((x, j) => -x / (s[i] * s[j])));
  const inv = inverse(scaled, singular);
  if (!inv) return null;
  const cov = inv.map((r, i) => r.map((x, j) => x / (s[i] * s[j])));
  return cov.some((r, i) => !(r[i] > 0)) ? null : cov;
}
