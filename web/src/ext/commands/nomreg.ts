/*
 * NOMREG – multinomial logistic regression, SPSS syntax and output:
 *   log(P(Y = k) / P(Y = ref)) = x·βk  for every non-reference category k,
 * reference category last by default (BASE=FIRST|LAST|value), factors dummy-coded with the last
 * category redundant; Newton–Raphson with step halving on the subpopulation likelihood (frequency
 * weights enter it).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem } from '../../engine/types';
import { splitGroups, valueText, varTitle } from '../data';
import { normInv } from '../dist';
import { isKw, sub, type ParsedCommand, type Token } from '../parse';
import { fmt, fmtN, groupItem, messageItem, tableItem, td, textItem, th, type Cell } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';
import { zeros, type Matrix } from '../linalg';
import {
  applyDelta, chiP, cmpValue, covariance, cpsTable, gofTable, goodness, m2ll, mark, mfiTable, newton, parseCriteria, parseEffects, parseHead, prepare, pseudoR2, pseudoTable,
  type Criteria, type Effect, type Eval, type ModelData, type Value,
} from '../catmodel';

const NAME = 'NOMREG';
const P = 'ext.nomreg';

interface MnModel {
  md: ModelData;
  K: number;
  ref: number;
  /** non-reference categories in output order */
  others: number[];
  intercept: boolean;
  /** columns per equation (intercept included) */
  q: number;
}

const rowX = (m: MnModel, x: number[]) => (m.intercept ? [1, ...x] : x);

/** Linear predictors for all categories (reference = 0) and the softmax probabilities. */
function predict(m: MnModel, b: number[], x: number[]): { eta: number[]; pi: number[] } {
  const xx = rowX(m, x);
  const eta = new Array(m.K).fill(0);
  m.others.forEach((k, e) => {
    let s = 0;
    for (let c = 0; c < m.q; c++) s += xx[c] * b[e * m.q + c];
    eta[k] = s;
  });
  const mx = Math.max(...eta);
  const ex = eta.map((v) => Math.exp(v - mx));
  const tot = ex.reduce((a, v) => a + v, 0);
  return { eta, pi: ex.map((v) => v / tot) };
}

function evaluate(m: MnModel, b: number[], deriv: boolean): Eval {
  const np = m.q * m.others.length;
  let ll = 0;
  const g = deriv ? new Array(np).fill(0) : undefined;
  const H = deriv ? zeros(np, np) : undefined;
  for (const p of m.md.patterns) {
    const { eta, pi } = predict(m, b, p.x);
    const mx = Math.max(...eta);
    const lse = mx + Math.log(eta.reduce((s, v) => s + Math.exp(v - mx), 0));
    for (let j = 0; j < m.K; j++) if (p.y[j] > 0) ll += p.y[j] * (eta[j] - lse);
    if (!deriv) continue;
    const xx = rowX(m, p.x);
    m.others.forEach((k, e) => {
      const r = p.y[k] - p.n * pi[k];
      for (let c = 0; c < m.q; c++) g![e * m.q + c] += r * xx[c];
      m.others.forEach((l, f) => {
        const w = p.n * pi[k] * ((k === l ? 1 : 0) - pi[l]);
        if (w === 0) return;
        for (let c = 0; c < m.q; c++) {
          if (xx[c] === 0) continue;
          for (let d = 0; d < m.q; d++) H![e * m.q + c][f * m.q + d] -= w * xx[c] * xx[d];
        }
      });
    });
  }
  return { ok: Number.isFinite(ll), ll, g, H };
}

function startValues(m: MnModel): number[] {
  const b = new Array(m.q * m.others.length).fill(0);
  const c = m.md.catCount;
  if (m.intercept && c[m.ref] > 0) m.others.forEach((k, e) => (b[e * m.q] = c[k] > 0 ? Math.log(c[k] / c[m.ref]) : 0));
  return b;
}

interface FitOut {
  model: MnModel;
  ll: number;
  params: number[];
  converged: boolean;
  stepFailed: boolean;
  singular: boolean;
  H: Matrix;
  history: ReturnType<typeof newton>['history'];
}

function fitModel(ds: Dataset, rows: number[], o: { dep: string; factors: string[]; covariates: string[]; effects: Effect[]; includeUser: boolean; intercept: boolean; descending: boolean; base: Base }, crit: Criteria, ctx: ExtContext): FitOut {
  const md = prepare(ds, rows, { ...o, constant: o.intercept }, ctx);
  return fitPrepared(md, o.intercept, o.base, crit);
}

function fitPrepared(md: ModelData, intercept: boolean, base: Base, crit: Criteria): FitOut {
  const K = md.cats.length;
  const ref = refIndex(md.cats, base);
  const q = (intercept ? 1 : 0) + md.columns.filter((c) => !c.redundant).length;
  const model: MnModel = { md, K, ref, others: md.cats.map((_, i) => i).filter((i) => i !== ref), intercept, q };
  if (model.others.length * q === 0) {
    const e = evaluate(model, [], false);
    return { model, ll: e.ll, params: [], converged: true, stepFailed: false, singular: false, H: [], history: [{ iter: 0, ll: e.ll, halvings: 0, params: [] }] };
  }
  const r = newton((b, d) => evaluate(model, b, d), startValues(model), crit);
  return { model, ll: r.ll, params: r.params, converged: r.converged, stepFailed: r.stepFailed, singular: r.singular, H: r.H, history: r.history };
}

type Base = { kind: 'FIRST' | 'LAST' } | { kind: 'VALUE'; value: Value };

function refIndex(cats: Value[], base: Base): number {
  if (base.kind !== 'VALUE') return base.kind === 'FIRST' ? 0 : cats.length - 1;
  const v = base.value;
  const i = cats.findIndex((c) => (typeof c === 'number' ? c === Number(v) : c === String(v).trimEnd()));
  if (i < 0) throw new ExtError(`The reference category ${v} is not an observed value of the dependent variable.`);
  return i;
}

function parseOpts(opts: Token[]): { base: Base; descending: boolean } {
  let base: Base = { kind: 'LAST' };
  let descending = false;
  for (let i = 0; i < opts.length; i++) {
    const t = opts[i];
    if (t.text === ',') continue;
    const val = opts[i + 1]?.text === '=' ? opts[i + 2] : undefined;
    if (isKw(t, 'BASE') && val) {
      if (isKw(val, 'FIRST')) base = { kind: 'FIRST' };
      else if (isKw(val, 'LAST')) base = { kind: 'LAST' };
      else if (val.kind === 'num' || val.kind === 'str') base = { kind: 'VALUE', value: val.kind === 'num' ? val.value! : val.text };
      else throw new ExtError('BASE must be FIRST, LAST or a value.');
      i += 2;
    } else if (isKw(t, 'ORDER') && val) {
      if (isKw(val, 'ASCENDING')) descending = false;
      else if (isKw(val, 'DESCENDING')) descending = true;
      else throw new ExtError('ORDER must be ASCENDING or DESCENDING.');
      i += 2;
    } else throw new ExtError(`Unexpected '${t.text}' in the dependent variable options.`);
  }
  return { base, descending };
}

function parsePrint(tokens: Token[] | null) {
  const out = { cps: false, mfi: false, summary: false, lrt: false, parameter: false, fit: false, classtable: false, history: 0, kernel: false, ignored: [] as string[] };
  if (!tokens) return { ...out, cps: true, mfi: true, summary: true, lrt: true, parameter: true };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.kind !== 'id') continue;
    const k = tk.text.toUpperCase();
    const m = (n: string) => k === n || (k.length >= 3 && n.startsWith(k));
    if (m('CPS')) out.cps = true;
    else if (m('MFI')) out.mfi = true;
    else if (m('SUMMARY')) out.summary = true;
    else if (m('LRT')) out.lrt = true;
    else if (m('PARAMETER')) out.parameter = true;
    else if (m('FIT')) out.fit = true;
    else if (m('CLASSTABLE')) out.classtable = true;
    else if (m('KERNEL')) out.kernel = true;
    else if (m('HISTORY')) {
      const n = tokens[i + 1]?.text === '(' ? tokens[i + 2]?.value : undefined;
      out.history = n && n > 0 ? Math.round(n) : 1;
    } else if (m('NONE') || m('STEP')) continue;
    else if (m('ASSOCIATION') || m('CELLPROB') || m('CORB') || m('COVB') || m('IC')) out.ignored.push(k);
    else throw new ExtError(`Unknown keyword ${tk.text} on PRINT.`);
  }
  return out;
}

/** All main effects and factor-by-factor interactions (FULLFACTORIAL), covariates as main effects. */
function fullFactorial(factors: string[], covariates: string[]): Effect[] {
  const out: Effect[] = covariates.map((c) => [c]);
  const subsets: string[][] = [];
  for (let mask = 1; mask < 1 << factors.length; mask++) subsets.push(factors.filter((_, i) => mask & (1 << i)));
  subsets.sort((a, b) => a.length - b.length);
  return [...out, ...subsets];
}

/** Unrounded results per split group, collected only while a test sets SINK (test hook). */
export interface NomregRaw {
  /** per non-reference category (output order): coefficients and standard errors */
  B: number[][];
  SE: number[][];
  ll: number;
  ll0: number;
  logConst: number;
  pearson: number;
  deviance: number;
  warnings: string[];
}
export const inspect: { sink: NomregRaw[] | null } = { sink: null };

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const ds = ctx.dataset;
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const head = parseHead(cmd.head, ds.variables);
  const { base, descending } = parseOpts(head.opts);
  const SUBS = ['CRITERIA', 'FULLFACTORIAL', 'INTERCEPT', 'MISSING', 'MODEL', 'OUTFILE', 'PRINT', 'SAVE', 'SCALE', 'SUBPOP', 'TEST', 'STEPWISE'];
  for (const s of cmd.subs) if (!SUBS.some((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name)))) throw new ExtError(`Unknown subcommand ${s.name}.`);
  if (sub(cmd, 'SCALE')) throw new ExtError('The SCALE subcommand (dispersion scaling) is not supported.');
  if (sub(cmd, 'STEPWISE')) throw new ExtError('Stepwise model selection is not supported.');
  const crit = parseCriteria(sub(cmd, 'CRITERIA'));
  const print = parsePrint(sub(cmd, 'PRINT'));
  const includeUser = isKw(sub(cmd, 'MISSING')?.[0], 'INCLUDE');
  const icTok = sub(cmd, 'INTERCEPT');
  const intercept = !isKw(icTok?.[0], 'EXCLUDE', 'NO');
  const modelTok = sub(cmd, 'MODEL');
  if (modelTok && modelTok.some((x) => x.text === '|' || isKw(x, 'FORWARD', 'BACKWARD', 'FSTEP', 'BSTEP'))) throw new ExtError('Stepwise model selection is not supported.');
  const effects = cmd.subs.some((s) => s.name.length >= 3 && 'FULLFACTORIAL'.startsWith(s.name)) && !modelTok?.length ? fullFactorial(head.factors, head.covariates) : parseEffects(modelTok, head.factors, head.covariates);

  const out: OutputItem[] = [];
  for (const [s, key] of [['SAVE', 'saveIgnored'], ['OUTFILE', 'saveIgnored'], ['TEST', 'testIgnored'], ['SUBPOP', 'subpopIgnored']] as const) if (sub(cmd, s)) out.push(messageItem('warning', t(key), ctx.line));
  for (const k of print.ignored) out.push(messageItem('warning', t('keywordIgnored', { keyword: k }), ctx.line));
  const opts = { dep: head.dep, factors: head.factors, covariates: head.covariates, effects, includeUser, intercept, descending, base };

  for (const group of splitGroups(ds)) {
    const items: OutputItem[] = [];
    if (group.label) items.push(textItem(group.label));
    const md = prepare(ds, group.rows, { ...opts, constant: intercept }, ctx);
    if (md.nValid <= 0) {
      items.push(messageItem('warning', t('noValid'), ctx.line));
      out.push(...items);
      continue;
    }
    if (md.cats.length < 2) {
      items.push(cpsTable(md, ctx, P, NAME));
      items.push(messageItem('warning', t('oneCategory'), ctx.line));
      out.push(...items);
      continue;
    }
    applyDelta(md, crit.delta);
    const fit = fitPrepared(md, intercept, base, crit);
    const m = fit.model;
    const K = m.K;
    const pr = md.patterns.map((p) => predict(m, fit.params, p.x).pi);
    const g = goodness(md, pr);
    const warnings: string[] = [];
    if (md.covariates.length && g.zeroCells > 0) warnings.push(t('zeroCells', { n: g.zeroCells, pct: fmt((100 * g.zeroCells) / g.cells, 1, ctx) }));
    let sep = 0;
    let obs = 0;
    let tiny = 0;
    md.patterns.forEach((p, i) =>
      p.y.forEach((y, j) => {
        if (pr[i][j] < 1e-8) tiny++;
        if (y <= 0) return;
        obs++;
        const comp = pr[i].reduce((s, v, k) => (k === j ? s : s + v), 0);
        if (comp < 1e-8) sep++;
      }),
    );
    const cov = covariance(fit.H, crit.singular);
    let doubtful = false;
    if (sep > 0 && sep === obs) warnings.push(t('completeSep')), (doubtful = true);
    else if (sep > 0 || tiny > 0) warnings.push(t('quasiSep')), (doubtful = true);
    if ((!cov || fit.singular) && fit.params.length) warnings.push(t('singular')), (doubtful = true);
    if (fit.stepFailed) warnings.push(t('stepFailed')), (doubtful = true);
    else if (!fit.converged) warnings.push(t('maxIter', { n: crit.mxiter })), (doubtful = true);
    if (doubtful) warnings.push(t('continues'));
    for (const w of warnings) items.push(messageItem('warning', w, ctx.line));

    if (inspect.sink) {
      const se = fit.params.map((_, i) => (cov ? Math.sqrt(cov[i][i]) : NaN));
      const blocks = (v: number[]) => m.others.map((_, e) => v.slice(e * m.q, (e + 1) * m.q));
      inspect.sink.push({ B: blocks(fit.params), SE: blocks(se), ll: fit.ll, ll0: 0, logConst: md.logConst, pearson: g.pearson, deviance: g.deviance, warnings });
    }
    if (print.cps) {
      const single = md.patterns.filter((p) => p.y.filter((y) => y > 0).length === 1).length;
      const s = md.patterns.length;
      items.push(
        cpsTable(md, ctx, P, NAME, [[th(t('subpop'), { colspan: 2 }), td(`${s}${mark(0)}`), td('')]], [t('singleValue', { n: single, pct: fmt((100 * single) / s, 1, ctx) })]),
      );
    }
    // null model: intercept only, or all logits 0 without an intercept
    const ll0 = intercept ? md.catCount.reduce((s, n) => s + (n > 0 ? n * Math.log(n / md.nValid) : 0), 0) : md.nValid * Math.log(1 / K);
    const last = inspect.sink?.[inspect.sink.length - 1];
    if (last) last.ll0 = ll0;
    const nonRed = m.q - (intercept ? 1 : 0);
    const dfModel = (K - 1) * nonRed;
    const labels = paramLabels(m, ctx);
    if (print.history) items.push(historyTable(fit, print.history, labels, print.kernel, ctx));
    if (print.mfi) items.push(mfiTable(ctx, P, NAME, intercept ? t('interceptOnly') : t('null'), m2ll(md, ll0, print.kernel), m2ll(md, fit.ll, print.kernel), dfModel, true));
    if (print.fit) items.push(gofTable(ctx, P, NAME, g, md.patterns.length * (K - 1) - (K - 1) * m.q));
    if (print.summary) items.push(pseudoTable(ctx, P, NAME, pseudoR2(ll0, fit.ll, md.nValid)));
    if (print.lrt) items.push(lrtTable(ds, group.rows, opts, md, fit, crit, print.kernel, ctx));
    if (print.parameter) items.push(paramTable(m, fit.params, cov, crit.cin, ctx));
    if (print.classtable) items.push(classTable(m, pr, ctx));
    out.push(...items);
  }
  return [groupItem(t('title'), NAME, out)];
}

function paramLabels(m: MnModel, ctx: ExtContext): string[] {
  const cols = [...(m.intercept ? [ctx.t(`${P}.intercept`)] : []), ...m.md.columns.filter((c) => !c.redundant).map((c) => c.label)];
  return m.others.flatMap((k) => cols.map((c) => `${valueText(m.md.dep, m.md.cats[k])}: ${c}`));
}

function historyTable(fit: FitOut, every: number, labels: string[], kernel: boolean, ctx: ExtContext): OutputItem {
  const t = (k: string) => ctx.t(`${P}.${k}`);
  const rows = fit.history.filter((r, i) => r.iter % every === 0 || i === fit.history.length - 1);
  return tableItem(
    {
      caption: t('history'),
      head: [[th(t('iteration')), th(t('m2ll')), th(t('stepHalving')), ...labels.map((l) => th(l))]],
      body: rows.map((r) => [th(String(r.iter)), td(fmt(m2ll(fit.model.md, r.ll, kernel), 3, ctx)), td(String(r.halvings)), ...r.params.map((x) => td(fmt(x, 3, ctx)))]),
    },
    NAME,
  );
}

function lrtTable(ds: Dataset, rows: number[], opts: Parameters<typeof fitModel>[2], md: ModelData, fit: FitOut, crit: Criteria, kernel: boolean, ctx: ExtContext): OutputItem {
  const t = (k: string) => ctx.t(`${P}.${k}`);
  const K = fit.model.K;
  const full = m2ll(md, fit.ll, kernel);
  const body: Cell[][] = [];
  let anyZero = false;
  const row = (label: string, reduced: FitOut) => {
    const df = (K - 1) * (fit.model.q - reduced.model.q);
    const r = m2ll(md, reduced.ll, kernel);
    if (df <= 0) {
      anyZero = true;
      body.push([th(label), td(`${fmt(full, 3, ctx)}${mark(1)}`), td(fmt(0, 3, ctx)), td('0'), td('')]);
    } else body.push([th(label), td(fmt(r, 3, ctx)), td(fmt(r - full, 3, ctx)), td(String(df)), td(fmt(chiP(r - full, df), 3, ctx))]);
  };
  if (opts.intercept) row(t('intercept'), fitModel(ds, rows, { ...opts, intercept: false }, crit, ctx));
  opts.effects.forEach((e, i) => row(e.map((n) => ds.variables.find((v) => v.name.toUpperCase() === n.toUpperCase())?.name ?? n).join(' * '), fitModel(ds, rows, { ...opts, effects: opts.effects.filter((_, j) => j !== i) }, crit, ctx)));
  return tableItem(
    {
      caption: t('lrtTitle'),
      head: [
        [th(t('effect'), { rowspan: 2 }), th(t('criteria')), th(t('lrt'), { colspan: 3 })],
        [th(t('m2llReduced')), th(t('chisq')), th(t('df')), th(t('sig'))],
      ],
      body,
      footnotes: [t('lrtNote'), ...(anyZero ? [t('lrtEquivalent')] : [])],
    },
    NAME,
  );
}

function paramTable(m: MnModel, b: number[], cov: Matrix | null, cin: number, ctx: ExtContext): OutputItem {
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const z = normInv(1 - (1 - cin / 100) / 2);
  const md = m.md;
  const body: Cell[][] = [];
  let anyRed = false;
  const nRows = (m.intercept ? 1 : 0) + md.columns.length;
  m.others.forEach((k, e) => {
    let first = true;
    const lead = () => {
      const c = first ? [th(valueText(md.dep, md.cats[k]), { rowspan: nRows })] : [];
      first = false;
      return c;
    };
    let idx = e * m.q;
    const est = (label: string, isIntercept: boolean) => {
      const bb = b[idx];
      const se = cov ? Math.sqrt(cov[idx][idx]) : NaN;
      idx++;
      const w = (bb / se) ** 2;
      body.push([
        ...lead(), th(label), td(fmt(bb, 3, ctx)), td(fmt(se, 3, ctx)), td(fmt(w, 3, ctx)), td('1'), td(fmt(chiP(w, 1), 3, ctx)),
        td(isIntercept ? '' : fmt(Math.exp(bb), 3, ctx)), td(isIntercept ? '' : fmt(Math.exp(bb - z * se), 3, ctx)), td(isIntercept ? '' : fmt(Math.exp(bb + z * se), 3, ctx)),
      ]);
    };
    if (m.intercept) est(t('intercept'), true);
    for (const c of md.columns) {
      if (c.redundant) {
        anyRed = true;
        body.push([...lead(), th(c.label), td(`0${mark(1)}`), td(''), td(''), td('0'), td(''), td(''), td(''), td('')]);
      } else est(c.label, false);
    }
  });
  const ci = fmt(cin, Number.isInteger(cin) ? 0 : 1, ctx);
  return tableItem(
    {
      caption: t('params'),
      head: [
        [th(`${varTitle(md.dep)}${mark(0)}`, { colspan: 2, rowspan: 2 }), th('B', { rowspan: 2 }), th(t('se'), { rowspan: 2 }), th(t('wald'), { rowspan: 2 }), th(t('df'), { rowspan: 2 }), th(t('sig'), { rowspan: 2 }), th(t('expB'), { rowspan: 2 }), th(t('ci', { level: ci }), { colspan: 2 })],
        [th(t('lower')), th(t('upper'))],
      ],
      body,
      footnotes: [t('reference', { category: valueText(md.dep, md.cats[m.ref]) }), ...(anyRed ? [t('redundant')] : [])],
    },
    NAME,
  );
}

function classTable(m: MnModel, pr: number[][], ctx: ExtContext): OutputItem {
  const t = (k: string) => ctx.t(`${P}.${k}`);
  const md = m.md;
  const K = m.K;
  // display order: categories ascending (as SPSS lists them), whatever ORDER was
  const order = md.cats.map((_, i) => i).sort((a, b) => cmpValue(md.cats[a], md.cats[b]));
  const tab = zeros(K, K);
  md.patterns.forEach((p, i) => {
    let best = 0;
    for (let k = 1; k < K; k++) if (pr[i][k] > pr[i][best] + 1e-12) best = k;
    p.y.forEach((y, j) => (tab[j][best] += y));
  });
  const tot = tab.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
  const pct = (x: number, n: number) => (n > 0 ? `${fmt((100 * x) / n, 1, ctx)}%` : '');
  const body: Cell[][] = order.map((j) => {
    const rt = tab[j].reduce((a, b) => a + b, 0);
    return [th(valueText(md.dep, md.cats[j])), ...order.map((k) => td(fmtN(round(tab[j][k]), ctx))), td(pct(tab[j][j], rt))];
  });
  const correct = order.reduce((s, j) => s + tab[j][j], 0);
  body.push([th(t('overall')), ...order.map((k) => td(pct(tab.reduce((s, r) => s + r[k], 0), tot))), td(pct(correct, tot))]);
  return tableItem(
    {
      caption: t('classification'),
      head: [
        [th(t('observed'), { rowspan: 2 }), th(t('predicted'), { colspan: K + 1 })],
        [...order.map((k) => th(valueText(md.dep, md.cats[k]))), th(t('pctCorrect'))],
      ],
      body,
    },
    NAME,
  );
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

export const commands: ExtCommand[] = [{ name: NAME, run }];
