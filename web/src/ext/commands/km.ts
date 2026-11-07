/*
 * KM – Kaplan–Meier survival analysis (SPSS syntax and output layout).
 *
 *   KM survvar [BY factor] [/STRATA=strata]
 *     /STATUS=statusvar({value list | lo THRU hi}) [EVENT]
 *     /PRINT=[TABLE] [MEAN] [NONE]   /PERCENTILES[=(p …)]
 *     /PLOT=[SURVIVAL] [HAZARD] [LOGSURV] [OMS]
 *     /TEST=[LOGRANK] [BRESLOW] [TARONE]
 *     /COMPARE=[OVERALL|PAIRWISE] [POOLED|STRATA]
 *
 * Formulas (IBM SPSS Statistics Algorithms, "KM"):
 *   S(t_i)      = Π_{j≤i} (1 − d_j / n_j)                   (product-limit estimate)
 *   SE(S(t_i))  = S(t_i) · sqrt(Σ_{j≤i} d_j / (n_j (n_j − d_j)))   (Greenwood)
 *   mean        = Σ_i S(t_{i−1}) (t_i − t_{i−1}), t_0 = 0, S(t_0) = 1, the last interval
 *                 ending at the largest observed time (restricted mean if that time is censored)
 *   var(mean)   = m/(m−1) · Σ_i A_i² d_i / (n_i (n_i − d_i)),  A_i = ∫_{t_i}^{t_max} S(t) dt,
 *                 m = total number of events
 *   t_p         = smallest event time with S(t) ≤ 1 − p/100   (median: p = 50)
 *   SE(t_p)     = SE(S(t_p)) / f̂(t_p),  f̂ = (S(û) − S(l̂)) / (l̂ − û),
 *                 û = largest event time (or 0) with S ≥ 1 − p/100 + 0.05,
 *                 l̂ = smallest event time with S ≤ 1 − p/100 − 0.05   (Collett 1994)
 *   CIs         = estimate ± 1.96 · SE
 *   tests       = U' V⁻¹ U with U_g = Σ_t w_t (d_gt − n_gt d_t / n_t),
 *                 V_gh = Σ_t w_t² d_t (n_t − d_t)/(n_t − 1) · (n_gt/n_t)(δ_gh − n_ht/n_t),
 *                 w_t = 1 (log rank), n_t (Breslow), √n_t (Tarone–Ware); df = groups − 1;
 *                 stratified (POOLED) tests sum U and V over strata.
 * Frequency weights scale every count (n, d, m).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem, Variable } from '../../engine/types';
import { isMissing, requireNumeric, splitGroups, valueText, variable, varTitle, weights, type Cell } from '../data';
import { chi2Sf } from '../dist';
import { inverse } from '../linalg';
import { isKw, keywords, sub, varList, type ParsedCommand, type Token } from '../parse';
import { chartItem, fmt, fmtN, fmtP, groupItem, messageItem, tableItem, td, textItem, th, type Cell as TCell } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';

const NAME = 'KM';
const Z = 1.959963984540054;
const EPS = 1e-10;

/* ------------------------------------------------------------------ maths */

export interface Obs {
  t: number;
  event: boolean;
  w: number;
  status?: Cell;
}

export interface KmStep {
  /** event time */
  t: number;
  /** number at risk just before t */
  n: number;
  /** events at t */
  d: number;
  /** S(t) */
  s: number;
  /** Greenwood standard error of S(t) */
  se: number;
}

export interface KmRow {
  t: number;
  event: boolean;
  status?: Cell;
  /** estimate and SE on the last event row of each event time, null otherwise */
  est: number | null;
  se: number | null;
  cumEvents: number;
  remaining: number;
}

export interface KmFit {
  total: number;
  events: number;
  censored: number;
  steps: KmStep[];
  rows: KmRow[];
  /** censored observations with the estimate at their time */
  censor: { t: number; s: number }[];
  tmax: number;
  mean: number | null;
  meanSe: number | null;
}

/** Product-limit estimate, Greenwood SEs, survival table rows and the restricted mean. */
export function kmFit(obs: Obs[]): KmFit {
  const o = obs.filter((x) => x.w > 0).sort((a, b) => a.t - b.t || Number(b.event) - Number(a.event));
  const total = o.reduce((s, x) => s + x.w, 0);
  const steps: KmStep[] = [];
  const rows: KmRow[] = [];
  const censor: { t: number; s: number }[] = [];
  let atRisk = total;
  let s = 1;
  let gw = 0;
  let cum = 0;
  let remaining = total;
  let events = 0;
  for (let i = 0; i < o.length; ) {
    let j = i;
    let d = 0;
    let lastEvent = -1;
    while (j < o.length && o[j].t === o[i].t) {
      if (o[j].event) {
        d += o[j].w;
        lastEvent = j;
      }
      j++;
    }
    let se = 0;
    if (d > 0) {
      s *= 1 - d / atRisk;
      if (atRisk - d > EPS) gw += d / (atRisk * (atRisk - d));
      if (s < EPS) s = 0;
      se = s > 0 ? s * Math.sqrt(gw) : 0;
      steps.push({ t: o[i].t, n: atRisk, d, s, se });
      events += d;
    }
    for (let k = i; k < j; k++) {
      const x = o[k];
      if (x.event) cum += x.w;
      else censor.push({ t: x.t, s });
      remaining -= x.w;
      atRisk -= x.w;
      rows.push({ t: x.t, event: x.event, status: x.status, est: k === lastEvent ? s : null, se: k === lastEvent ? se : null, cumEvents: cum, remaining: Math.abs(remaining) < EPS ? 0 : remaining });
    }
    i = j;
  }
  const tmax = o.length ? o[o.length - 1].t : 0;
  let mean: number | null = null;
  let meanSe: number | null = null;
  if (o.length) {
    // breakpoints 0, t_1, …, t_k, tmax; S constant between them
    let area = 0;
    let prevT = 0;
    let prevS = 1;
    for (const st of steps) {
      area += prevS * (st.t - prevT);
      prevT = st.t;
      prevS = st.s;
    }
    area += prevS * (tmax - prevT);
    mean = area;
    // A_i = area from t_i to tmax
    let sum = 0;
    let tail = 0;
    for (let i = steps.length - 1; i >= 0; i--) {
      const next = i + 1 < steps.length ? steps[i + 1].t : tmax;
      tail += steps[i].s * (next - steps[i].t);
      const { n, d } = steps[i];
      if (n - d > EPS) sum += (tail * tail * d) / (n * (n - d));
    }
    const m = events;
    if (sum === 0) meanSe = 0;
    else if (m > 1) meanSe = Math.sqrt((m / (m - 1)) * sum);
  }
  return { total, events, censored: total - events, steps, rows, censor, tmax, mean, meanSe };
}

/** Percentile p (0–100) of the survival time and its SE (SPSS / Collett method). */
export function kmPercentile(fit: KmFit, p: number): { est: number | null; se: number | null } {
  const q = 1 - p / 100;
  const at = fit.steps.find((st) => st.s <= q + EPS);
  if (!at) return { est: null, se: null };
  let u = { t: 0, s: 1 };
  for (const st of fit.steps) if (st.s >= q + 0.05 - EPS) u = { t: st.t, s: st.s };
  const l = fit.steps.find((st) => st.s <= q - 0.05 + EPS);
  if (!l || l.t <= u.t) return { est: at.t, se: null };
  const f = (u.s - l.s) / (l.t - u.t);
  return { est: at.t, se: f > 0 ? at.se / f : null };
}

export type TestType = 'LOGRANK' | 'BRESLOW' | 'TARONE';

/**
 * K-sample test of equal survival. STRATA: per stratum, observations of each group (indexed
 * consistently across strata). Groups without any observation are dropped. null = not computable.
 */
export function kmTest(strata: Obs[][][], type: TestType): { chi: number; df: number; p: number } | null {
  const kAll = Math.max(0, ...strata.map((s) => s.length));
  const present: number[] = [];
  for (let g = 0; g < kAll; g++) if (strata.some((s) => (s[g] ?? []).some((x) => x.w > 0))) present.push(g);
  const k = present.length;
  if (k < 2) return null;
  const U = new Array(k).fill(0);
  const V = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const groups of strata) {
    const all: { t: number; event: boolean; w: number; g: number }[] = [];
    present.forEach((g, gi) => (groups[g] ?? []).forEach((x) => x.w > 0 && all.push({ t: x.t, event: x.event, w: x.w, g: gi })));
    all.sort((a, b) => a.t - b.t);
    const risk = new Array(k).fill(0);
    for (const x of all) risk[x.g] += x.w;
    for (let i = 0; i < all.length; ) {
      let j = i;
      const dg = new Array(k).fill(0);
      while (j < all.length && all[j].t === all[i].t) {
        if (all[j].event) dg[all[j].g] += all[j].w;
        j++;
      }
      const d = dg.reduce((a, b) => a + b, 0);
      const n = risk.reduce((a, b) => a + b, 0);
      if (d > 0 && n > 0) {
        const w = type === 'LOGRANK' ? 1 : type === 'BRESLOW' ? n : Math.sqrt(n);
        for (let g = 0; g < k; g++) U[g] += w * (dg[g] - (risk[g] * d) / n);
        if (n > 1) {
          const c = (w * w * d * (n - d)) / (n - 1);
          for (let g = 0; g < k; g++) for (let h = 0; h < k; h++) V[g][h] += c * (risk[g] / n) * ((g === h ? 1 : 0) - risk[h] / n);
        }
      }
      for (let m = i; m < j; m++) risk[all[m].g] -= all[m].w;
      i = j;
    }
  }
  const u = U.slice(0, k - 1);
  const inv = inverse(V.slice(0, k - 1).map((r) => r.slice(0, k - 1)), 1e-12);
  if (!inv) return null;
  const chi = u.reduce((s, ui, a) => s + ui * inv[a].reduce((t, x, b) => t + x * u[b], 0), 0);
  return { chi, df: k - 1, p: chi2Sf(chi, k - 1) };
}

/* ---------------------------------------------------------------- parsing */

export interface EventSpec {
  values: number[];
  ranges: [number, number][];
}

interface Options {
  time: string;
  factor: string | null;
  strata: string | null;
  status: string;
  event: EventSpec;
  table: boolean;
  mean: boolean;
  percentiles: number[];
  plots: ('survival' | 'hazard' | 'logsurv' | 'oms')[];
  tests: TestType[];
  pairwise: boolean;
  pooled: boolean;
  warnings: string[];
}

const T = (ctx: ExtContext, key: string, args?: Record<string, unknown>) => ctx.t(`ext.km.${key}`, args);

/** STATUS=var[(EVENT)](values | lo THRU hi) – shared with COXREG. */
export function parseStatus(tokens: Token[], vars: Variable[], ctx: ExtContext): { status: string; event: EventSpec } {
  const { names, next } = varList(tokens, 0, vars, ['EVENT', 'LOST']);
  if (names.length !== 1) throw new ExtError(T(ctx, 'errStatus'));
  let i = next;
  if (isKw(tokens[i], 'EVENT')) i++;
  if (tokens[i]?.text !== '(') throw new ExtError(T(ctx, 'errStatus'));
  const inner: Token[] = [];
  for (i++; i < tokens.length && tokens[i].text !== ')'; i++) inner.push(tokens[i]);
  if (tokens[i]?.text !== ')') throw new ExtError(T(ctx, 'errStatus'));
  const event: EventSpec = { values: [], ranges: [] };
  const val = (t: Token | undefined, lo: boolean): number => {
    if (t?.kind === 'num') return t.value!;
    if (isKw(t, 'LO', 'LOWEST') && lo) return -Infinity;
    if (isKw(t, 'HI', 'HIGHEST') && !lo) return Infinity;
    throw new ExtError(T(ctx, 'errStatus'));
  };
  for (let j = 0; j < inner.length; j++) {
    const t = inner[j];
    if (t.text === ',') continue;
    if (isKw(inner[j + 1], 'THRU')) {
      event.ranges.push([val(t, true), val(inner[j + 2], false)]);
      j += 2;
    } else event.values.push(val(t, false));
  }
  if (!event.values.length && !event.ranges.length) throw new ExtError(T(ctx, 'errStatus'));
  for (let j = i + 1; j < tokens.length; j++) if (!isKw(tokens[j], 'EVENT')) throw new ExtError(T(ctx, 'errStatus'));
  return { status: names[0], event };
}

const KNOWN = ['STRATA', 'STATUS', 'PRINT', 'PERCENTILES', 'PLOT', 'TEST', 'COMPARE', 'TREND', 'SAVE', 'ID'];

function parseOptions(cmd: ParsedCommand, ctx: ExtContext): Options {
  const vars = ctx.dataset.variables;
  const head = varList(cmd.head, 0, vars, ['BY']);
  if (head.names.length !== 1) throw new ExtError(T(ctx, 'errTime'));
  let factor: string | null = null;
  if (isKw(cmd.head[head.next], 'BY')) {
    const f = varList(cmd.head, head.next + 1, vars);
    if (f.names.length !== 1 || f.next !== cmd.head.length) throw new ExtError(T(ctx, 'errFactor'));
    factor = f.names[0];
  } else if (head.next !== cmd.head.length) throw new ExtError(T(ctx, 'errTime'));
  for (const s of cmd.subs) if (!KNOWN.some((k) => k === s.name || (s.name.length >= 3 && k.startsWith(s.name)))) throw new ExtError(T(ctx, 'errSub', { name: s.name }));

  const st = sub(cmd, 'STATUS');
  if (!st) throw new ExtError(T(ctx, 'errStatusMissing'));
  const { status, event } = parseStatus(st, vars, ctx);

  let strata: string | null = null;
  const sv = sub(cmd, 'STRATA');
  if (sv) {
    const r = varList(sv, 0, vars);
    if (r.names.length !== 1) throw new ExtError(T(ctx, 'errStrata'));
    strata = r.names[0];
  }

  const pr = sub(cmd, 'PRINT');
  const pk = keywords(pr);
  const table = pr ? pk.has('TABLE') && !pk.has('NONE') : true;
  const mean = pr ? pk.has('MEAN') && !pk.has('NONE') : true;

  let percentiles: number[] = [];
  const pc = sub(cmd, 'PERCENTILES');
  if (pc) {
    percentiles = pc.filter((t) => t.kind === 'num').map((t) => t.value!);
    if (!percentiles.length) percentiles = [25, 50, 75];
    if (percentiles.some((p) => !(p > 0 && p < 100))) throw new ExtError(T(ctx, 'errPercentile'));
  }

  const plots: Options['plots'] = [];
  const pl = sub(cmd, 'PLOT');
  if (pl) {
    const k = keywords(pl);
    if (!k.size) plots.push('survival');
    if (k.has('SURVIVAL')) plots.push('survival');
    if (k.has('HAZARD')) plots.push('hazard');
    if (k.has('LOGSURV')) plots.push('logsurv');
    if (k.has('OMS')) plots.push('oms');
  }

  const tests: TestType[] = [];
  const te = sub(cmd, 'TEST');
  const co = sub(cmd, 'COMPARE');
  if (te) {
    const k = keywords(te);
    if (k.has('LOGRANK')) tests.push('LOGRANK');
    if (k.has('BRESLOW')) tests.push('BRESLOW');
    if (k.has('TARONE')) tests.push('TARONE');
    if (!k.size) tests.push('LOGRANK');
  } else if (co) tests.push('LOGRANK');
  const ck = keywords(co);
  const warnings: string[] = [];
  if (sub(cmd, 'SAVE')) warnings.push(T(ctx, 'warnSave'));
  if (sub(cmd, 'TREND') || ck.has('TREND')) warnings.push(T(ctx, 'warnTrend'));
  return {
    time: head.names[0],
    factor,
    strata,
    status,
    event,
    table,
    mean,
    percentiles,
    plots,
    tests,
    pairwise: ck.has('PAIRWISE'),
    pooled: !ck.has('STRATA'),
    warnings,
  };
}

/* ----------------------------------------------------------------- output */

interface Level {
  key: string;
  value: Cell;
  label: string;
}

/** Sorted distinct values of a column among ROWS. */
function levelsOf(v: Variable, col: Cell[], rows: number[]): Level[] {
  const map = new Map<string, Cell>();
  for (const r of rows) map.set(JSON.stringify(col[r]), col[r]);
  return [...map.entries()]
    .sort(([, a], [, b]) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))))
    .map(([key, value]) => ({ key, value, label: valueText(v, value) }));
}

interface StubRow {
  /** stub labels; fewer than the stub width = the last one spans the rest (Overall rows) */
  stub: string[];
  cells: TCell[];
}

/** Body rows with hierarchical rowspans for all but the last stub column. */
function stubBody(rows: StubRow[], width: number): TCell[][] {
  return rows.map((r, i) => {
    const out: TCell[] = [];
    for (let c = 0; c < r.stub.length; c++) {
      const last = c === r.stub.length - 1;
      const colspan = last ? width - r.stub.length + 1 : 1;
      const same = (a: StubRow, b: StubRow) => a.stub.length > c + 1 && b.stub.length > c + 1 && a.stub.slice(0, c + 1).join('\u0000') === b.stub.slice(0, c + 1).join('\u0000');
      if (c < width - 1 && !last) {
        if (i > 0 && same(rows[i - 1], r)) continue;
        let span = 1;
        while (i + span < rows.length && same(rows[i + span], r)) span++;
        out.push(th(r.stub[c], { rowspan: span }));
      } else out.push(th(r.stub[c], { colspan }));
    }
    return [...out, ...r.cells];
  });
}

interface Cellset {
  stratum: Level | null;
  level: Level | null;
  fit: KmFit;
  obs: Obs[];
}

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const o = parseOptions(cmd, ctx);
  const ds = ctx.dataset;
  const time = variable(ds, o.time);
  const stat = variable(ds, o.status);
  requireNumeric(time.v);
  requireNumeric(stat.v);
  const fac = o.factor ? variable(ds, o.factor) : null;
  const str = o.strata ? variable(ds, o.strata) : null;
  const w = weights(ds);
  const isEvent = (x: number) => o.event.values.includes(x) || o.event.ranges.some(([a, b]) => x >= a && x <= b);
  const fmtT = (x: number) => fmt(x, time.v.print?.d ?? 0, ctx);
  const children: OutputItem[] = o.warnings.map((m) => messageItem('warning', m, ctx.line));

  for (const group of splitGroups(ds)) {
    if (group.label) children.push(textItem(group.label));
    let negative = 0;
    const rows = group.rows.filter((r) => {
      const t = time.col[r];
      const s = stat.col[r];
      if (isMissing(time.v, t) || isMissing(stat.v, s) || typeof t !== 'number' || typeof s !== 'number') return false;
      if (fac && isMissing(fac.v, fac.col[r])) return false;
      if (str && isMissing(str.v, str.col[r])) return false;
      if (t < 0) {
        negative++;
        return false;
      }
      return true;
    });
    if (negative) children.push(messageItem('warning', T(ctx, 'warnNegative', { count: negative }), ctx.line));
    if (!rows.length) {
      children.push(messageItem('warning', T(ctx, 'warnNoCases'), ctx.line));
      continue;
    }
    const obsOf = (r: number): Obs => ({ t: time.col[r] as number, event: isEvent(stat.col[r] as number), w: w[r], status: stat.col[r] });
    const sLevels: (Level | null)[] = str ? levelsOf(str.v, str.col, rows) : [null];
    const fLevels: Level[] = fac ? levelsOf(fac.v, fac.col, rows) : [];
    const inS = (r: number, s: Level | null) => !s || JSON.stringify(str!.col[r]) === s.key;
    const inF = (r: number, f: Level | null) => !f || JSON.stringify(fac!.col[r]) === f.key;
    const set = (s: Level | null, f: Level | null): Cellset => {
      const obs = rows.filter((r) => inS(r, s) && inF(r, f)).map(obsOf);
      return { stratum: s, level: f, fit: kmFit(obs), obs };
    };
    // cells: per stratum the factor levels (or the stratum itself without a factor)
    const cells: Cellset[] = [];
    const stratumAll = new Map<Level | null, Cellset>();
    for (const s of sLevels) {
      if (fac) for (const f of fLevels) cells.push(set(s, f));
      else cells.push(set(s, null));
      if (fac) stratumAll.set(s, set(s, null));
    }
    const overall = set(null, null);
    const stubW = (str ? 1 : 0) + (fac ? 1 : 0) || 1;
    const corner = (extra = 0, rowspan = 1): TCell[] => {
      const c: TCell[] = [];
      if (str) c.push(th(varTitle(str.v), { rowspan }));
      if (fac) c.push(th(varTitle(fac.v), { rowspan }));
      if (!str && !fac) c.push(th('', { rowspan }));
      if (extra) c.push(th('', { rowspan, colspan: extra }));
      return c;
    };
    const summaryRows = (cellsOf: (c: Cellset) => TCell[]): StubRow[] => {
      const out: StubRow[] = [];
      for (const s of sLevels) {
        for (const c of cells.filter((x) => x.stratum === s)) {
          const stub = [...(s ? [s.label] : []), ...(c.level ? [c.level.label] : [])];
          out.push({ stub: stub.length ? stub : [T(ctx, 'overall')], cells: cellsOf(c) });
        }
        if (s && fac) out.push({ stub: [s.label, T(ctx, 'overall')], cells: cellsOf(stratumAll.get(s)!) });
      }
      if (str || fac) out.push({ stub: [T(ctx, 'overall')], cells: cellsOf(overall) });
      return out;
    };
    const items: OutputItem[] = [];

    // Case Processing Summary
    const pct = (c: Cellset) => (c.fit.total > 0 ? fmt((100 * c.fit.censored) / c.fit.total, 1, ctx) + '%' : '');
    items.push(
      tableItem(
        {
          caption: T(ctx, 'cps'),
          head: [
            [...corner(0, 2), th(T(ctx, 'totalN'), { rowspan: 2 }), th(T(ctx, 'nEvents'), { rowspan: 2 }), th(T(ctx, 'censored'), { colspan: 2 })],
            [th(T(ctx, 'n')), th(T(ctx, 'percent'))],
          ],
          body: stubBody(
            summaryRows((c) => [td(fmtN(c.fit.total, ctx)), td(fmtN(c.fit.events, ctx)), td(fmtN(c.fit.censored, ctx)), td(pct(c))]),
            stubW,
          ),
        },
        NAME,
      ),
    );

    // Survival Table
    if (o.table) {
      const body: StubRow[] = [];
      for (const c of cells) {
        const pre = [...(c.stratum ? [c.stratum.label] : []), ...(c.level ? [c.level.label] : [])];
        c.fit.rows.forEach((r, i) =>
          body.push({
            stub: [...pre, String(i + 1)],
            cells: [
              td(fmtT(r.t)),
              td(valueText(stat.v, r.status ?? null)),
              td(r.est === null ? '' : fmt(r.est, 3, ctx)),
              td(r.se === null ? '' : fmt(r.se, 3, ctx)),
              td(fmtN(r.cumEvents, ctx)),
              td(fmtN(r.remaining, ctx)),
            ],
          }),
        );
      }
      const w2 = (str ? 1 : 0) + (fac ? 1 : 0) + 1;
      const head1: TCell[] = [];
      if (str) head1.push(th(varTitle(str.v), { rowspan: 2 }));
      if (fac) head1.push(th(varTitle(fac.v), { rowspan: 2 }));
      head1.push(th('', { rowspan: 2 }));
      items.push(
        tableItem(
          {
            caption: T(ctx, 'survTable'),
            head: [
              [
                ...head1,
                th(T(ctx, 'time'), { rowspan: 2 }),
                th(T(ctx, 'status'), { rowspan: 2 }),
                th(T(ctx, 'cumProp'), { colspan: 2 }),
                th(T(ctx, 'cumEvents'), { rowspan: 2 }),
                th(T(ctx, 'remaining'), { rowspan: 2 }),
              ],
              [th(T(ctx, 'estimate')), th(T(ctx, 'stdError'))],
            ],
            body: stubBody(body, w2),
          },
          NAME,
        ),
      );
    }

    // Means and Medians
    if (o.mean) {
      const ci = (est: number | null, se: number | null) => (est === null || se === null ? [td(''), td('')] : [td(fmt(est - Z * se, 3, ctx)), td(fmt(est + Z * se, 3, ctx))]);
      const vals = (c: Cellset): TCell[] => {
        const med = kmPercentile(c.fit, 50);
        return [
          td(fmt(c.fit.mean, 3, ctx)),
          td(fmt(c.fit.meanSe, 3, ctx)),
          ...ci(c.fit.mean, c.fit.meanSe),
          td(fmt(med.est, 3, ctx)),
          td(fmt(med.se, 3, ctx)),
          ...ci(med.est, med.se),
        ];
      };
      items.push(
        tableItem(
          {
            caption: T(ctx, 'means'),
            head: [
              [...corner(0, 3), th(T(ctx, 'meanA'), { colspan: 4 }), th(T(ctx, 'median'), { colspan: 4 })],
              [th(T(ctx, 'estimate'), { rowspan: 2 }), th(T(ctx, 'stdError'), { rowspan: 2 }), th(T(ctx, 'ci'), { colspan: 2 }), th(T(ctx, 'estimate'), { rowspan: 2 }), th(T(ctx, 'stdError'), { rowspan: 2 }), th(T(ctx, 'ci'), { colspan: 2 })],
              [th(T(ctx, 'lower')), th(T(ctx, 'upper')), th(T(ctx, 'lower')), th(T(ctx, 'upper'))],
            ],
            body: stubBody(summaryRows(vals), stubW),
            footnotes: [T(ctx, 'meanNote')],
          },
          NAME,
        ),
      );
    }

    // Percentiles
    if (o.percentiles.length) {
      const ps = o.percentiles;
      items.push(
        tableItem(
          {
            caption: T(ctx, 'percentiles'),
            head: [
              [...corner(0, 2), ...ps.map((p) => th(fmt(p, 1, ctx) + '%', { colspan: 2 }))],
              ps.flatMap(() => [th(T(ctx, 'estimate')), th(T(ctx, 'stdError'))]),
            ],
            body: stubBody(
              summaryRows((c) =>
                ps.flatMap((p) => {
                  // SPSS labels percentiles by the cumulative proportion surviving: the 25.0%
                  // column is the time by which 75% have had the event (S ≤ .25)
                  const r = kmPercentile(c.fit, 100 - p);
                  return [td(fmt(r.est, 3, ctx)), td(fmt(r.se, 3, ctx))];
                }),
              ),
              stubW,
            ),
          },
          NAME,
        ),
      );
    }

    // Tests
    if (o.tests.length) {
      if (!fac) children.push(messageItem('warning', T(ctx, 'warnNoFactor'), ctx.line));
      else {
        const testLabel = (t: TestType) => T(ctx, t === 'LOGRANK' ? 'logrank' : t === 'BRESLOW' ? 'breslow' : 'tarone');
        const byStratum = (s: Level | null, keep?: number[]): Obs[][] => fLevels.map((f, i) => (keep && !keep.includes(i) ? [] : (cells.find((c) => c.stratum === s && c.level === f)?.obs ?? [])));
        const sets: { label: string | null; strata: (Level | null)[] }[] = o.pooled || !str ? [{ label: null, strata: sLevels }] : sLevels.map((s) => ({ label: s!.label, strata: [s] }));
        const notes = [T(ctx, 'compNote', { factor: varTitle(fac.v) })];
        if (str && o.pooled) notes.push(T(ctx, 'compNoteStrata', { strata: varTitle(str.v) }));
        let fewLevels = false;
        if (!o.pairwise) {
          const body: StubRow[] = [];
          for (const st of sets)
            for (const t of o.tests) {
              const r = kmTest(
                st.strata.map((s) => byStratum(s)),
                t,
              );
              if (!r) fewLevels = true;
              body.push({ stub: [...(st.label !== null ? [st.label] : []), testLabel(t)], cells: [td(r ? fmt(r.chi, 3, ctx) : ''), td(r ? String(r.df) : ''), td(r ? fmtP(r.p, ctx) : '')] });
            }
          const sw = sets[0].label !== null ? 2 : 1;
          items.push(
            tableItem(
              {
                caption: T(ctx, 'overallComp'),
                head: [[...(sw === 2 ? [th(varTitle(str!.v))] : []), th(''), th(T(ctx, 'chiSquare')), th(T(ctx, 'df')), th(T(ctx, 'sig'))]],
                body: stubBody(body, sw),
                footnotes: notes,
              },
              NAME,
            ),
          );
        } else {
          const body: StubRow[] = [];
          for (const st of sets)
            for (const t of o.tests)
              fLevels.forEach((a, i) => {
                const cellsRow: TCell[] = [];
                fLevels.forEach((_, j) => {
                  if (i === j) return cellsRow.push(td(''), td(''));
                  const r = kmTest(
                    st.strata.map((s) => byStratum(s, [i, j])),
                    t,
                  );
                  if (!r) fewLevels = true;
                  cellsRow.push(td(r ? fmt(r.chi, 3, ctx) : ''), td(r ? fmtP(r.p, ctx) : ''));
                });
                body.push({ stub: [...(st.label !== null ? [st.label] : []), testLabel(t), a.label], cells: cellsRow });
              });
          const sw = sets[0].label !== null ? 3 : 2;
          items.push(
            tableItem(
              {
                caption: T(ctx, 'pairwise'),
                head: [
                  [...(sw === 3 ? [th(varTitle(str!.v), { rowspan: 2 })] : []), th('', { rowspan: 2 }), th(varTitle(fac.v), { rowspan: 2 }), ...fLevels.map((f) => th(f.label, { colspan: 2 }))],
                  fLevels.flatMap(() => [th(T(ctx, 'chiSquare')), th(T(ctx, 'sig'))]),
                ],
                body: stubBody(body, sw),
                footnotes: notes,
              },
              NAME,
            ),
          );
        }
        if (fewLevels) children.push(messageItem('warning', T(ctx, 'warnFewLevels'), ctx.line));
      }
    }

    // Plots: one per stratum
    for (const kind of o.plots) {
      for (const s of sLevels) {
        const title = T(ctx, `plot.${kind}`);
        const curves = cells
          .filter((c) => c.stratum === s)
          .map((c) => survivalCurve(c, kind, fac ? c.level!.label : str ? s!.label : varTitle(time.v)));
        items.push(
          chartItem(s ? `${title}: ${s.label}` : title, {
            type: 'survival',
            title: s ? `${title}: ${varTitle(str!.v)} = ${s.label}` : title,
            kind,
            xlabel: varTitle(time.v),
            ylabel: T(ctx, `axis.${kind}`),
            legendTitle: fac ? varTitle(fac.v) : '',
            censoredLabel: T(ctx, 'censoredMark'),
            curves,
          }),
        );
      }
    }
    children.push(...items);
  }
  return [groupItem(T(ctx, 'title'), NAME, children)];
}

const yOf = (s: number, kind: string): number | null => {
  if (kind === 'survival') return s;
  if (kind === 'oms') return 1 - s;
  if (s <= 0) return null;
  return kind === 'hazard' ? -Math.log(s) : Math.log(s);
};

/** Points of a step curve (start, every event time, end) plus censor marks, on the plot's scale. */
function survivalCurve(c: Cellset, kind: string, name: string) {
  const points: [number, number][] = [];
  const y0 = yOf(1, kind)!;
  points.push([0, y0]);
  let stop: number | null = null; // time where −ln S / ln S become infinite (S = 0)
  for (const st of c.fit.steps) {
    const y = yOf(st.s, kind);
    if (y === null) {
      stop = st.t;
      break;
    }
    points.push([st.t, y]);
  }
  const censored = c.fit.censor.flatMap((x) => {
    const y = yOf(x.s, kind);
    return y === null ? [] : [[x.t, y] as [number, number]];
  });
  // the last step runs to the largest observed time, or to the time S reaches 0 on log scales
  return { name, points, censored, end: stop ?? c.fit.tmax };
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
