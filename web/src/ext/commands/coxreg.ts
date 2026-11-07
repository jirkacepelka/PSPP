/*
 * COXREG – Cox proportional hazards regression (SPSS syntax and output layout).
 *
 *   COXREG survvar [WITH covariates]
 *     /STATUS=statusvar[(EVENT)](values | lo THRU hi)
 *     /METHOD=ENTER [varlist]          (repeatable: one block per METHOD; FSTEP/BSTEP not available)
 *     /CATEGORICAL=varlist
 *     /CONTRAST(var)=INDICATOR[(refcat)] | DEVIATION[(refcat)] | SIMPLE[(refcat)]   (default INDICATOR, last)
 *     /STRATA=var
 *     /PRINT=[DEFAULT] [SUMMARY] [CI(95)] [BASELINE] [CORR] [ALL]
 *     /CRITERIA=[BCON(1E-4)] [LCON(1E-5)] [ITERATE(20)]
 *     /PLOT=[NONE] [SURVIVAL] [HAZARD] [LML] [OMS]
 *     /PATTERN=var(value) … [BY categorical]
 *     /MISSING=[EXCLUDE|INCLUDE]   /SAVE /OUTFILE (ignored with a warning)
 *
 * Model (IBM SPSS Statistics Algorithms, "COXREG"), Breslow approximation for ties, strata s,
 * frequency weights w, distinct event times t_j with d_j = Σ w over the events at t_j:
 *   ln L(β)   = Σ_s Σ_j [ Σ_{i∈D_j} w_i x_i'β − d_j ln S0_j ],  S0_j = Σ_{l∈R_j} w_l exp(x_l'β)
 *   U(β)      = Σ_s Σ_j [ Σ_{i∈D_j} w_i x_i − d_j S1_j / S0_j ]
 *   I(β)      = Σ_s Σ_j d_j [ S2_j / S0_j − S1_j S1_j' / S0_j² ]
 *   Newton–Raphson from β = 0 with step halving; converged when max |Δβ| < BCON (or the relative
 *   change of ln L < LCON when LCON is given); covariance I(β̂)⁻¹.
 *   Overall (score) χ² = U(0)' I(0)⁻¹ U(0); change χ² = −2 ln L(previous) + 2 ln L(β̂).
 *   Wald = B² / SE² (multi-column categorical variable: b' V⁻¹ b with df = columns).
 *   Baseline (x = 0) cumulative hazard (Breslow):  H0(t) = Σ_{t_j ≤ t} d_j / S0_j(β̂)
 *   At covariates z:  H(t|z) = exp(z'β̂) H0(t),  S(t|z) = exp(−H(t|z)),
 *     SE(S) = S · sqrt( Σ_{t_j≤t} d_j e² / S0_j² + h'Vh ),  e = exp(z'β̂),
 *     h = Σ_{t_j≤t} d_j e (z − S1_j/S0_j) / S0_j      (delta method, Tsiatis 1981).
 * Computation uses covariates centred at their means (ln L is unchanged by centring).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem, Variable } from '../../engine/types';
import { isMissing, requireNumeric, splitGroups, valueText, variable, varTitle, weights, type Cell } from '../data';
import { chi2Sf, normInv } from '../dist';
import { inverse, type Matrix } from '../linalg';
import { isKw, keywords, kwArg, sub, varList, type ParsedCommand } from '../parse';
import { chartItem, fmt, fmtN, fmtP, groupItem, messageItem, tableItem, td, textItem, th, type Cell as TCell } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';
import { aliasing, cmpValue, covariance, newton, type Criteria, type Eval } from '../catmodel';
import { parseStatus, type EventSpec } from './km';

const NAME = 'COXREG';
const P = 'ext.coxreg';

/* ---------------------------------------------------------------- maths */

export interface CoxCase {
  t: number;
  event: boolean;
  w: number;
  /** design row (all columns) */
  x: number[];
}

export interface CoxData {
  /** per stratum, cases sorted by time descending */
  strata: CoxCase[][];
  /** weighted means of the design columns over all analysis cases */
  means: number[];
}

/** Centred design rows (x − mean) restricted to the columns COLS. */
function centred(d: CoxData, cols: number[]): { t: number; event: boolean; w: number; x: number[] }[][] {
  return d.strata.map((s) => s.map((c) => ({ t: c.t, event: c.event, w: c.w, x: cols.map((j) => c.x[j] - d.means[j]) })));
}

/** Breslow partial log-likelihood, score and Hessian for the columns COLS at BETA. */
export function coxEval(d: CoxData, cols: number[], beta: number[], deriv: boolean): Eval {
  const k = cols.length;
  let ll = 0;
  const g = new Array(k).fill(0);
  const H: Matrix = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const s of centred(d, cols)) {
    const eta = s.map((c) => c.x.reduce((a, x, j) => a + x * beta[j], 0));
    const m = Math.max(0, ...eta);
    let S0 = 0;
    const S1 = new Array(k).fill(0);
    const S2: Matrix = deriv ? Array.from({ length: k }, () => new Array(k).fill(0)) : [];
    for (let i = 0; i < s.length; ) {
      let j = i;
      let dw = 0;
      const sx = new Array(k).fill(0);
      let se = 0;
      while (j < s.length && s[j].t === s[i].t) {
        const c = s[j];
        const r = c.w * Math.exp(eta[j] - m);
        S0 += r;
        if (deriv)
          for (let a = 0; a < k; a++) {
            S1[a] += r * c.x[a];
            for (let b = 0; b <= a; b++) S2[a][b] += r * c.x[a] * c.x[b];
          }
        if (c.event) {
          dw += c.w;
          se += c.w * eta[j];
          for (let a = 0; a < k; a++) sx[a] += c.w * c.x[a];
        }
        j++;
      }
      if (dw > 0) {
        ll += se - dw * (Math.log(S0) + m);
        if (deriv)
          for (let a = 0; a < k; a++) {
            g[a] += sx[a] - (dw * S1[a]) / S0;
            for (let b = 0; b <= a; b++) {
              const h = -dw * (S2[a][b] / S0 - (S1[a] * S1[b]) / (S0 * S0));
              H[a][b] += h;
              if (a !== b) H[b][a] += h;
            }
          }
      }
      i = j;
    }
  }
  return { ok: Number.isFinite(ll), ll, g: deriv ? g : undefined, H: deriv ? H : undefined };
}

export interface CoxFit {
  cols: number[];
  beta: number[];
  ll: number;
  /** ln L at β = 0 */
  ll0: number;
  /** score test of all coefficients at β = 0 (null when I(0) is singular) */
  score: number | null;
  cov: Matrix | null;
  converged: boolean;
  iterations: number;
  /** coefficients whose estimates diverge (monotone partial likelihood) */
  diverging: number[];
}

export function coxFit(d: CoxData, cols: number[], crit: Pick<Criteria, 'mxiter' | 'pconverge' | 'lconverge' | 'mxstep' | 'singular'>): CoxFit {
  const k = cols.length;
  const f = (b: number[], deriv: boolean) => coxEval(d, cols, b, deriv);
  const e0 = f(new Array(k).fill(0), true);
  if (!k) return { cols, beta: [], ll: e0.ll, ll0: e0.ll, score: null, cov: [], converged: true, iterations: 0, diverging: [] };
  const negH0 = e0.H!.map((r) => r.map((x) => -x));
  const inv0 = inverse(negH0, 1e-12);
  const score = inv0 ? e0.g!.reduce((s, x, a) => s + x * inv0[a].reduce((t, y, b) => t + y * e0.g![b], 0), 0) : null;
  const full: Criteria = { cin: 95, delta: 0, chksep: 0, ...crit };
  let r = newton(f, new Array(k).fill(0), full);
  const { iterations, converged } = r;
  // one more Newton step after convergence: the reported estimates are then accurate to ~BCON²
  if (r.converged) r = newton(f, r.params, { ...full, mxiter: 1, pconverge: 0, lconverge: 0 });
  const beta = r.params;
  const cov = covariance(r.H, crit.singular);
  // monotone likelihood: moving a coefficient further in its own direction does not lower ln L
  const diverging: number[] = [];
  beta.forEach((b, j) => {
    if (Math.abs(b) < 1) return;
    const nb = [...beta];
    nb[j] += 5 * Math.sign(b);
    const e = f(nb, false);
    if (e.ok && e.ll >= r.ll - 1e-9 * Math.max(1, Math.abs(r.ll))) diverging.push(j);
  });
  return { cols, beta, ll: r.ll, ll0: e0.ll, score, cov, converged, iterations, diverging };
}

export interface BaselineRow {
  t: number;
  /** baseline (x = 0) cumulative hazard */
  h0: number;
  /** at the covariate values z: survival, its SE and cumulative hazard */
  s: number;
  se: number;
  h: number;
}

/** Breslow cumulative hazard per stratum at x = 0 and at Z (default: the covariate means). */
export function coxBaseline(d: CoxData, fit: CoxFit, z?: number[]): BaselineRow[][] {
  const { cols, beta, cov } = fit;
  const k = cols.length;
  const zc = cols.map((j, a) => (z ? z[a] : d.means[j]) - d.means[j]);
  const e = Math.exp(zc.reduce((s, x, a) => s + x * beta[a], 0));
  const toZero = Math.exp(-cols.reduce((s, j, a) => s + d.means[j] * beta[a], 0));
  return centred(d, cols).map((s) => {
    const eta = s.map((c) => c.x.reduce((a, x, j) => a + x * beta[j], 0));
    let S0 = 0;
    const S1 = new Array(k).fill(0);
    const ev: { t: number; d: number; S0: number; S1: number[] }[] = [];
    for (let i = 0; i < s.length; ) {
      let j = i;
      let dw = 0;
      while (j < s.length && s[j].t === s[i].t) {
        const r = s[j].w * Math.exp(eta[j]);
        S0 += r;
        for (let a = 0; a < k; a++) S1[a] += r * s[j].x[a];
        if (s[j].event) dw += s[j].w;
        j++;
      }
      if (dw > 0) ev.push({ t: s[i].t, d: dw, S0, S1: [...S1] });
      i = j;
    }
    ev.reverse();
    let H = 0;
    let v1 = 0;
    const h = new Array(k).fill(0);
    return ev.map((x) => {
      H += (x.d * e) / x.S0;
      v1 += (x.d * e * e) / (x.S0 * x.S0);
      for (let a = 0; a < k; a++) h[a] += (x.d * e * (zc[a] - x.S1[a] / x.S0)) / x.S0;
      const q = cov ? h.reduce((sum, ha, a) => sum + ha * cov[a].reduce((t, c, b) => t + c * h[b], 0), 0) : NaN;
      const S = Math.exp(-H);
      return { t: x.t, h0: (H / e) * toZero, s: S, se: S * Math.sqrt(v1 + q), h: H };
    });
  });
}

/* -------------------------------------------------------------- parsing */

type Contrast = { kind: 'INDICATOR' | 'DEVIATION' | 'SIMPLE'; ref: number | null };
type PlotKind = 'survival' | 'hazard' | 'lml' | 'oms';

interface Pattern {
  values: Map<string, number | string>;
  by: string | null;
}

interface Options {
  time: string;
  status: string;
  event: EventSpec;
  strata: string | null;
  blocks: string[][];
  covariates: string[];
  categorical: Set<string>;
  contrasts: Map<string, Contrast>;
  ci: number | null;
  baseline: boolean;
  corr: boolean;
  summaryOnly: boolean;
  plots: PlotKind[];
  patterns: Pattern[];
  includeUser: boolean;
  crit: { mxiter: number; pconverge: number; lconverge: number; mxstep: number; singular: number };
  warnings: string[];
}

const KNOWN = ['STATUS', 'STRATA', 'CATEGORICAL', 'CONTRAST', 'METHOD', 'MISSING', 'PRINT', 'CRITERIA', 'PLOT', 'PATTERN', 'OUTFILE', 'SAVE', 'EXTERNAL'];
const matches = (name: string, k: string) => k === name || (name.length >= 3 && k.startsWith(name));

function parseOptions(cmd: ParsedCommand, ctx: ExtContext): Options {
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const vars = ctx.dataset.variables;
  const up = (n: string) => n.toUpperCase();
  for (const s of cmd.subs) if (!KNOWN.some((k) => matches(s.name, k))) throw new ExtError(t('errSub', { name: s.name }));
  const head = varList(cmd.head, 0, vars, ['WITH']);
  if (head.names.length !== 1) throw new ExtError(t('errTime'));
  let withVars: string[] = [];
  if (isKw(cmd.head[head.next], 'WITH')) {
    const r = varList(cmd.head, head.next + 1, vars);
    if (r.next !== cmd.head.length) throw new ExtError(t('errInteraction'));
    withVars = r.names;
  } else if (head.next !== cmd.head.length) throw new ExtError(t('errTime'));

  const st = sub(cmd, 'STATUS');
  if (!st) throw new ExtError(t('errStatusMissing'));
  const { status, event } = parseStatus(st, vars, ctx);

  let strata: string | null = null;
  const sv = sub(cmd, 'STRATA');
  if (sv) {
    const r = varList(sv, 0, vars);
    if (r.names.length !== 1 || r.next !== sv.length) throw new ExtError(t('errStrata'));
    strata = r.names[0];
  }

  const blocks: string[][] = [];
  for (const s of cmd.subs.filter((x) => matches(x.name, 'METHOD'))) {
    const tk = s.tokens;
    if (isKw(tk[0], 'FSTEP', 'BSTEP', 'REMOVE')) throw new ExtError(t('errStepwise'));
    let i = 0;
    if (isKw(tk[0], 'ENTER')) i = 1;
    else if (tk.length && tk[0].kind === 'id' && !vars.some((v) => up(v.name) === up(tk[0].text))) throw new ExtError(t('errMethod', { name: tk[0].text }));
    const r = varList(tk, i, vars);
    if (r.next !== tk.length) throw new ExtError(t('errInteraction'));
    blocks.push(r.names.length ? r.names : withVars);
  }
  if (!blocks.length && withVars.length) blocks.push(withVars);
  const covariates: string[] = [];
  for (const b of blocks) for (const n of b) if (!covariates.some((c) => up(c) === up(n))) covariates.push(n);
  for (const n of covariates) {
    if ([head.names[0], status, strata].some((x) => x && up(x) === up(n))) throw new ExtError(t('errRole', { name: n }));
  }

  const categorical = new Set<string>();
  const cat = sub(cmd, 'CATEGORICAL');
  if (cat) {
    const r = varList(cat, 0, vars);
    for (const n of r.names) {
      const c = covariates.find((x) => up(x) === up(n));
      if (!c) throw new ExtError(t('errCategorical', { name: n }));
      categorical.add(c);
    }
  }
  const contrasts = new Map<string, Contrast>();
  for (const s of cmd.subs.filter((x) => matches(x.name, 'CONTRAST'))) {
    const tk = s.tokens;
    if (tk[0]?.text !== '(' || tk[1]?.kind !== 'id' || tk[2]?.text !== ')') throw new ExtError(t('errContrast'));
    const c = covariates.find((x) => up(x) === up(tk[1].text));
    if (!c) throw new ExtError(t('errCategorical', { name: tk[1].text }));
    let i = 3;
    if (tk[i]?.text === '=') i++;
    const kw = tk[i]?.kind === 'id' ? up(tk[i].text) : '';
    const kind = (['INDICATOR', 'DEVIATION', 'SIMPLE'] as const).find((k) => matches(kw, k));
    if (!kind) throw new ExtError(t('errContrastType', { name: tk[i]?.text ?? '' }));
    let ref: number | null = null;
    if (tk[i + 1]?.text === '(') {
      if (tk[i + 2]?.kind !== 'num' || tk[i + 3]?.text !== ')' || !(Number.isInteger(tk[i + 2].value!) && tk[i + 2].value! >= 1)) throw new ExtError(t('errContrast'));
      ref = tk[i + 2].value!;
    }
    contrasts.set(c, { kind, ref });
    categorical.add(c); // CONTRAST implies CATEGORICAL (SPSS)
  }

  const pr = sub(cmd, 'PRINT');
  const pk = keywords(pr);
  let ci: number | null = null;
  if (pk.has('CI') || pk.has('ALL')) {
    const a = kwArg(pr, 'CI');
    ci = a?.[0]?.kind === 'num' ? a[0].value! : 95;
    if (!(ci > 0 && ci < 100)) throw new ExtError(t('errCi'));
  }
  const warnings: string[] = [];
  if (pk.has('ITER')) warnings.push(t('warnIgnored', { keyword: 'PRINT=ITER' }));

  const plots: PlotKind[] = [];
  const pl = keywords(sub(cmd, 'PLOT'));
  if (pl.has('SURVIVAL')) plots.push('survival');
  if (pl.has('HAZARD')) plots.push('hazard');
  if (pl.has('LML')) plots.push('lml');
  if (pl.has('OMS')) plots.push('oms');

  const crit = { mxiter: 20, pconverge: 1e-4, lconverge: 0, mxstep: 10, singular: 1e-8 };
  const cr = sub(cmd, 'CRITERIA');
  if (cr) {
    for (let i = 0; i < cr.length; i++) {
      const tk = cr[i];
      if (tk.kind !== 'id') continue;
      const k = up(tk.text);
      if (k === 'DEFAULT') continue;
      const val = cr[i + 1]?.text === '(' && cr[i + 2]?.kind === 'num' && cr[i + 3]?.text === ')' ? cr[i + 2].value! : null;
      if (val === null || val < 0) throw new ExtError(t('errCriteria', { name: tk.text }));
      if (matches(k, 'ITERATE')) crit.mxiter = Math.round(val);
      else if (matches(k, 'BCON')) crit.pconverge = val;
      else if (matches(k, 'LCON')) crit.lconverge = val;
      else if (!(matches(k, 'PIN') || matches(k, 'POUT'))) throw new ExtError(t('errCriteria', { name: tk.text }));
      i += 3;
    }
  }

  const patterns: Pattern[] = [];
  for (const s of cmd.subs.filter((x) => matches(x.name, 'PATTERN'))) {
    const tk = s.tokens;
    const p: Pattern = { values: new Map(), by: null };
    for (let i = 0; i < tk.length; ) {
      if (isKw(tk[i], 'BY')) {
        const c = covariates.find((x) => up(x) === up(tk[i + 1]?.text ?? ''));
        if (!c || !categorical.has(c) || i + 2 !== tk.length) throw new ExtError(t('errPatternBy'));
        p.by = c;
        break;
      }
      const c = covariates.find((x) => up(x) === up(tk[i]?.text ?? ''));
      if (!c || tk[i + 1]?.text !== '(' || (tk[i + 2]?.kind !== 'num' && tk[i + 2]?.kind !== 'str') || tk[i + 3]?.text !== ')') throw new ExtError(t('errPattern'));
      p.values.set(c, tk[i + 2].kind === 'num' ? tk[i + 2].value! : tk[i + 2].text);
      i += 4;
    }
    if (p.by && p.values.has(p.by)) throw new ExtError(t('errPatternBy'));
    patterns.push(p);
  }

  if (sub(cmd, 'SAVE') || sub(cmd, 'OUTFILE')) warnings.push(t('warnSave'));
  if (sub(cmd, 'EXTERNAL')) warnings.push(t('warnIgnored', { keyword: 'EXTERNAL' }));
  return {
    time: head.names[0],
    status,
    event,
    strata,
    blocks,
    covariates,
    categorical,
    contrasts,
    ci,
    baseline: pk.has('BASELINE') || pk.has('ALL'),
    corr: pk.has('CORR') || pk.has('ALL'),
    summaryOnly: pk.has('SUMMARY') && !pk.has('DEFAULT') && !pk.has('ALL'),
    plots,
    patterns,
    includeUser: keywords(sub(cmd, 'MISSING')).has('INCLUDE'),
    crit,
    warnings,
  };
}

/* ----------------------------------------------------------- design */

type Value = number | string;

interface Term {
  /** variable name */
  name: string;
  v: Variable;
  col: Cell[];
  /** categorical: observed categories (ascending) and the contrast matrix (category × columns) */
  cats: Value[] | null;
  codes: number[][] | null;
  ref: number;
  contrast: Contrast | null;
  /** design column indices */
  cols: number[];
  labels: string[];
}

const norm = (v: Variable, x: Cell): Value => (v.type === 'string' ? String(x).trimEnd() : (x as number));

function contrastMatrix(k: number, c: Contrast): { codes: number[][]; ref: number } {
  const ref = c.ref === null ? k - 1 : c.ref - 1;
  const codes: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      if (j === ref) continue;
      if (c.kind === 'INDICATOR') row.push(i === j ? 1 : 0);
      else if (c.kind === 'DEVIATION') row.push(i === ref ? -1 : i === j ? 1 : 0);
      else row.push((i === j ? 1 : 0) - 1 / k);
    }
    codes.push(row);
  }
  return { codes, ref };
}

/* ------------------------------------------------------------- output */

/** Unrounded results per split group, collected only while a test sets SINK (test hook). */
export interface CoxRaw {
  labels: string[];
  B: number[];
  SE: number[];
  m2ll: number;
  m2ll0: number;
  score: number | null;
  baseline: BaselineRow[][];
  means: number[];
  warnings: string[];
}
export const inspect: { sink: CoxRaw[] | null } = { sink: null };

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const o = parseOptions(cmd, ctx);
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const ds = ctx.dataset;
  const time = variable(ds, o.time);
  const stat = variable(ds, o.status);
  requireNumeric(time.v);
  requireNumeric(stat.v);
  const str = o.strata ? variable(ds, o.strata) : null;
  const covs = o.covariates.map((n) => variable(ds, n));
  covs.forEach((c) => {
    if (!o.categorical.has(c.v.name)) requireNumeric(c.v);
  });
  const w = weights(ds);
  const isEvent = (x: number) => o.event.values.includes(x) || o.event.ranges.some(([a, b]) => x >= a && x <= b);
  const out: OutputItem[] = o.warnings.map((m) => messageItem('warning', m, ctx.line));

  for (const group of splitGroups(ds)) {
    const items: OutputItem[] = [];
    if (group.label) items.push(textItem(group.label));
    out.push(...items);
    out.push(...analyse(group.rows));
  }
  return [groupItem(t('title'), NAME, out)];

  function analyse(rows: number[]): OutputItem[] {
    const items: OutputItem[] = [];
    const warn = (m: string) => items.push(messageItem('warning', m, ctx.line));
    // listwise selection
    let nMissing = 0;
    let nNegative = 0;
    let nEarly = 0;
    let total = 0;
    const valid: number[] = [];
    for (const r of rows) {
      total += w[r];
      const all = [time, stat, ...(str ? [str] : []), ...covs];
      if (all.some((m) => isMissing(m.v, m.col[r], o.includeUser))) {
        nMissing += w[r];
        continue;
      }
      if ((time.col[r] as number) < 0) {
        nNegative += w[r];
        continue;
      }
      valid.push(r);
    }
    // strata and censored cases before the stratum's earliest event
    const sKey = (r: number) => (str ? JSON.stringify(norm(str.v, str.col[r])) : '');
    const sVals = new Map<string, Value | null>();
    for (const r of valid) if (!sVals.has(sKey(r))) sVals.set(sKey(r), str ? norm(str.v, str.col[r]) : null);
    const sOrder = [...sVals.entries()].sort(([, a], [, b]) => (a === null || b === null ? 0 : cmpValue(a, b)));
    const firstEvent = new Map<string, number>();
    for (const r of valid) {
      if (!isEvent(stat.col[r] as number)) continue;
      const k = sKey(r);
      firstEvent.set(k, Math.min(firstEvent.get(k) ?? Infinity, time.col[r] as number));
    }
    const stratumCount = new Map<string, { ev: number; cens: number }>();
    const used = valid.filter((r) => {
      const ev = isEvent(stat.col[r] as number);
      const k = sKey(r);
      const sc = stratumCount.get(k) ?? { ev: 0, cens: 0 };
      stratumCount.set(k, sc);
      if (!ev && (time.col[r] as number) < (firstEvent.get(k) ?? Infinity)) {
        nEarly += w[r];
        return false;
      }
      if (ev) sc.ev += w[r];
      else sc.cens += w[r];
      return true;
    });
    const nEvents = used.reduce((s, r) => s + (isEvent(stat.col[r] as number) ? w[r] : 0), 0);
    const nCens = used.reduce((s, r) => s + w[r], 0) - nEvents;

    // design
    const terms: Term[] = [];
    let ncol = 0;
    for (const c of covs) {
      if (o.categorical.has(c.v.name)) {
        const cats = [...new Set(used.map((r) => norm(c.v, c.col[r])))].sort(cmpValue);
        const contrast = o.contrasts.get(c.v.name) ?? { kind: 'INDICATOR', ref: null };
        if (cats.length && contrast.ref !== null && contrast.ref > cats.length) throw new ExtError(t('errRefcat', { name: c.v.name, n: cats.length }));
        const { codes, ref } = contrastMatrix(cats.length, contrast);
        const cols = Array.from({ length: Math.max(0, cats.length - 1) }, (_, i) => ncol + i);
        ncol += cols.length;
        terms.push({ name: c.v.name, v: c.v, col: c.col, cats, codes, ref, contrast, cols, labels: cols.map((_, i) => `${c.v.name}(${i + 1})`) });
      } else {
        terms.push({ name: c.v.name, v: c.v, col: c.col, cats: null, codes: null, ref: -1, contrast: null, cols: [ncol], labels: [c.v.name] });
        ncol++;
      }
    }
    const rowX = (r: number): number[] => {
      const x: number[] = [];
      for (const tm of terms) {
        if (!tm.cats) x.push(tm.col[r] as number);
        else {
          const i = tm.cats.findIndex((c) => c === norm(tm.v, tm.col[r]));
          x.push(...tm.codes![i]);
        }
      }
      return x;
    };
    const wsum = used.reduce((s, r) => s + w[r], 0);
    const xs = new Map(used.map((r) => [r, rowX(r)]));
    const means = new Array(ncol).fill(0);
    for (const r of used) xs.get(r)!.forEach((x, j) => (means[j] += (w[r] * x) / wsum));
    const strataList = sOrder
      .map(([k, v]) => ({ v, cases: used.filter((r) => sKey(r) === k).map((r) => ({ t: time.col[r] as number, event: isEvent(stat.col[r] as number), w: w[r], x: xs.get(r)! })) }))
      .filter((s) => s.cases.length);
    const data: CoxData = { strata: strataList.map((s) => s.cases.sort((a, b) => b.t - a.t)), means };
    const sLabels = strataList.map((s) => (str ? valueText(str.v, s.v) : ''));
    const labels = terms.flatMap((tm) => tm.labels);

    // Case Processing Summary
    const pct = (x: number) => (total > 0 ? `${fmt((100 * x) / total, 1, ctx)}%` : '');
    const dropped = nMissing + nNegative + nEarly;
    const cpsRow = (a: string, b: string | null, x: number, rowspan = 1, first = true): TCell[] => [
      ...(first ? [th(a, { rowspan, colspan: b === null ? 2 : 1 })] : []),
      ...(b !== null ? [th(b)] : []),
      td(fmtN(x, ctx)),
      td(pct(x)),
    ];
    items.push(
      tableItem(
        {
          caption: t('cps'),
          head: [[th('', { colspan: 2 }), th(t('n')), th(t('percent'))]],
          body: [
            cpsRow(t('available'), `${t('event')}ᵃ`, nEvents, 3),
            cpsRow('', t('censored'), nCens, 3, false),
            cpsRow('', t('total'), nEvents + nCens, 3, false),
            cpsRow(t('dropped'), t('droppedMissing'), nMissing, 4),
            cpsRow('', t('droppedNegative'), nNegative, 4, false),
            cpsRow('', t('droppedEarly'), nEarly, 4, false),
            cpsRow('', t('total'), dropped, 4, false),
            cpsRow(t('total'), null, total),
          ],
          footnotes: [t('depVar', { name: varTitle(time.v) })],
        },
        NAME,
      ),
    );
    if (nEvents <= 0) {
      warn(t('warnNoEvents'));
      return items;
    }

    // Stratum Status
    if (str) {
      items.push(
        tableItem(
          {
            caption: t('stratumStatus'),
            head: [[th(t('stratum')), th(t('strataLabel')), th(t('event')), th(t('censored')), th(t('censoredPct'))]],
            body: sOrder.map(([k, v]) => {
              const c = stratumCount.get(k) ?? { ev: 0, cens: 0 };
              const n = c.ev + c.cens;
              return [th(valueCode(str.v, v!, ctx)), td(valueText(str.v, v)), td(fmtN(c.ev, ctx)), td(fmtN(c.cens, ctx)), td(n > 0 ? `${fmt((100 * c.cens) / n, 1, ctx)}%` : '')];
            }),
            footnotes: [t('strataNote', { name: varTitle(str.v) })],
          },
          NAME,
        ),
      );
      const noEv = sOrder.filter(([k]) => !firstEvent.has(k)).map(([, v]) => valueText(str.v, v));
      if (noEv.length) warn(t('warnStratumNoEvents', { strata: noEv.join(', ') }));
    }

    // Categorical Variable Codings
    const catTerms = terms.filter((tm) => tm.cats);
    if (catTerms.length) {
      const maxCols = Math.max(...catTerms.map((tm) => tm.cols.length));
      const body: TCell[][] = [];
      const notes: string[] = [];
      catTerms.forEach((tm, ti) => {
        const mk = SUP[ti] ?? '';
        notes.push(t('catNote', { name: tm.name }));
        if (tm.contrast!.kind !== 'INDICATOR') notes.push(t(tm.contrast!.kind === 'DEVIATION' ? 'devNote' : 'simpleNote', { name: tm.name }));
        tm.cats!.forEach((c, i) => {
          const freq = used.reduce((s, r) => s + (norm(tm.v, tm.col[r]) === c ? w[r] : 0), 0);
          body.push([
            ...(i === 0 ? [th(`${tm.name}${mk}`, { rowspan: tm.cats!.length })] : []),
            th(valueText(tm.v, c)),
            td(fmtN(freq, ctx)),
            ...Array.from({ length: maxCols }, (_, j) => td(j < tm.codes![i].length ? fmtCode(tm.codes![i][j], ctx) : '')),
          ]);
        });
      });
      items.push(
        tableItem(
          {
            caption: t('codings'),
            head: [[th('', { colspan: 2 }), th(t('frequency')), ...Array.from({ length: maxCols }, (_, j) => th(`(${j + 1})`))]],
            body,
            footnotes: catTerms.map((tm, i) => ({ mark: String.fromCharCode(97 + i), text: notes.filter((n) => n.includes(tm.name)).join(' ') })),
          },
          NAME,
        ),
      );
    }

    // Block 0
    const fit0 = coxFit(data, [], o.crit);
    items.push(textItem(t('block0')));
    items.push(tableItem({ caption: t('omnibus'), head: [[th(t('m2ll'))]], body: [[td(fmt(-2 * fit0.ll, 3, ctx))]] }, NAME));
    if (!o.blocks.length) {
      warn(t('warnNoCovariates'));
      return items;
    }

    // blocks
    const z = normInv(1 - (1 - (o.ci ?? 95) / 100) / 2);
    let prev = fit0;
    let last: CoxFit | null = null;
    const inModel = new Set<string>();
    let aliasedAll: string[] = [];
    for (let b = 0; b < o.blocks.length; b++) {
      for (const n of o.blocks[b]) inModel.add(n.toUpperCase());
      const termsIn = terms.filter((tm) => inModel.has(tm.name.toUpperCase()));
      let cols = termsIn.flatMap((tm) => tm.cols);
      // aliased (constant or linearly dependent) columns are removed
      const allRows = data.strata.flat();
      const red = aliasing(
        allRows.map((c) => cols.map((j) => c.x[j])),
        allRows.map((c) => c.w),
        true,
      );
      const aliased = cols.filter((_, i) => red[i]);
      cols = cols.filter((_, i) => !red[i]);
      const newAliased = aliased.map((j) => labels[j]).filter((l) => !aliasedAll.includes(l));
      if (newAliased.length) warn(t('warnAliased', { names: newAliased.join(', ') }));
      aliasedAll = [...new Set([...aliasedAll, ...aliased.map((j) => labels[j])])];
      const fit = coxFit(data, cols, o.crit);
      last = fit;
      items.push(textItem(t('blockN', { n: b + 1 })));
      if (!fit.converged) warn(t('warnIterations', { n: o.crit.mxiter }));
      if (fit.diverging.length) warn(t('warnMonotone', { names: fit.diverging.map((j) => labels[cols[j]]).join(', ') }));
      if (!fit.cov && cols.length) warn(t('warnSingular'));
      const df = cols.length;
      const dfPrev = prev.cols.length;
      const chg = -2 * prev.ll + 2 * fit.ll;
      const pv = (x: number, d: number) => (d > 0 ? fmtP(chi2Sf(Math.max(0, x), d), ctx) : '');
      items.push(
        tableItem(
          {
            caption: t('omnibusModel'),
            head: [
              [th(t('m2ll'), { rowspan: 2 }), th(t('overallScore'), { colspan: 3 }), th(t('changeStep'), { colspan: 3 }), th(t('changeBlock'), { colspan: 3 })],
              [th(t('chiSquare')), th(t('df')), th(t('sig')), th(t('chiSquare')), th(t('df')), th(t('sig')), th(t('chiSquare')), th(t('df')), th(t('sig'))],
            ],
            body: [
              [
                td(fmt(-2 * fit.ll, 3, ctx)),
                td(fit.score === null ? '' : fmt(fit.score, 3, ctx)),
                td(String(df)),
                td(fit.score === null ? '' : pv(fit.score, df)),
                td(fmt(chg, 3, ctx)),
                td(String(df - dfPrev)),
                td(pv(chg, df - dfPrev)),
                td(fmt(chg, 3, ctx)),
                td(String(df - dfPrev)),
                td(pv(chg, df - dfPrev)),
              ],
            ],
            footnotes: [t('blockNote', { n: b + 1 })],
          },
          NAME,
        ),
      );
      const isLast = b === o.blocks.length - 1;
      if (!o.summaryOnly || isLast) {
        items.push(varsTable(termsIn, cols, fit, z));
        if (o.corr && cols.length > 1 && fit.cov) items.push(corrTable(cols, fit, labels));
      }
      prev = fit;
    }
    const fit = last!;

    // patterns (BY expands into one pattern per category)
    const patterns: { label: string; z: number[]; name: string }[] = [];
    o.patterns.forEach((p, pi) => {
      const base = [...means];
      for (const [name, val] of p.values) {
        const tm = terms.find((x) => x.name === name)!;
        if (!tm.cats) {
          if (typeof val !== 'number') throw new ExtError(t('errPattern'));
          base[tm.cols[0]] = val;
        } else {
          const i = tm.cats.findIndex((c) => (typeof c === 'number' ? c === Number(val) : c === String(val).trimEnd()));
          if (i < 0) throw new ExtError(t('errPatternValue', { name, value: String(val) }));
          tm.cols.forEach((j, a) => (base[j] = tm.codes![i][a]));
        }
      }
      const desc = [...p.values.entries()].map(([n, v]) => `${n}=${typeof v === 'number' ? fmt(v, 2, ctx).replace(/^(-?)([.,])/, '$10$2') : v}`);
      if (!p.by) patterns.push({ label: String(pi + 1), z: base, name: desc.join(', ') || t('atMean') });
      else {
        const tm = terms.find((x) => x.name === p.by)!;
        tm.cats!.forEach((c, i) => {
          const zz = [...base];
          tm.cols.forEach((j, a) => (zz[j] = tm.codes![i][a]));
          patterns.push({ label: `${pi + 1}.${i + 1}`, z: zz, name: [...desc, `${tm.name}=${valueText(tm.v, c)}`].join(', ') });
        });
      }
    });

    // Covariate Means (and Pattern Values)
    items.push(
      tableItem(
        {
          caption: patterns.length ? t('meansPatterns') : t('means'),
          head: [[th(''), th(t('mean')), ...patterns.map((p) => th(t('pattern', { n: p.label })))]],
          body: labels.map((l, j) => [th(l), td(fmt(means[j], 3, ctx)), ...patterns.map((p) => td(fmt(p.z[j], 3, ctx)))]),
        },
        NAME,
      ),
    );

    const base = coxBaseline(data, fit);
    if (inspect.sink)
      inspect.sink.push({
        labels: fit.cols.map((j) => labels[j]),
        B: fit.beta,
        SE: fit.beta.map((_, a) => (fit.cov ? Math.sqrt(fit.cov[a][a]) : NaN)),
        m2ll: -2 * fit.ll,
        m2ll0: -2 * fit.ll0,
        score: fit.score,
        baseline: base,
        means,
        warnings: items.flatMap((i) => (i.kind === 'message' ? [i.text] : [])),
      });

    // Survival Table
    if (o.baseline) {
      const body: TCell[][] = [];
      const fmtT = (x: number) => fmt(x, time.v.print?.d ?? 0, ctx);
      base.forEach((rowsS, si) =>
        rowsS.forEach((r, i) =>
          body.push([
            ...(str && i === 0 ? [th(sLabels[si], { rowspan: rowsS.length })] : []),
            th(fmtT(r.t)),
            td(fmt(r.h0, 3, ctx)),
            td(fmt(r.s, 3, ctx)),
            td(fmt(r.se, 3, ctx)),
            td(fmt(r.h, 3, ctx)),
          ]),
        ),
      );
      items.push(
        tableItem(
          {
            caption: t('survTable'),
            head: [
              [...(str ? [th(varTitle(str.v), { rowspan: 2 })] : []), th(t('time'), { rowspan: 2 }), th(t('baseCumHaz'), { rowspan: 2 }), th(t('atMean'), { colspan: 3 })],
              [th(t('survival')), th(t('se')), th(t('cumHaz'))],
            ],
            body,
          },
          NAME,
        ),
      );
    }

    // Plots
    const sets = patterns.length ? patterns : [{ label: '', z: means, name: t('atMean') }];
    const tmax = data.strata.map((s) => Math.max(...s.map((c) => c.t)));
    for (const kind of o.plots) {
      const title = t(`plot.${kind}`);
      const perPattern = patterns.length > 0 && data.strata.length > 1;
      const charts: { title: string; curves: ReturnType<typeof curve>[] }[] = [];
      if (perPattern)
        for (const p of sets) {
          const bl = coxBaseline(data, fit, fit.cols.map((j) => p.z[j]));
          charts.push({ title: `${title}: ${p.name}`, curves: bl.map((rowsS, si) => curve(rowsS, kind, sLabels[si], tmax[si])) });
        }
      else {
        const curves = sets.flatMap((p) => coxBaseline(data, fit, fit.cols.map((j) => p.z[j])).map((rowsS, si) => curve(rowsS, kind, [sets.length > 1 || !str ? p.name : '', sLabels[si]].filter(Boolean).join(', '), tmax[si])));
        charts.push({ title: patterns.length === 1 ? `${title}: ${patterns[0].name}` : str || patterns.length ? title : `${title} ${t('atMeanSuffix')}`, curves });
      }
      for (const c of charts)
        items.push(
          chartItem(c.title, {
            type: 'survival',
            title: c.title,
            kind,
            xlabel: varTitle(time.v),
            ylabel: t(`axis.${kind}`),
            legendTitle: str && !patterns.length ? varTitle(str.v) : '',
            censoredLabel: t('censored'),
            curves: c.curves,
          }),
        );
    }
    return items;
  }

  function varsTable(termsIn: Term[], cols: number[], fit: CoxFit, z: number): OutputItem {
    const body: TCell[][] = [];
    const idx = (j: number) => cols.indexOf(j);
    const row = (label: string, a: number) => {
      const b = fit.beta[a];
      const se = fit.cov ? Math.sqrt(fit.cov[a][a]) : NaN;
      const wald = (b / se) ** 2;
      body.push([
        th(label),
        td(fmt(b, 3, ctx)),
        td(fmt(se, 3, ctx)),
        td(fmt(wald, 3, ctx)),
        td('1'),
        td(fmtP(Number.isFinite(wald) ? chi2Sf(wald, 1) : NaN, ctx)),
        td(fmt(Math.exp(b), 3, ctx)),
        ...(o.ci !== null ? [td(fmt(Math.exp(b - z * se), 3, ctx)), td(fmt(Math.exp(b + z * se), 3, ctx))] : []),
      ]);
    };
    for (const tm of termsIn) {
      const present = tm.cols.filter((j) => idx(j) >= 0);
      if (!present.length) continue;
      if (tm.cats && tm.cols.length > 1) {
        const ai = present.map(idx);
        let wald = NaN;
        if (fit.cov) {
          const inv = inverse(ai.map((a) => ai.map((c) => fit.cov![a][c])), 1e-14);
          const bb = ai.map((a) => fit.beta[a]);
          if (inv) wald = bb.reduce((s, x, p) => s + x * inv[p].reduce((u, y, q) => u + y * bb[q], 0), 0);
        }
        body.push([th(tm.name), td(''), td(''), td(fmt(wald, 3, ctx)), td(String(ai.length)), td(fmtP(Number.isFinite(wald) ? chi2Sf(wald, ai.length) : NaN, ctx)), td(''), ...(o.ci !== null ? [td(''), td('')] : [])]);
      }
      tm.cols.forEach((j, i) => {
        if (idx(j) >= 0) row(tm.labels[i], idx(j));
      });
    }
    const ci = o.ci ?? 95;
    return tableItem(
      {
        caption: t('varsIn'),
        head:
          o.ci !== null
            ? [
                [th('', { rowspan: 2 }), th('B', { rowspan: 2 }), th(t('se'), { rowspan: 2 }), th(t('wald'), { rowspan: 2 }), th(t('df'), { rowspan: 2 }), th(t('sig'), { rowspan: 2 }), th(t('expB'), { rowspan: 2 }), th(t('ci', { level: fmt(ci, 1, ctx) }), { colspan: 2 })],
                [th(t('lower')), th(t('upper'))],
              ]
            : [[th(''), th('B'), th(t('se')), th(t('wald')), th(t('df')), th(t('sig')), th(t('expB'))]],
        body,
      },
      NAME,
    );
  }

  function corrTable(cols: number[], fit: CoxFit, labels: string[]): OutputItem {
    const cov = fit.cov!;
    const lab = (a: number) => labels[cols[a]];
    return tableItem(
      {
        caption: t('corr'),
        head: [[th(''), ...cols.slice(0, -1).map((_, a) => th(lab(a)))]],
        body: cols.slice(1).map((_, i) => {
          const a = i + 1;
          return [th(lab(a)), ...cols.slice(0, -1).map((_, b) => td(b < a ? fmt(cov[a][b] / Math.sqrt(cov[a][a] * cov[b][b]), 3, ctx) : ''))];
        }),
      },
      NAME,
    );
  }
}

const SUP = ['ᵃ', 'ᵇ', 'ᶜ', 'ᵈ', 'ᵉ', 'ᶠ', 'ᵍ', 'ʰ'];

/** Contrast codes as SPSS prints them: integers plain, fractions with 3 decimals. */
function fmtCode(x: number, ctx: ExtContext): string {
  return Number.isInteger(x) ? String(x) : fmt(x, 3, ctx);
}

function valueCode(v: Variable, x: Value, ctx: ExtContext): string {
  if (typeof x === 'string') return x;
  const s = x.toFixed(v.print?.d ?? 0);
  return ctx.decimal === ',' ? s.replace('.', ',') : s;
}

const yOf = (r: { s: number; h: number }, kind: PlotKind): number | null => {
  if (kind === 'survival') return r.s;
  if (kind === 'oms') return 1 - r.s;
  if (kind === 'hazard') return r.h;
  return r.h > 0 ? Math.log(r.h) : null;
};

/** Step curve at the covariate values: start, every event time, end at the largest time. */
function curve(rows: BaselineRow[], kind: PlotKind, name: string, end: number) {
  const points: [number, number][] = kind === 'lml' ? [] : [[0, kind === 'survival' ? 1 : 0]];
  for (const r of rows) {
    const y = yOf(r, kind);
    if (y !== null && Number.isFinite(y)) points.push([r.t, y]);
  }
  return { name, points, censored: [] as [number, number][], end };
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
