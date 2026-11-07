/*
 * GRAPH /LINE – line charts of a summary per category (PSPP's GRAPH has no line charts):
 *
 *   GRAPH /LINE[(SIMPLE|MULTIPLE)] = func BY x [BY g]
 *         [/INTERVAL {CI(level) | SE(mult) | SD(mult)}]
 *         [/TITLE='text'] [/MISSING=LISTWISE|VARIABLE [INCLUDE|EXCLUDE]]
 *
 *   func: COUNT | PCT | CUFREQ | CUPCT | MEAN(v) | MEDIAN(v) | SUM(v) | MINIMUM(v) | MAXIMUM(v) | STDDEV(v)
 *
 * The x categories are the distinct values of x (ascending), a line per value of g. Percentages
 * are of all charted cases; cumulative summaries accumulate along x within each line. Intervals
 * are drawn for MEAN only. Honours FILTER, WEIGHT (frequency weights) and SPLIT FILE (a chart per
 * split group).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, OutputItem } from '../../engine/types';
import { isMissing, requireNumeric, splitGroups, valueText, variable, varTitle, weights, type Cell } from '../data';
import { tInv } from '../dist';
import { isKw, keywords, sub, type ParsedCommand, type Token } from '../parse';
import { chartItem, groupItem, messageItem } from '../table';
import { ExtError, type ExtCommand, type ExtContext } from '../types';

const NAME = 'GRAPH';
type Func = 'COUNT' | 'PCT' | 'CUFREQ' | 'CUPCT' | 'MEAN' | 'MEDIAN' | 'SUM' | 'MINIMUM' | 'MAXIMUM' | 'STDDEV';
const FUNCS: Func[] = ['COUNT', 'PCT', 'CUFREQ', 'CUPCT', 'MEAN', 'MEDIAN', 'SUM', 'MINIMUM', 'MAXIMUM', 'STDDEV'];
const NEEDS_VAR: Func[] = ['MEAN', 'MEDIAN', 'SUM', 'MINIMUM', 'MAXIMUM', 'STDDEV'];
const ABBREV: Record<string, Func> = { MIN: 'MINIMUM', MAX: 'MAXIMUM', SD: 'STDDEV', CPCT: 'CUPCT', CUM: 'CUFREQ' };

interface Spec {
  func: Func;
  v: string | null;
  x: string;
  g: string | null;
  interval: { kind: 'CI' | 'SE' | 'SD'; k: number } | null;
  title: string | null;
  includeUser: boolean;
}

function parse(cmd: ParsedCommand, ds: Dataset): Spec {
  const known = ['LINE', 'INTERVAL', 'TITLE', 'SUBTITLE', 'FOOTNOTE', 'MISSING'];
  for (const s of cmd.subs) if (!known.some((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name)))) throw new ExtError(`The ${s.name} subcommand cannot be combined with LINE.`);
  const toks = sub(cmd, 'LINE');
  if (!toks) throw new ExtError('LINE expected.');
  let i = 0;
  if (toks[0]?.text === '(') {
    if (!isKw(toks[1], 'SIMPLE', 'MULTIPLE')) throw new ExtError('LINE takes SIMPLE or MULTIPLE (DROP and AREA are not supported).');
    if (toks[2]?.text !== ')') throw new ExtError("')' expected after LINE(" + toks[1].text + '.');
    i = 3;
  }
  if (toks[i]?.text === '=') i++;
  const fTok = toks[i];
  const fWord = fTok?.kind === 'id' ? fTok.text.toUpperCase() : '';
  const func = (FUNCS.find((f) => f === fWord || (fWord.length >= 3 && f.startsWith(fWord))) ?? ABBREV[fWord]) as Func | undefined;
  if (!func) throw new ExtError(`A summary function (${FUNCS.join(', ')}) is expected after LINE=.`);
  i++;
  let v: string | null = null;
  if (toks[i]?.text === '(') {
    const n = toks[i + 1];
    if (n?.kind !== 'id' || toks[i + 2]?.text !== ')') throw new ExtError(`${func}(variable) expects one variable.`);
    v = variable(ds, n.text).v.name;
    i += 3;
  }
  if (NEEDS_VAR.includes(func) && !v) throw new ExtError(`${func} needs a variable: ${func}(variable).`);
  if (!NEEDS_VAR.includes(func) && v) throw new ExtError(`${func} does not take a variable.`);
  if (v) requireNumeric(variable(ds, v).v);
  const byVar = (): string => {
    if (!isKw(toks[i], 'BY')) throw new ExtError('BY and a category variable expected.');
    const n = toks[i + 1];
    if (n?.kind !== 'id') throw new ExtError('A category variable is expected after BY.');
    i += 2;
    return variable(ds, n.text).v.name;
  };
  const x = byVar();
  const g = isKw(toks[i], 'BY') ? byVar() : null;
  if (i < toks.length) throw new ExtError(`Unexpected '${toks[i].text}' on LINE.`);

  let interval: Spec['interval'] = null;
  const it = sub(cmd, 'INTERVAL');
  if (it) {
    const k = it[0];
    const arg = (d: number) => (it[1]?.text === '(' && typeof it[2]?.value === 'number' ? it[2].value : d);
    if (isKw(k, 'CI')) interval = { kind: 'CI', k: arg(95) };
    else if (isKw(k, 'SE')) interval = { kind: 'SE', k: arg(2) };
    else if (isKw(k, 'SD')) interval = { kind: 'SD', k: arg(2) };
    else throw new ExtError('INTERVAL takes CI(level), SE(multiplier) or SD(multiplier).');
    if (interval.kind === 'CI' && !(interval.k > 0 && interval.k < 100)) throw new ExtError('The CI level must be between 0 and 100.');
    if (func !== 'MEAN') interval = null;
  }
  const str = (t: Token[] | null) => (t ?? []).filter((x) => x.kind === 'str').map((x) => x.text).join(' ') || null;
  return { func, v, x, g, interval, title: str(sub(cmd, 'TITLE')), includeUser: keywords(sub(cmd, 'MISSING')).has('INCLUDE') };
}

const keyOf = (x: Cell) => (typeof x === 'number' ? 'n' + x : 's' + String(x).trimEnd());
const sortCells = (a: Cell, b: Cell) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

function summarize(func: Func, vals: { y: number; w: number }[]): number | null {
  const W = vals.reduce((s, p) => s + p.w, 0);
  if (!vals.length || W <= 0) return null;
  switch (func) {
    case 'MEAN':
      return vals.reduce((s, p) => s + p.y * p.w, 0) / W;
    case 'SUM':
      return vals.reduce((s, p) => s + p.y * p.w, 0);
    case 'MINIMUM':
      return Math.min(...vals.map((p) => p.y));
    case 'MAXIMUM':
      return Math.max(...vals.map((p) => p.y));
    case 'STDDEV': {
      if (W <= 1) return null;
      const m = vals.reduce((s, p) => s + p.y * p.w, 0) / W;
      return Math.sqrt(vals.reduce((s, p) => s + p.w * (p.y - m) ** 2, 0) / (W - 1));
    }
    case 'MEDIAN': {
      // weighted median (frequency weights), averaging at an exact half like the unweighted median
      const s = [...vals].sort((a, b) => a.y - b.y);
      let c = 0;
      for (let i = 0; i < s.length; i++) {
        c += s[i].w;
        if (Math.abs(c - W / 2) < 1e-9 && i + 1 < s.length) return (s[i].y + s[i + 1].y) / 2;
        if (c > W / 2) return s[i].y;
      }
      return s[s.length - 1].y;
    }
    default:
      return W;
  }
}

function run(cmd: ParsedCommand, ctx: ExtContext): OutputItem[] {
  const ds = ctx.dataset;
  const spec = parse(cmd, ds);
  const t = (k: string, a?: Record<string, unknown>) => ctx.t(`ext.graphLine.${k}`, a);
  const X = variable(ds, spec.x);
  const G = spec.g ? variable(ds, spec.g) : null;
  const V = spec.v ? variable(ds, spec.v) : null;
  const w = weights(ds);
  const out: OutputItem[] = [];
  const fLabel = t(`f.${spec.func}`);
  const ylabel = V ? `${fLabel} ${varTitle(V.v)}` : fLabel;
  for (const grp of splitGroups(ds)) {
    const rows = grp.rows.filter((r) => !isMissing(X.v, X.col[r], spec.includeUser) && (!G || !isMissing(G.v, G.col[r], spec.includeUser)) && (!V || !isMissing(V.v, V.col[r], spec.includeUser)));
    const uniq = (col: Cell[]) => {
      const m = new Map<string, Cell>();
      for (const r of rows) m.set(keyOf(col[r]), col[r]);
      return [...m.values()].sort(sortCells);
    };
    const xs = uniq(X.col);
    const gs = G ? uniq(G.col) : [null];
    if (!rows.length) {
      out.push(messageItem('warning', t('noCases'), ctx.line));
      continue;
    }
    const total = rows.reduce((s, r) => s + w[r], 0);
    const cell = (xv: Cell, gv: Cell) => rows.filter((r) => keyOf(X.col[r]) === keyOf(xv) && (gv === null || keyOf(G!.col[r]) === keyOf(gv)));
    const series = gs.map((gv) => {
      const values: (number | null)[] = [];
      const lo: (number | null)[] = [];
      const hi: (number | null)[] = [];
      let cum = 0;
      for (const xv of xs) {
        const rs = cell(xv, gv);
        const W = rs.reduce((s, r) => s + w[r], 0);
        let val: number | null;
        if (spec.func === 'COUNT') val = W;
        else if (spec.func === 'PCT') val = (100 * W) / total;
        else if (spec.func === 'CUFREQ') val = cum += W;
        else if (spec.func === 'CUPCT') val = (100 * (cum += W)) / total;
        else val = summarize(spec.func, rs.map((r) => ({ y: V!.col[r] as number, w: w[r] })));
        values.push(val);
        if (spec.interval && val !== null) {
          const sd = summarize('STDDEV', rs.map((r) => ({ y: V!.col[r] as number, w: w[r] })));
          const se = sd !== null ? sd / Math.sqrt(W) : null;
          const half = sd === null ? null : spec.interval.kind === 'CI' ? tInv(1 - (1 - spec.interval.k / 100) / 2, W - 1) * se! : spec.interval.kind === 'SE' ? spec.interval.k * se! : spec.interval.k * sd;
          lo.push(half === null ? null : val - half);
          hi.push(half === null ? null : val + half);
        } else if (spec.interval) {
          lo.push(null);
          hi.push(null);
        }
      }
      return { name: G && gv !== null ? valueText(G.v, gv) : ylabel, values, ...(spec.interval ? { lo, hi } : {}) };
    });
    const iv = spec.interval;
    const errorLabel = !iv ? '' : iv.kind === 'CI' ? t('ciLabel', { level: iv.k }) : t(iv.kind === 'SE' ? 'seLabel' : 'sdLabel', { mult: iv.k });
    const base = spec.title ?? (G ? t('titleBy', { y: ylabel, x: varTitle(X.v), g: varTitle(G.v) }) : t('title', { y: ylabel, x: varTitle(X.v) }));
    out.push(
      chartItem(grp.label ? `${base} (${grp.label})` : base, {
        type: 'line',
        xlabel: varTitle(X.v),
        ylabel,
        legendTitle: G ? varTitle(G.v) : '',
        errorLabel,
        categories: xs.map((xv) => valueText(X.v, xv)),
        series,
      }),
    );
  }
  return out.length === 1 ? out : [groupItem(t('group'), NAME, out)];
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
