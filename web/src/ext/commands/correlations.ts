/*
 * NONPAR CORR (Spearman's rho, Kendall's tau-b) and PARTIAL CORR, with SPSS syntax and output
 * layout.
 *
 * Methods:
 * - Spearman's rho: Pearson correlation of midranks (ties get the average rank), ranks taken over
 *   the cases used for the pair; significance from t = r·√((n−2)/(1−r²)) with n−2 df (SPSS, and
 *   scipy.stats.spearmanr).
 * - Kendall's tau-b: (C−D)/√((n0−n1)(n0−n2)); significance from the normal approximation of S = C−D
 *   with the tie-corrected null variance (Kendall 1970), i.e. exactly the p-value of
 *   scipy.stats.kendalltau(x, y, variant='b', method='asymptotic').
 * - Partial correlations: from the inverse P of the correlation matrix of (x, y, controls):
 *   r = −P₁₂/√(P₁₁P₂₂); t = r·√(df/(1−r²)) with df = n − 2 − k.
 *
 * Weights: NONPAR CORR uses integer frequency weights by replication; non-integer weights are
 * ignored with a warning. PARTIAL CORR uses frequency weights in means, covariances and n.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem, Variable } from '../../engine/types';
import { isKw, keywords, sub, varList, type ParsedCommand, type Token } from '../parse';
import { isMissing, splitGroups, variable, varTitle, weights, type Cell as DataCell } from '../data';
import { fmt, fmtN, fmtP, groupItem, messageItem, tableItem, td, textItem, th, type Cell } from '../table';
import { normCdf, tTwoTail } from '../dist';
import { inverse } from '../linalg';
import { ExtError, type ExtCommand, type ExtContext } from '../types';

/* ------------------------------------------------------------------ statistics (exported) */

export interface CorrResult {
  /** coefficient (NaN when it cannot be computed) */
  r: number;
  /** two-tailed significance (NaN when not available) */
  p: number;
  n: number;
}

/** Ranks 1..n with ties replaced by their average rank. */
export function midranks(x: number[]): number[] {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const out = new Array<number>(x.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && x[idx[j + 1]] === x[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

/** Pearson correlation; NaN when a variable is constant or n < 2. */
export function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx <= 0 || syy <= 0) return NaN;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Two-tailed p of a correlation-type coefficient via t with DF degrees of freedom. */
export function corrSig(r: number, df: number): number {
  if (!Number.isFinite(r) || df < 1) return NaN;
  if (Math.abs(r) >= 1) return 0;
  return tTwoTail(r * Math.sqrt(df / (1 - r * r)), df);
}

export function spearman(x: number[], y: number[]): CorrResult {
  const n = x.length;
  const r = pearson(midranks(x), midranks(y));
  return { r, p: corrSig(r, n - 2), n };
}

/** Tie statistics of a variable: Σt(t−1)/2, Σt(t−1)(t−2), Σt(t−1)(2t+5) over tie groups. */
function ties(x: number[]): [number, number, number] {
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  let a = 0;
  let b = 0;
  let c = 0;
  for (const t of counts.values())
    if (t > 1) {
      a += (t * (t - 1)) / 2;
      b += t * (t - 1) * (t - 2);
      c += t * (t - 1) * (2 * t + 5);
    }
  return [a, b, c];
}

export function kendallTauB(x: number[], y: number[]): CorrResult {
  const n = x.length;
  if (n < 2) return { r: NaN, p: NaN, n };
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) s += Math.sign(x[i] - x[j]) * Math.sign(y[i] - y[j]);
  const n0 = (n * (n - 1)) / 2;
  const [xt, x0, x1] = ties(x);
  const [yt, y0, y1] = ties(y);
  if (xt >= n0 || yt >= n0) return { r: NaN, p: NaN, n };
  const r = Math.max(-1, Math.min(1, s / Math.sqrt((n0 - xt) * (n0 - yt))));
  let p = NaN;
  if (n >= 3) {
    const m = n * (n - 1);
    const v = (m * (2 * n + 5) - x1 - y1) / 18 + (2 * xt * yt) / m + (x0 * y0) / (9 * m * (n - 2));
    p = v > 0 ? 2 * normCdf(-Math.abs(s) / Math.sqrt(v)) : NaN;
  }
  return { r, p, n };
}

/** Partial correlation of variables I and J given CONTROLS from correlation matrix R; NaN if singular. */
export function partialFromCorr(R: number[][], i: number, j: number, controls: number[]): number {
  const idx = [i, j, ...controls];
  if (idx.some((a) => idx.some((b) => !Number.isFinite(R[a][b])))) return NaN;
  const P = inverse(idx.map((a) => idx.map((b) => R[a][b])), 1e-10);
  if (!P || P[0][0] <= 0 || P[1][1] <= 0) return NaN;
  return Math.max(-1, Math.min(1, -P[0][1] / Math.sqrt(P[0][0] * P[1][1])));
}

/* ------------------------------------------------------------------ shared helpers */

type T = ExtContext['t'];

function numericVar(ds: Dataset, name: string, t: T): { v: Variable; col: DataCell[] } {
  const { v, col } = variable(ds, name);
  if (v.type === 'string') throw new ExtError(t('ext.corr.err.string', { name: v.name }));
  return { v, col };
}

const unique = (a: string[]) => [...new Set(a)];

/** Head tokens without a leading `VARIABLES=` (SPSS allows it before the first slash). */
function headList(head: Token[]): Token[] {
  const w = head[0]?.kind === 'id' ? head[0].text.toUpperCase() : '';
  return w.length >= 3 && 'VARIABLES'.startsWith(w) && head[1]?.text === '=' ? head.slice(2) : head;
}

/** '**' at p < .01, '*' at p < .05 (one-tailed p when ONE). */
function flagOf(p: number): string | undefined {
  if (!Number.isFinite(p)) return undefined;
  return p < 0.01 ? '**' : p < 0.05 ? '*' : undefined;
}

function flagFootnotes(marks: Set<string>, oneTail: boolean, t: T) {
  const out: { mark: string; text: string }[] = [];
  const tails = oneTail ? '1' : '2';
  for (const m of marks) out.push({ mark: m, text: t(m === '**' ? `ext.corr.flag01_${tails}` : `ext.corr.flag05_${tails}`) });
  return out;
}

/* ------------------------------------------------------------------ NONPAR CORR */

interface VarSpec {
  rows: string[];
  cols: string[] | null;
}

function parseLists(tokens: Token[], vars: Variable[], t: T): VarSpec {
  const a = varList(tokens, 0, vars, ['WITH']);
  if (!a.names.length) throw new ExtError(t('ext.corr.err.noVariables'));
  let cols: string[] | null = null;
  let i = a.next;
  if (isKw(tokens[i], 'WITH')) {
    const b = varList(tokens, i + 1, vars);
    if (!b.names.length) throw new ExtError(t('ext.corr.err.withList'));
    cols = b.names;
    i = b.next;
  }
  if (i < tokens.length) throw new ExtError(t('ext.corr.err.unexpected', { token: tokens[i].text }));
  if (!cols && a.names.length < 2 && unique(a.names).length < 2) throw new ExtError(t('ext.corr.err.twoVariables'));
  return { rows: a.names, cols };
}

const NONPAR_SUBS = ['VARIABLES', 'PRINT', 'MISSING', 'SAMPLE', 'MATRIX'];

function runNonpar(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const { t } = ctx;
  const ds = ctx.dataset;
  const lists: VarSpec[] = [];
  if (cmd.head.length) lists.push(parseLists(headList(cmd.head), ds.variables, t));
  for (const s of cmd.subs) {
    const known = NONPAR_SUBS.find((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name)));
    if (known === 'VARIABLES') lists.push(parseLists(s.tokens, ds.variables, t));
    else if (!known) {
      // a further variable list: NONPAR CORR a b /c d
      if (ds.variables.some((v) => v.name.toUpperCase() === s.name)) lists.push(parseLists([{ kind: 'id', text: s.name }, ...s.tokens], ds.variables, t));
      else throw new ExtError(t('ext.corr.err.subcommand', { name: s.name }));
    } else if (known === 'MATRIX') throw new ExtError(t('ext.corr.err.matrix'));
  }
  if (!lists.length) throw new ExtError(t('ext.corr.err.noVariables'));

  const print = keywords(sub(cmd, 'PRINT'));
  const kendall = print.has('KENDALL') || print.has('BOTH');
  const spear = print.has('SPEARMAN') || print.has('BOTH') || !kendall;
  const oneTail = print.has('ONETAIL');
  const flag = print.has('NOSIG');
  const miss = keywords(sub(cmd, 'MISSING'));
  const listwise = miss.has('LISTWISE');
  const includeUser = miss.has('INCLUDE');

  const allNames = unique(lists.flatMap((l) => [...l.rows, ...(l.cols ?? [])]));
  const cols = Object.fromEntries(allNames.map((n) => [n, numericVar(ds, n, t)]));

  const items: OutputItem[] = [];
  // frequency weights by replication when all are integers, otherwise ignored
  let w = weights(ds);
  if (ds.weight && w.some((x) => x > 0 && !Number.isInteger(x))) {
    items.push(messageItem('warning', t('ext.corr.weightsIgnored'), ctx.line));
    w = w.map((x) => (x > 0 ? 1 : 0));
  }
  const valid = (name: string, r: number) => !isMissing(cols[name].v, cols[name].col[r], includeUser);

  const children: OutputItem[] = [];
  let incomplete = false;
  for (const g of splitGroups(ds)) {
    if (g.label) children.push(textItem(g.label));
    const rows = listwise ? g.rows.filter((r) => allNames.every((n) => valid(n, r))) : g.rows;
    const cache = new Map<string, { s: CorrResult; k: CorrResult }>();
    const pair = (a: string, b: string) => {
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      let res = cache.get(key);
      if (!res) {
        const x: number[] = [];
        const y: number[] = [];
        for (const r of rows) {
          if (!valid(a, r) || !valid(b, r)) continue;
          for (let k = 0; k < w[r]; k++) {
            x.push(cols[a].col[r] as number);
            y.push(cols[b].col[r] as number);
          }
        }
        res = { s: spear ? spearman(x, y) : { r: NaN, p: NaN, n: x.length }, k: kendall ? kendallTauB(x, y) : { r: NaN, p: NaN, n: x.length } };
        cache.set(key, res);
      }
      return res;
    };

    for (const list of lists) {
      const rv = list.rows;
      const cv = list.cols ?? list.rows;
      const head: Cell[][] = [[th(''), th(''), th(''), ...cv.map((n) => th(varTitle(cols[n].v)))]];
      const body: Cell[][] = [];
      const marks = new Set<string>();
      const methods: ['k' | 's', string][] = [];
      if (kendall) methods.push(['k', t('ext.corr.kendall')]);
      if (spear) methods.push(['s', t('ext.corr.spearman')]);
      for (const [m, label] of methods) {
        rv.forEach((a, ri) => {
          const res = cv.map((b) => ({ same: a === b, c: pair(a, b)[m] }));
          const coef: Cell[] = res.map(({ same, c }) => {
            if (!Number.isFinite(c.r)) {
              incomplete = true;
              return td('');
            }
            const p = oneTail ? c.p / 2 : c.p;
            const mark = flag && !same ? flagOf(p) : undefined;
            if (mark) marks.add(mark);
            return td(fmt(c.r, 3, ctx), mark ? { sup: mark } : {});
          });
          const sig = res.map(({ same, c }) => td(same || !Number.isFinite(c.r) ? '' : fmtP(oneTail ? c.p / 2 : c.p, ctx)));
          const ns = res.map(({ c }) => td(fmtN(c.n, ctx)));
          const first: Cell[] = [];
          if (ri === 0) first.push(th(label, { rowspan: 3 * rv.length }));
          first.push(th(varTitle(cols[a].v), { rowspan: 3 }), th(t('ext.corr.coefficient')), ...coef);
          body.push(first, [th(t(oneTail ? 'ext.corr.sig1' : 'ext.corr.sig2')), ...sig], [th(t('ext.corr.n')), ...ns]);
        });
      }
      children.push(tableItem({ caption: t('ext.corr.correlations'), head, body, footnotes: flagFootnotes(marks, oneTail, t) }, 'NONPAR CORR'));
    }
  }
  if (incomplete) items.push(messageItem('warning', t('ext.corr.cannotCompute'), ctx.line));
  items.push(groupItem(t('ext.corr.titleNonpar'), 'NONPAR CORR', children));
  return items;
}

/* ------------------------------------------------------------------ PARTIAL CORR */

interface PartialSpec {
  rows: string[];
  cols: string[] | null;
  controls: string[];
}

function parsePartialVars(tokens: Token[], vars: Variable[], t: T): PartialSpec {
  const a = varList(tokens, 0, vars, ['WITH', 'BY']);
  if (!a.names.length) throw new ExtError(t('ext.corr.err.noVariables'));
  let i = a.next;
  let cols: string[] | null = null;
  if (isKw(tokens[i], 'WITH')) {
    const b = varList(tokens, i + 1, vars, ['BY']);
    if (!b.names.length) throw new ExtError(t('ext.corr.err.withList'));
    cols = b.names;
    i = b.next;
  }
  if (!isKw(tokens[i], 'BY')) throw new ExtError(t('ext.corr.err.needBy'));
  const c = varList(tokens, i + 1, vars);
  if (!c.names.length) throw new ExtError(t('ext.corr.err.needBy'));
  i = c.next;
  // optional order list, e.g. BY z (1): only the full order is computed
  if (tokens[i]?.text === '(') {
    while (i < tokens.length && tokens[i].text !== ')') i++;
    i++;
  }
  if (i < tokens.length) throw new ExtError(t('ext.corr.err.unexpected', { token: tokens[i].text }));
  const main = [...a.names, ...(cols ?? [])];
  const both = c.names.find((n) => main.includes(n));
  if (both) throw new ExtError(t('ext.corr.err.overlap', { name: both }));
  if (!cols && unique(a.names).length < 2) throw new ExtError(t('ext.corr.err.twoVariables'));
  return { rows: a.names, cols, controls: unique(c.names) };
}

const PARTIAL_SUBS = ['VARIABLES', 'SIGNIFICANCE', 'STATISTICS', 'FORMAT', 'MISSING', 'MATRIX'];

interface Moments {
  /** weighted n, mean, sd per variable */
  n: number[];
  mean: number[];
  sd: number[];
  /** correlation and weighted n per pair */
  R: number[][];
  N: number[][];
}

/** Weighted moments of the variables V over ROWS; LISTWISE uses rows valid on all of them. */
function moments(V: { col: DataCell[]; valid: (r: number) => boolean }[], rows: number[], w: number[], listwise: boolean): Moments {
  const k = V.length;
  const use = listwise ? rows.filter((r) => V.every((v) => v.valid(r))) : rows;
  const n = new Array(k).fill(0);
  const mean = new Array(k).fill(NaN);
  const sd = new Array(k).fill(NaN);
  for (let a = 0; a < k; a++) {
    let sw = 0;
    let s = 0;
    for (const r of use) if (V[a].valid(r)) {
      sw += w[r];
      s += w[r] * (V[a].col[r] as number);
    }
    n[a] = sw;
    if (sw > 0) mean[a] = s / sw;
    let ss = 0;
    for (const r of use) if (V[a].valid(r)) ss += w[r] * ((V[a].col[r] as number) - mean[a]) ** 2;
    if (sw > 1) sd[a] = Math.sqrt(ss / (sw - 1));
  }
  const R = Array.from({ length: k }, () => new Array(k).fill(NaN));
  const N = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let a = 0; a < k; a++)
    for (let b = a; b < k; b++) {
      let sw = 0;
      let sa = 0;
      let sb = 0;
      for (const r of use) if (V[a].valid(r) && V[b].valid(r)) {
        sw += w[r];
        sa += w[r] * (V[a].col[r] as number);
        sb += w[r] * (V[b].col[r] as number);
      }
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      if (sw > 0) {
        const ma = sa / sw;
        const mb = sb / sw;
        for (const r of use) if (V[a].valid(r) && V[b].valid(r)) {
          const da = (V[a].col[r] as number) - ma;
          const db = (V[b].col[r] as number) - mb;
          saa += w[r] * da * da;
          sbb += w[r] * db * db;
          sab += w[r] * da * db;
        }
      }
      const r = saa > 0 && sbb > 0 ? Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb))) : NaN;
      R[a][b] = R[b][a] = r;
      N[a][b] = N[b][a] = sw;
    }
  return { n, mean, sd, R, N };
}

function runPartial(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const { t } = ctx;
  const ds = ctx.dataset;
  let spec: PartialSpec | null = null;
  if (cmd.head.length) spec = parsePartialVars(headList(cmd.head), ds.variables, t);
  for (const s of cmd.subs) {
    const known = PARTIAL_SUBS.find((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name)));
    if (!known) throw new ExtError(t('ext.corr.err.subcommand', { name: s.name }));
    if (known === 'MATRIX') throw new ExtError(t('ext.corr.err.matrix'));
    if (known === 'VARIABLES') {
      if (spec) throw new ExtError(t('ext.corr.err.oneList'));
      spec = parsePartialVars(s.tokens, ds.variables, t);
    }
  }
  if (!spec) throw new ExtError(t('ext.corr.err.noVariables'));

  const oneTail = keywords(sub(cmd, 'SIGNIFICANCE')).has('ONETAIL');
  const stats = keywords(sub(cmd, 'STATISTICS'));
  const showDesc = stats.has('DESCRIPTIVES') || stats.has('ALL');
  const zeroOrder = stats.has('CORR') || stats.has('ALL');
  const badCorr = stats.has('BADCORR');
  const format = keywords(sub(cmd, 'FORMAT'));
  const showSig = !(format.has('NOSIG') || format.has('CONDENSED'));
  const miss = keywords(sub(cmd, 'MISSING'));
  const listwise = !miss.has('ANALYSIS');
  const includeUser = miss.has('INCLUDE');

  const rowVars = unique(spec.rows);
  const colVars = unique(spec.cols ?? spec.rows);
  const main = unique([...rowVars, ...colVars]);
  const all = [...main, ...spec.controls];
  const V = all.map((name) => {
    const { v, col } = numericVar(ds, name, t);
    return { name, v, col, valid: (r: number) => !isMissing(v, col[r], includeUser) };
  });
  const at = (name: string) => all.indexOf(name);
  const ctrl = spec.controls.map(at);
  const k = ctrl.length;
  const w = weights(ds);

  const children: OutputItem[] = [];
  let incomplete = false;
  for (const g of splitGroups(ds)) {
    if (g.label) children.push(textItem(g.label));
    const m = moments(V, g.rows, w, listwise);

    if (showDesc) {
      children.push(
        tableItem(
          {
            caption: t('ext.corr.descriptives'),
            head: [[th(''), th(t('ext.corr.mean')), th(t('ext.corr.sd')), th(t('ext.corr.n'))]],
            body: V.map((x, a) => {
              const d = Math.min(x.v.print?.d ?? 0, 10) + 2;
              return [th(varTitle(x.v)), td(fmt(m.mean[a], d, ctx)), td(fmt(m.sd[a], d, ctx)), td(fmtN(m.n[a], ctx))];
            }),
          },
          'PARTIAL CORR',
        ),
      );
    }

    // partial coefficients
    const partial = (a: number, b: number) => {
      const idx = [a, b, ...ctrl];
      const n = Math.min(...idx.flatMap((i) => idx.map((j) => m.N[i][j])));
      if (a === b) {
        const ok = Number.isFinite(m.R[a][a]);
        return { r: ok ? 1 : NaN, p: NaN, df: 0 };
      }
      const r = partialFromCorr(m.R, a, b, ctrl);
      const df = n - 2 - k;
      return { r, p: corrSig(r, df), df };
    };
    const zero = (a: number, b: number) => {
      const r = a === b ? (Number.isFinite(m.R[a][a]) ? 1 : NaN) : m.R[a][b];
      const df = a === b ? 0 : m.N[a][b] - 2;
      return { r, p: a === b ? NaN : corrSig(r, df), df };
    };
    const pRows = rowVars.map(at);
    const pCols = colVars.map(at);
    const anyBad = pRows.some((a) => pCols.some((b) => !Number.isFinite(partial(a, b).r)));
    if (anyBad) incomplete = true;
    const withZero = zeroOrder || (badCorr && anyBad);
    const zRows = unique([...rowVars, ...spec.controls]).map(at);
    const cols = withZero ? unique([...colVars, ...spec.controls]).map(at) : pCols;

    const marks = new Set<string>();
    const statRows = (r: { r: number; p: number; df: number }[], cells: (boolean)[]): Cell[][] => {
      const coef = r.map((x, i) => {
        if (!cells[i] || !Number.isFinite(x.r)) return td('');
        const p = oneTail ? x.p / 2 : x.p;
        const mark = !showSig ? flagOf(p) : undefined;
        if (mark) marks.add(mark);
        return td(fmt(x.r, 3, ctx), mark ? { sup: mark } : {});
      });
      const out: Cell[][] = [[th(t('ext.corr.correlation')), ...coef]];
      if (showSig) {
        out.push([th(t(oneTail ? 'ext.corr.significance1' : 'ext.corr.significance2')), ...r.map((x, i) => td(cells[i] && Number.isFinite(x.p) ? fmtP(oneTail ? x.p / 2 : x.p, ctx) : ''))]);
        out.push([th(t('ext.corr.df')), ...r.map((x, i) => td(cells[i] && Number.isFinite(x.r) ? fmtN(x.df, ctx) : ''))]);
      }
      return out;
    };
    const block = (label: Cell, rows: number[], compute: (a: number, b: number) => { r: number; p: number; df: number }, valid: (b: number) => boolean) => {
      const out: Cell[][] = [];
      rows.forEach((a, ri) => {
        const sr = statRows(
          cols.map((b) => compute(a, b)),
          cols.map((b) => valid(b)),
        );
        const per = sr.length;
        if (ri === 0) sr[0].unshift(th(label.text, { rowspan: per * rows.length, sup: label.sup }), th(varTitle(V[a].v), { rowspan: per }));
        else sr[0].unshift(th(varTitle(V[a].v), { rowspan: per }));
        out.push(...sr);
      });
      return out;
    };
    const body: Cell[][] = [];
    const footnotes: (string | { mark: string; text: string })[] = [];
    if (withZero) {
      body.push(...block(th(t('ext.corr.none'), { sup: 'a' }), zRows, zero, () => true));
      footnotes.push({ mark: 'a', text: t('ext.corr.zeroOrder') });
    }
    const ctrlLabel = spec.controls.map((n) => varTitle(V[at(n)].v)).join(' & ');
    body.push(...block(th(ctrlLabel), pRows, partial, (b) => !ctrl.includes(b)));
    footnotes.push(...flagFootnotes(marks, oneTail, t));
    const head: Cell[][] = [[th(t('ext.corr.controlVariables')), th(''), th(''), ...cols.map((b) => th(varTitle(V[b].v)))]];
    children.push(tableItem({ caption: t('ext.corr.correlations'), head, body, footnotes }, 'PARTIAL CORR'));
  }
  const items: OutputItem[] = [];
  if (incomplete) items.push(messageItem('warning', t('ext.corr.cannotCompute'), ctx.line));
  items.push(groupItem(t('ext.corr.titlePartial'), 'PARTIAL CORR', children));
  return items;
}

export const commands: ExtCommand[] = [
  { name: 'NONPAR CORR', run: runNonpar },
  { name: 'PARTIAL CORR', run: runPartial },
];
