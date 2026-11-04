/*
 * PLUM – ordinal (cumulative link) regression, SPSS syntax and output:
 *   link(P(Y ≤ j)) = θj − (β·x), j = 1 … J−1,
 * links LOGIT, PROBIT, CLOGLOG, NLOGLOG, CAUCHIT; factors dummy-coded with the last category
 * redundant (set to zero); fitted by Newton–Raphson with step halving on the subpopulation
 * likelihood (frequency weights enter it); standard errors from the observed information.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { OutputItem } from '../../engine/types';
import { splitGroups } from '../data';
import { normInv } from '../dist';
import { isKw, keywords, sub, kwArg, type ParsedCommand } from '../parse';
import { fmt, groupItem, messageItem, tableItem, td, textItem, th, type Cell } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';
import { zeros, type Matrix } from '../linalg';
import {
  LINKS, applyDelta, chiP, covariance, cpsTable, gofTable, goodness, m2ll, mark, mfiTable, newton, parseCriteria, parseEffects, parseHead, prepare, pseudoR2, pseudoTable, valueCode,
  type Criteria, type Eval, type Link, type LinkName, type ModelData,
} from '../catmodel';

const NAME = 'PLUM';
const P = 'ext.plum';
const LINK_KEYS: Record<LinkName, string> = { LOGIT: 'logit', PROBIT: 'probit', CLOGLOG: 'cloglog', NLOGLOG: 'nloglog', CAUCHIT: 'cauchit' };

interface CumModel {
  md: ModelData;
  link: Link;
  J: number;
  q: number;
  parallel: boolean;
}

const nParams = (m: CumModel) => m.J - 1 + m.q * (m.parallel ? 1 : m.J - 1);

/** u_k = θ_k − x·β_k for the thresholds of one pattern. */
function thresholdsU(m: CumModel, b: number[], x: number[]): number[] {
  const u: number[] = [];
  for (let k = 0; k < m.J - 1; k++) {
    const base = m.J - 1 + (m.parallel ? 0 : k * m.q);
    let eta = 0;
    for (let c = 0; c < m.q; c++) eta += x[c] * b[base + c];
    u.push(b[k] - eta);
  }
  return u;
}

/** P(Y = j) from the thresholds' u values, using the upper tail where it is more accurate. */
function catProb(link: Link, u: number[], j: number): number {
  const J = u.length + 1;
  if (j === 0) return link.cdf(u[0]);
  if (j === J - 1) return link.sf(u[J - 2]);
  return u[j - 1] > 0 ? link.sf(u[j - 1]) - link.sf(u[j]) : link.cdf(u[j]) - link.cdf(u[j - 1]);
}

/** 1 − P(Y = j), accurate when P(Y = j) is close to 1 (separation check). */
function catComplement(link: Link, u: number[], j: number): number {
  const J = u.length + 1;
  return (j > 0 ? link.cdf(u[j - 1]) : 0) + (j < J - 1 ? link.sf(u[j]) : 0);
}

function probs(m: CumModel, b: number[]): number[][] {
  return m.md.patterns.map((p) => {
    const u = thresholdsU(m, b, p.x);
    return Array.from({ length: m.J }, (_, j) => catProb(m.link, u, j));
  });
}

function evaluate(m: CumModel, b: number[], deriv: boolean): Eval {
  const np = nParams(m);
  let ll = 0;
  const g = deriv ? new Array(np).fill(0) : undefined;
  const H = deriv ? zeros(np, np) : undefined;
  // d u_k / d params as a sparse list
  const dU = (k: number, x: number[]): [number, number][] => {
    const base = m.J - 1 + (m.parallel ? 0 : k * m.q);
    const out: [number, number][] = [[k, 1]];
    for (let c = 0; c < m.q; c++) if (x[c] !== 0) out.push([base + c, -x[c]]);
    return out;
  };
  for (const p of m.md.patterns) {
    const u = thresholdsU(m, b, p.x);
    for (let j = 0; j < m.J; j++) {
      const y = p.y[j];
      if (y <= 0) continue;
      const pi = catProb(m.link, u, j);
      if (!(pi > 0) || !Number.isFinite(pi)) return { ok: false, ll: -Infinity };
      ll += y * Math.log(pi);
      if (!deriv) continue;
      const dp = new Array(np).fill(0);
      const terms: { s: number; d: [number, number][]; f: number; fp: number }[] = [];
      if (j < m.J - 1) terms.push({ s: 1, d: dU(j, p.x), f: m.link.pdf(u[j]), fp: m.link.dpdf(u[j]) });
      if (j > 0) terms.push({ s: -1, d: dU(j - 1, p.x), f: m.link.pdf(u[j - 1]), fp: m.link.dpdf(u[j - 1]) });
      for (const t of terms) for (const [i, c] of t.d) dp[i] += t.s * t.f * c;
      const nz = dp.map((x, i) => (x !== 0 ? i : -1)).filter((i) => i >= 0);
      for (const i of nz) g![i] += (y * dp[i]) / pi;
      for (const i of nz) for (const k of nz) H![i][k] -= (y * dp[i] * dp[k]) / (pi * pi);
      for (const t of terms) for (const [i, ci] of t.d) for (const [k, ck] of t.d) H![i][k] += (y * t.s * t.fp * ci * ck) / pi;
    }
  }
  const info = deriv
    ? () => {
        const I = zeros(np, np);
        for (const p of m.md.patterns) {
          const u = thresholdsU(m, b, p.x);
          for (let j = 0; j < m.J; j++) {
            const pi = catProb(m.link, u, j);
            if (!(pi > 0)) continue;
            const dp = new Array(np).fill(0);
            if (j < m.J - 1) for (const [i, c] of dU(j, p.x)) dp[i] += m.link.pdf(u[j]) * c;
            if (j > 0) for (const [i, c] of dU(j - 1, p.x)) dp[i] -= m.link.pdf(u[j - 1]) * c;
            for (let i = 0; i < np; i++) if (dp[i]) for (let k = 0; k < np; k++) I[i][k] += (p.n * dp[i] * dp[k]) / pi;
          }
        }
        return I;
      }
    : undefined;
  return { ok: Number.isFinite(ll), ll, g, H, info };
}

/** Thresholds from the cumulative marginal proportions (the intercept-only MLE), β = 0. */
function startValues(m: CumModel): number[] {
  const tot = m.md.catCount.reduce((a, b) => a + b, 0);
  let cum = 0;
  const th0: number[] = [];
  for (let j = 0; j < m.J - 1; j++) {
    cum += m.md.catCount[j];
    th0.push(m.link.quantile(cum / tot));
  }
  return [...th0, ...new Array(nParams(m) - (m.J - 1)).fill(0)];
}

function parsePrint(tokens: ReturnType<typeof sub>) {
  const kw = keywords(tokens);
  const out = { fit: false, parameter: false, summary: false, tparallel: false, history: 0, kernel: false, ignored: [] as string[] };
  if (!tokens) return { ...out, fit: true, parameter: true, summary: true };
  for (const k of kw) {
    const m = (n: string) => k === n || (k.length >= 3 && n.startsWith(k));
    if (m('FIT')) out.fit = true;
    else if (m('PARAMETER')) out.parameter = true;
    else if (m('SUMMARY')) out.summary = true;
    else if (m('TPARALLEL')) out.tparallel = true;
    else if (m('KERNEL')) out.kernel = true;
    else if (m('HISTORY')) {
      const a = kwArg(tokens, k);
      out.history = a?.[0]?.value && a[0].value > 0 ? Math.round(a[0].value) : 1;
    } else if (m('NONE')) continue;
    else if (m('CELLINFO') || m('CORB') || m('COVB')) out.ignored.push(k);
    else throw new ExtError(`Unknown keyword ${k} on PRINT.`);
  }
  return out;
}

/** Unrounded results per split group, collected only while a test sets SINK (test hook). */
export interface PlumRaw {
  params: number[];
  se: number[];
  ll: number;
  ll0: number;
  logConst: number;
  pearson: number;
  deviance: number;
  llGeneral?: number;
  warnings: string[];
}
export const inspect: { sink: PlumRaw[] | null } = { sink: null };

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const ds = ctx.dataset;
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const head = parseHead(cmd.head, ds.variables);
  if (head.opts.length) throw new ExtError(`Unexpected '(' after the dependent variable.`);
  for (const s of cmd.subs)
    if (!['LINK', 'CRITERIA', 'LOCATION', 'PRINT', 'MISSING', 'SAVE', 'SCALE', 'TEST'].some((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name))))
      throw new ExtError(`Unknown subcommand ${s.name}.`);
  if (sub(cmd, 'SCALE')) throw new ExtError('The SCALE subcommand (scale component) is not supported.');
  const linkTok = sub(cmd, 'LINK');
  let linkName: LinkName = 'LOGIT';
  if (linkTok) {
    const k = linkTok[0]?.text.toUpperCase() ?? '';
    const found = (Object.keys(LINKS) as LinkName[]).find((n) => n === k || (k.length >= 3 && n.startsWith(k)));
    if (!found || linkTok.length !== 1) throw new ExtError(`LINK must be one of LOGIT, PROBIT, CLOGLOG, NLOGLOG, CAUCHIT.`);
    linkName = found;
  }
  const crit: Criteria = parseCriteria(sub(cmd, 'CRITERIA'));
  const print = parsePrint(sub(cmd, 'PRINT'));
  const missTok = sub(cmd, 'MISSING');
  const includeUser = isKw(missTok?.[0], 'INCLUDE');
  const effects = parseEffects(sub(cmd, 'LOCATION'), head.factors, head.covariates);
  const link = LINKS[linkName];
  const linkNote = t('linkNote', { link: t(`links.${LINK_KEYS[linkName]}`) });

  const out: OutputItem[] = [];
  if (sub(cmd, 'SAVE')) out.push(messageItem('warning', t('saveIgnored'), ctx.line));
  if (sub(cmd, 'TEST')) out.push(messageItem('warning', t('testIgnored'), ctx.line));
  for (const k of print.ignored) out.push(messageItem('warning', t('keywordIgnored', { keyword: k }), ctx.line));

  for (const group of splitGroups(ds)) {
    const items: OutputItem[] = [];
    if (group.label) items.push(textItem(group.label));
    const md = prepare(ds, group.rows, { dep: head.dep, factors: head.factors, covariates: head.covariates, effects, includeUser, constant: true }, ctx);
    if (md.nValid <= 0) {
      items.push(messageItem('warning', t('noValid'), ctx.line));
      out.push(...items);
      continue;
    }
    const J = md.cats.length;
    if (J < 2) {
      items.push(cpsTable(md, ctx, P, NAME));
      items.push(messageItem('warning', t('oneCategory'), ctx.line));
      out.push(...items);
      continue;
    }
    applyDelta(md, crit.delta);
    const q = md.columns.filter((c) => !c.redundant).length;
    const model: CumModel = { md, link, J, q, parallel: true };
    const fit = newton((b, d) => evaluate(model, b, d), startValues(model), crit);
    const ll0 = md.catCount.reduce((s, n) => s + (n > 0 ? n * Math.log(n / md.nValid) : 0), 0);
    const pr = probs(model, fit.params);
    const warnings: string[] = [];
    const g = goodness(md, pr);
    if (md.covariates.length && g.zeroCells > 0) warnings.push(t('zeroCells', { n: g.zeroCells, pct: fmt((100 * g.zeroCells) / g.cells, 1, ctx) }));
    // separation: observed cells predicted with probability ≈ 1
    let sepCells = 0;
    let obsCells = 0;
    let tinyCells = 0;
    md.patterns.forEach((p) => {
      const u = thresholdsU(model, fit.params, p.x);
      p.y.forEach((y, j) => {
        if (catProb(link, u, j) < 1e-8) tinyCells++;
        if (y <= 0) return;
        obsCells++;
        if (catComplement(link, u, j) < 1e-8) sepCells++;
      });
    });
    const cov = covariance(fit.H, crit.singular);
    let doubtful = false;
    if (sepCells > 0 && sepCells === obsCells) warnings.push(t('completeSep')), (doubtful = true);
    else if (sepCells > 0 || tinyCells > 0) warnings.push(t('quasiSep')), (doubtful = true);
    if (!cov || fit.singular) warnings.push(t('singular')), (doubtful = true);
    if (fit.stepFailed) warnings.push(t('stepFailed')), (doubtful = true);
    else if (!fit.converged) warnings.push(t('maxIter', { n: crit.mxiter })), (doubtful = true);
    if (doubtful) warnings.push(t('continues'));
    for (const w of warnings) items.push(messageItem('warning', w, ctx.line));

    items.push(cpsTable(md, ctx, P, NAME));
    const tlabels = md.cats.slice(0, -1).map((c) => `[${md.dep.name} = ${valueCode(md.dep, c, ctx)}]`);
    const llabels = md.columns.filter((c) => !c.redundant).map((c) => c.label);
    if (print.history) items.push(historyTable(fit.history, print.history, [...tlabels, ...llabels], md, print.kernel, ctx));
    const dfModel = q;
    items.push(mfiTable(ctx, P, NAME, t('interceptOnly'), m2ll(md, ll0, print.kernel), m2ll(md, fit.ll, print.kernel), dfModel, false, [linkNote]));
    if (print.fit) items.push(gofTable(ctx, P, NAME, g, md.patterns.length * (J - 1) - (J - 1 + q), [linkNote]));
    if (print.summary) items.push(pseudoTable(ctx, P, NAME, pseudoR2(ll0, fit.ll, md.nValid), [linkNote]));
    if (print.parameter) items.push(paramTable(md, fit.params, cov, tlabels, crit.cin, ctx, linkNote));
    const raw: PlumRaw = { params: fit.params, se: fit.params.map((_, i) => (cov ? Math.sqrt(cov[i][i]) : NaN)), ll: fit.ll, ll0, logConst: md.logConst, pearson: g.pearson, deviance: g.deviance, warnings };
    inspect.sink?.push(raw);
    if (print.tparallel) {
      if (q === 0 || J < 3) items.push(messageItem('warning', t('tparallelNone'), ctx.line));
      else {
        const gm: CumModel = { ...model, parallel: false };
        const start = [...fit.params.slice(0, J - 1)];
        for (let k = 0; k < J - 1; k++) start.push(...fit.params.slice(J - 1));
        let gen: ReturnType<typeof newton> | null = null;
        try {
          gen = newton((b, d) => evaluate(gm, b, d), start, crit);
        } catch {
          gen = null;
        }
        const df = (J - 2) * q;
        const notes = [t('tparallelNote'), linkNote];
        if (gen && (!gen.converged || gen.stepFailed || gen.singular)) notes.push(t('tparallelConv'));
        const a = m2ll(md, fit.ll, print.kernel);
        const b = gen ? m2ll(md, gen.ll, print.kernel) : NaN;
        if (gen) raw.llGeneral = gen.ll;
        const chi = a - b;
        const sup = mark(0);
        items.push(
          tableItem(
            {
              caption: t('tparallel') + sup,
              head: [[th(t('model')), th(t('m2ll')), th(t('chisq')), th(t('df')), th(t('sig'))]],
              body: [
                [th(t('nullHyp')), td(fmt(a, 3, ctx)), td(''), td(''), td('')],
                [th(t('general')), td(fmt(b, 3, ctx)), td(fmt(chi, 3, ctx)), td(gen ? String(df) : ''), td(gen ? fmt(chiP(chi, df), 3, ctx) : '')],
              ],
              footnotes: notes,
            },
            NAME,
          ),
        );
      }
    }
    out.push(...items);
  }
  return [groupItem(t('title'), NAME, out)];
}

function historyTable(h: { iter: number; ll: number; halvings: number; params: number[] }[], every: number, labels: string[], md: ModelData, kernel: boolean, ctx: ExtContext): OutputItem {
  const t = (k: string) => ctx.t(`${P}.${k}`);
  const rows = h.filter((r, i) => r.iter % every === 0 || i === h.length - 1);
  const pcols = labels.length;
  return tableItem(
    {
      caption: t('history'),
      head: [
        [th(t('iteration'), { rowspan: 2 }), th(t('m2ll'), { rowspan: 2 }), th(t('stepHalving'), { rowspan: 2 }), ...(pcols ? [th(t('threshold'), { colspan: md.cats.length - 1 }), ...(pcols > md.cats.length - 1 ? [th(t('location'), { colspan: pcols - md.cats.length + 1 })] : [])] : [])],
        labels.map((l) => th(l)),
      ],
      body: rows.map((r) => [th(String(r.iter)), td(fmt(m2ll(md, r.ll, kernel), 3, ctx)), td(String(r.halvings)), ...r.params.map((x) => td(fmt(x, 3, ctx)))]),
    },
    NAME,
  );
}

function paramTable(md: ModelData, b: number[], cov: Matrix | null, tlabels: string[], cin: number, ctx: ExtContext, linkNote: string): OutputItem {
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`${P}.${k}`, a);
  const z = normInv(1 - (1 - cin / 100) / 2);
  const J = md.cats.length;
  const est = (label: string, k: number): Cell[] => {
    const e = b[k];
    const se = cov ? Math.sqrt(cov[k][k]) : NaN;
    const w = (e / se) ** 2;
    return [th(label), td(fmt(e, 3, ctx)), td(fmt(se, 3, ctx)), td(fmt(w, 3, ctx)), td('1'), td(fmt(chiP(w, 1), 3, ctx)), td(fmt(e - z * se, 3, ctx)), td(fmt(e + z * se, 3, ctx))];
  };
  const body: Cell[][] = [];
  tlabels.forEach((l, j) => body.push([...(j === 0 ? [th(t('threshold'), { rowspan: J - 1 })] : []), ...est(l, j)]));
  let k = J - 1;
  let anyRed = false;
  md.columns.forEach((c, i) => {
    const lead = i === 0 ? [th(t('location'), { rowspan: md.columns.length })] : [];
    if (c.redundant) {
      anyRed = true;
      body.push([...lead, th(c.label), td(`0${mark(1)}`), td(''), td(''), td('0'), td(''), td(''), td('')]);
    } else body.push([...lead, ...est(c.label, k++)]);
  });
  const ci = fmt(cin, Number.isInteger(cin) ? 0 : 1, ctx);
  return tableItem(
    {
      caption: t('params'),
      head: [
        [th('', { colspan: 2, rowspan: 2 }), th(t('estimate'), { rowspan: 2 }), th(t('se'), { rowspan: 2 }), th(t('wald'), { rowspan: 2 }), th(t('df'), { rowspan: 2 }), th(t('sig'), { rowspan: 2 }), th(t('ci', { level: ci }), { colspan: 2 })],
        [th(t('lower')), th(t('upper'))],
      ],
      body,
      footnotes: [linkNote, ...(anyRed ? [t('redundant')] : [])],
    },
    NAME,
  );
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
