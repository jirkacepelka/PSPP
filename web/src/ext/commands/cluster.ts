/*
 * CLUSTER: agglomerative hierarchical cluster analysis of cases (SPSS syntax and output layout).
 *
 *   CLUSTER varlist
 *     /MEASURE={SEUCLID**|EUCLID|COSINE|PEARSON|CHEBYCHEV|BLOCK|MINKOWSKI(p)|POWER(p,r)}
 *     /METHOD={BAVERAGE**|WAVERAGE|SINGLE|COMPLETE|CENTROID|MEDIAN|WARD}[(rootname)] [...]
 *     /ID=labelvar
 *     /PRINT=[SCHEDULE**] [CLUSTER(min,max)|CLUSTER(n)] [DISTANCE] [NONE]
 *     /PLOT=[DENDROGRAM] [VICICLE|HICICLE] [NONE]
 *     /SAVE=CLUSTER(n | min,max)
 *     /MISSING=[EXCLUDE**|INCLUDE]
 *
 * Algorithm (as in the SPSS algorithms manual): the proximity matrix is computed from the raw
 * values (no standardisation; SPSS does that in PROXIMITIES), then the closest pair of clusters
 * (largest similarity for COSINE/PEARSON) is merged and the matrix updated with the
 * Lance–Williams formulas; WAVERAGE (average linkage within groups) merges the pair whose union
 * has the smallest mean of all within-cluster proximities.
 * Schedule conventions: the merged cluster keeps the lower case number; ties are broken by the
 * lowest (cluster 1, cluster 2) pair; coefficients are the proximity at which the pair merged,
 * except for WARD where it is the total within-cluster sum of squares after the stage (the
 * running sum of half the Lance–Williams Ward distances, which for SEUCLID is exactly the error
 * sum of squares). Cluster numbers in memberships follow the first appearance in the file.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { caseCount, isMissing, requireNumeric, splitGroups, valueText, variable, type Cell as DataCell } from '../data';
import { isKw, kwArg, sub, varList, type ParsedCommand, type Token } from '../parse';
import { chartItem, fmt, groupItem, messageItem, tableItem, td, textItem, th } from '../table';
import { ExtError, type ExtCommand, type ExtContext, type ExtResult } from '../types';
import type { OutputItem } from '../../engine/types';

const NAME = 'CLUSTER';
/** Above this many cases the n² proximity matrix (and n² work) is refused. */
export const MAX_CASES = 5000;
const MAX_PROXIMITY_CASES = 100;
const MAX_DENDROGRAM_CASES = 1000;

export type MeasureKind = 'SEUCLID' | 'EUCLID' | 'COSINE' | 'PEARSON' | 'CHEBYCHEV' | 'BLOCK' | 'MINKOWSKI' | 'POWER';
export type Method = 'BAVERAGE' | 'WAVERAGE' | 'SINGLE' | 'COMPLETE' | 'CENTROID' | 'MEDIAN' | 'WARD';
export interface Measure {
  kind: MeasureKind;
  p?: number;
  r?: number;
}
const MEASURES: MeasureKind[] = ['SEUCLID', 'EUCLID', 'COSINE', 'PEARSON', 'CHEBYCHEV', 'BLOCK', 'MINKOWSKI', 'POWER'];
const METHODS: Method[] = ['BAVERAGE', 'WAVERAGE', 'SINGLE', 'COMPLETE', 'CENTROID', 'MEDIAN', 'WARD'];
export const isSimilarity = (m: Measure) => m.kind === 'COSINE' || m.kind === 'PEARSON';

/* ------------------------------------------------------------------ maths */

/** Index of pair (i, j), i < j, in a condensed (upper-triangle, row-major) matrix of order n. */
export const cidx = (n: number, i: number, j: number) => i * n - (i * (i + 1)) / 2 + j - i - 1;

/** Proximity of two cases (rows of values). */
export function proximity(a: number[], b: number[], m: Measure): number {
  const k = a.length;
  switch (m.kind) {
    case 'SEUCLID':
    case 'EUCLID': {
      let s = 0;
      for (let i = 0; i < k; i++) s += (a[i] - b[i]) ** 2;
      return m.kind === 'EUCLID' ? Math.sqrt(s) : s;
    }
    case 'BLOCK': {
      let s = 0;
      for (let i = 0; i < k; i++) s += Math.abs(a[i] - b[i]);
      return s;
    }
    case 'CHEBYCHEV': {
      let s = 0;
      for (let i = 0; i < k; i++) s = Math.max(s, Math.abs(a[i] - b[i]));
      return s;
    }
    case 'MINKOWSKI':
    case 'POWER': {
      const p = m.p ?? 2;
      const r = m.kind === 'POWER' ? m.r ?? 2 : p;
      let s = 0;
      for (let i = 0; i < k; i++) s += Math.abs(a[i] - b[i]) ** p;
      return s ** (1 / r);
    }
    case 'COSINE': {
      let xy = 0;
      let xx = 0;
      let yy = 0;
      for (let i = 0; i < k; i++) {
        xy += a[i] * b[i];
        xx += a[i] * a[i];
        yy += b[i] * b[i];
      }
      return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    }
    case 'PEARSON': {
      let ma = 0;
      let mb = 0;
      for (let i = 0; i < k; i++) {
        ma += a[i] / k;
        mb += b[i] / k;
      }
      let xy = 0;
      let xx = 0;
      let yy = 0;
      for (let i = 0; i < k; i++) {
        xy += (a[i] - ma) * (b[i] - mb);
        xx += (a[i] - ma) ** 2;
        yy += (b[i] - mb) ** 2;
      }
      return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    }
  }
}

/** Condensed proximity matrix of the cases in X. */
export function proximityMatrix(X: number[][], m: Measure): Float64Array {
  const n = X.length;
  const D = new Float64Array((n * (n - 1)) / 2);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D[cidx(n, i, j)] = proximity(X[i], X[j], m);
  return D;
}

export interface Stage {
  /** 1-based cluster numbers (lowest case number in the cluster), c1 < c2 */
  c1: number;
  c2: number;
  coef: number;
  /** stage at which cluster 1 / 2 was formed last (0 = single case) */
  first1: number;
  first2: number;
  /** stage at which the cluster formed here is merged next (0 = last stage) */
  next: number;
}

/**
 * Agglomerates n cases from the condensed proximity matrix D (similarities when SIMILARITY:
 * the largest is merged first). Returns the n − 1 stages of the SPSS agglomeration schedule.
 */
export function agglomerate(D: Float64Array, n: number, method: Method, similarity = false): Stage[] {
  // Work on dissimilarities: similarities are negated (every update below is linear or min/max,
  // so it commutes with the sign change) and the coefficients negated back.
  const sign = similarity ? -1 : 1;
  const M = new Float64Array(D.length);
  for (let i = 0; i < D.length; i++) M[i] = sign * D[i];
  const size = new Float64Array(n).fill(1);
  const within = new Float64Array(n); // WAVERAGE: sum of proximities within each cluster
  const active = new Uint8Array(n).fill(1);
  const at = (i: number, j: number) => (i < j ? cidx(n, i, j) : cidx(n, j, i));
  const crit = (i: number, j: number) => {
    const v = M[at(i, j)];
    if (method !== 'WAVERAGE') return v;
    const m = size[i] + size[j];
    return (within[i] + within[j] + v) / ((m * (m - 1)) / 2);
  };
  // nearest later neighbour of each row (lowest index among ties)
  const nn = new Int32Array(n).fill(-1);
  const nnd = new Float64Array(n).fill(Infinity);
  const scanRow = (i: number) => {
    let best = -1;
    let bd = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (!active[j]) continue;
      const d = crit(i, j);
      if (d < bd || best < 0) {
        bd = d;
        best = j;
      }
    }
    nn[i] = best;
    nnd[i] = best < 0 ? Infinity : bd;
  };
  for (let i = 0; i < n; i++) scanRow(i);

  const stages: Stage[] = [];
  const lastStage = new Int32Array(n);
  let ess = 0;
  for (let s = 1; s < n; s++) {
    let i = -1;
    for (let k = 0; k < n; k++) if (active[k] && nn[k] >= 0 && (i < 0 || nnd[k] < nnd[i])) i = k;
    const j = nn[i];
    const dij = nnd[i];
    let coef: number;
    if (method === 'WARD') {
      ess += dij / 2;
      coef = sign * ess;
    } else coef = sign * dij;
    stages.push({ c1: i + 1, c2: j + 1, coef, first1: lastStage[i], first2: lastStage[j], next: 0 });
    if (lastStage[i]) stages[lastStage[i] - 1].next = s;
    if (lastStage[j]) stages[lastStage[j] - 1].next = s;
    lastStage[i] = s;

    // Lance–Williams update of the distances from the merged cluster (stored in row/column i)
    const ni = size[i];
    const nj = size[j];
    const nij = ni + nj;
    const mij = M[at(i, j)];
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === i || k === j) continue;
      const dki = M[at(k, i)];
      const dkj = M[at(k, j)];
      const nk = size[k];
      let d: number;
      switch (method) {
        case 'SINGLE':
          d = Math.min(dki, dkj);
          break;
        case 'COMPLETE':
          d = Math.max(dki, dkj);
          break;
        case 'BAVERAGE':
          d = (ni * dki + nj * dkj) / nij;
          break;
        case 'WAVERAGE':
          d = dki + dkj; // between-cluster sums
          break;
        case 'CENTROID':
          d = (ni * dki + nj * dkj) / nij - (ni * nj * mij) / (nij * nij);
          break;
        case 'MEDIAN':
          d = (dki + dkj) / 2 - mij / 4;
          break;
        case 'WARD':
          d = ((nk + ni) * dki + (nk + nj) * dkj - nk * mij) / (nk + nij);
          break;
      }
      M[at(k, i)] = d;
    }
    within[i] += within[j] + mij;
    size[i] = nij;
    active[j] = 0;

    // refresh nearest neighbours
    scanRow(i);
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === i) continue;
      if (nn[k] === j || nn[k] === i) scanRow(k);
      else if (k < i) {
        const d = crit(k, i);
        if (d < nnd[k] || (d === nnd[k] && i < nn[k])) {
          nn[k] = i;
          nnd[k] = d;
        }
      }
    }
  }
  return stages;
}

/**
 * Cluster of every case in the K-cluster solution (state after n − K stages), numbered 1… in
 * order of first appearance in the file, like SPSS.
 */
export function membership(stages: Stage[], n: number, k: number): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let s = 0; s < n - k && s < stages.length; s++) parent[find(stages[s].c2 - 1)] = find(stages[s].c1 - 1);
  const num = new Map<number, number>();
  return Array.from({ length: n }, (_, i) => {
    const r = find(i);
    if (!num.has(r)) num.set(r, num.size + 1);
    return num.get(r)!;
  });
}

/** Coefficients rescaled to SPSS's 0–25 dendrogram axis (first merge ≈ 1, last = 25). */
export function rescale(stages: Stage[], similarity: boolean): number[] {
  const c = stages.map((s) => (similarity ? -s.coef : s.coef));
  const lo = Math.min(...c);
  const hi = Math.max(...c);
  return c.map((x) => (hi > lo ? 1 + (24 * (x - lo)) / (hi - lo) : 25));
}

/* ---------------------------------------------------------------- parsing */

function kwMatch(t: Token | undefined, list: readonly string[]): string | null {
  if (!t || t.kind !== 'id') return null;
  const u = t.text.toUpperCase();
  if (list.includes(u)) return u;
  if (u.length < 3) return null;
  const hits = list.filter((k) => k.startsWith(u));
  return hits.length === 1 ? hits[0] : null;
}

/** Numbers inside parentheses following tokens[i] (returns [] when none). */
function parenNums(tokens: Token[], i: number): { nums: number[]; next: number } {
  if (tokens[i]?.text !== '(') return { nums: [], next: i };
  const nums: number[] = [];
  let j = i + 1;
  for (; j < tokens.length && tokens[j].text !== ')'; j++) if (tokens[j].kind === 'num') nums.push(tokens[j].value!);
  return { nums, next: j + 1 };
}

interface Options {
  vars: string[];
  measure: Measure;
  methods: { method: Method; root?: string }[];
  id: string | null;
  schedule: boolean;
  distance: boolean;
  printRange: [number, number] | null;
  dendrogram: boolean;
  icicle: boolean;
  saveRange: [number, number] | null;
  includeUser: boolean;
}

function range(nums: number[], what: string, ctx: ExtContext): [number, number] {
  const ok = (x: number) => Number.isInteger(x) && x >= 1;
  if (nums.length === 1 && ok(nums[0])) return [nums[0], nums[0]];
  if (nums.length === 2 && ok(nums[0]) && ok(nums[1]) && nums[0] <= nums[1]) return [nums[0], nums[1]];
  throw new ExtError(ctx.t('ext.cluster.badRange', { what }));
}

function parse(cmd: ParsedCommand, ds: Dataset, ctx: ExtContext): Options {
  if (sub(cmd, 'MATRIX')) throw new ExtError(ctx.t('ext.cluster.noMatrix'));
  const { names, next } = varList(cmd.head, 0, ds.variables);
  if (next < cmd.head.length) throw new ExtError(ctx.t('ext.cluster.unexpected', { token: cmd.head[next].text }));
  if (!names.length) throw new ExtError(ctx.t('ext.cluster.noVars'));
  const o: Options = {
    vars: [...new Set(names)],
    measure: { kind: 'SEUCLID' },
    methods: [],
    id: null,
    schedule: true,
    distance: false,
    printRange: null,
    dendrogram: false,
    icicle: false,
    saveRange: null,
    includeUser: false,
  };
  for (const v of o.vars) requireNumeric(variable(ds, v).v);

  const meas = sub(cmd, 'MEASURE');
  if (meas) {
    const k = kwMatch(meas[0], MEASURES) as MeasureKind | null;
    if (!k) throw new ExtError(ctx.t('ext.cluster.badMeasure', { token: meas[0]?.text ?? '' }));
    const { nums } = parenNums(meas, 1);
    o.measure = { kind: k };
    if (k === 'MINKOWSKI') {
      if (nums.length !== 1 || !(nums[0] > 0)) throw new ExtError(ctx.t('ext.cluster.badPower'));
      o.measure.p = nums[0];
    } else if (k === 'POWER') {
      if (nums.length !== 2 || !(nums[0] > 0) || !(nums[1] > 0)) throw new ExtError(ctx.t('ext.cluster.badPower'));
      o.measure.p = nums[0];
      o.measure.r = nums[1];
    }
  }

  const meth = sub(cmd, 'METHOD');
  if (meth) {
    for (let i = 0; i < meth.length; i++) {
      const t = meth[i];
      if (t.text === ',') continue;
      const m = kwMatch(t, METHODS) as Method | null;
      if (!m) throw new ExtError(ctx.t('ext.cluster.badMethod', { token: t.text }));
      let root: string | undefined;
      if (meth[i + 1]?.text === '(') {
        root = meth[i + 2]?.kind === 'id' ? meth[i + 2].text : undefined;
        while (i < meth.length && meth[i].text !== ')') i++;
      }
      o.methods.push({ method: m, root });
    }
  }
  if (!o.methods.length) o.methods.push({ method: 'BAVERAGE' });

  const id = sub(cmd, 'ID');
  if (id) {
    if (id[0]?.kind !== 'id') throw new ExtError(ctx.t('ext.cluster.noVars'));
    o.id = variable(ds, id[0].text).v.name;
  }

  const print = sub(cmd, 'PRINT');
  if (print) {
    o.schedule = false;
    for (let i = 0; i < print.length; i++) {
      const k = kwMatch(print[i], ['SCHEDULE', 'CLUSTER', 'DISTANCE', 'NONE']);
      if (k === 'SCHEDULE') o.schedule = true;
      else if (k === 'DISTANCE') o.distance = true;
      else if (k === 'NONE') {
        o.schedule = false;
        o.distance = false;
        o.printRange = null;
      } else if (k === 'CLUSTER') {
        const { nums, next } = parenNums(print, i + 1);
        o.printRange = range(nums, 'PRINT=CLUSTER', ctx);
        i = next - 1;
      } else if (print[i].text !== ',') throw new ExtError(ctx.t('ext.cluster.unexpected', { token: print[i].text }));
    }
  }

  const plot = sub(cmd, 'PLOT');
  if (plot) {
    for (let i = 0; i < plot.length; i++) {
      const k = kwMatch(plot[i], ['DENDROGRAM', 'VICICLE', 'HICICLE', 'NONE']);
      if (k === 'DENDROGRAM') o.dendrogram = true;
      else if (k === 'VICICLE' || k === 'HICICLE') {
        o.icicle = true;
        i = parenNums(plot, i + 1).next - 1;
      } else if (k === 'NONE') {
        o.dendrogram = false;
        o.icicle = false;
      } else if (plot[i].kind !== 'punct') throw new ExtError(ctx.t('ext.cluster.unexpected', { token: plot[i].text }));
    }
  }

  const save = sub(cmd, 'SAVE');
  if (save) {
    if (!isKw(save[0], 'CLUSTER')) throw new ExtError(ctx.t('ext.cluster.unexpected', { token: save[0]?.text ?? '' }));
    o.saveRange = range(kwArg(save, 'CLUSTER')?.filter((t) => t.kind === 'num').map((t) => t.value!) ?? [], 'SAVE=CLUSTER', ctx);
  }

  const miss = sub(cmd, 'MISSING');
  if (miss) {
    for (const t of miss) {
      const k = kwMatch(t, ['EXCLUDE', 'INCLUDE']);
      if (k === 'INCLUDE') o.includeUser = true;
      else if (k === 'EXCLUDE') o.includeUser = false;
      else if (t.kind !== 'punct') throw new ExtError(ctx.t('ext.cluster.unexpected', { token: t.text }));
    }
  }
  for (const s of cmd.subs)
    if (!sub({ ...cmd, subs: [s] }, 'MEASURE', 'METHOD', 'ID', 'PRINT', 'PLOT', 'SAVE', 'MISSING'))
      throw new ExtError(ctx.t('ext.cluster.unexpected', { token: `/${s.name}` }));
  return o;
}

/* ----------------------------------------------------------------- output */

const methodName = (m: Method, ctx: ExtContext) => ctx.t(`ext.cluster.method.${m.toLowerCase()}`);
function measureName(m: Measure, ctx: ExtContext) {
  const f = (x: number | undefined) => fmt(x ?? 2, Number.isInteger(x ?? 2) ? 0 : 2, ctx);
  return ctx.t(`ext.cluster.measure.${m.kind.toLowerCase()}`, { p: f(m.p), r: f(m.r) });
}

const pct = (x: number, ctx: ExtContext) => `${fmt(x, 1, ctx)}%`;

/** Unique save names CLU<k>_<m> (m = first sequence number free for all of them) or <root><k>. */
function saveNames(ds: Dataset, ks: number[], root: string | undefined, taken: Set<string>, ctx: ExtContext): string[] {
  const has = (n: string) => taken.has(n.toUpperCase()) || ds.variables.some((v) => v.name.toUpperCase() === n.toUpperCase());
  if (root) {
    const names = ks.map((k) => `${root}${k}`);
    const clash = names.find(has);
    if (clash) throw new ExtError(ctx.t('ext.cluster.varExists', { name: clash }));
    return names;
  }
  for (let m = 1; ; m++) {
    const names = ks.map((k) => `CLU${k}_${m}`);
    if (!names.some(has)) return names;
  }
}

function run(cmd: ParsedCommand, ctx: ExtContext): ExtResult {
  const ds = ctx.dataset;
  const o = parse(cmd, ds, ctx);
  const sim = isSimilarity(o.measure);
  const items: OutputItem[] = [];
  const warn = (key: string, args?: Record<string, unknown>) => items.push(messageItem('warning', ctx.t(key, args), ctx.line));
  if (ds.weight) warn('ext.cluster.weightIgnored');
  if (o.icicle) warn('ext.cluster.noIcicle');
  if (o.measure.kind === 'PEARSON' && o.vars.length < 2) throw new ExtError(ctx.t('ext.cluster.pearsonVars'));

  const cols = o.vars.map((v) => variable(ds, v));
  const idv = o.id ? variable(ds, o.id) : null;
  const N = caseCount(ds);
  // ignore WEIGHT (SPSS CLUSTER does) but keep FILTER and SPLIT FILE
  const groups = splitGroups({ ...ds, weight: null });
  const saveKs = o.saveRange ? range2list(o.saveRange).reverse() : [];
  const saved: { names: string[]; method: Method; values: (number | null)[][] }[] = [];
  const taken = new Set<string>();
  const methods = o.methods.map((m) => {
    if (!saveKs.length) return { ...m, names: [] as string[] };
    const names = saveNames(ds, saveKs, m.root, taken, ctx);
    names.forEach((x) => taken.add(x.toUpperCase()));
    saved.push({ names, method: m.method, values: names.map(() => new Array<number | null>(N).fill(null)) });
    return { ...m, names };
  });

  const children: OutputItem[] = [];
  for (const g of groups) {
    if (g.label) children.push(textItem(g.label));
    const valid = g.rows.filter((r) => cols.every((c) => !isMissing(c.v, c.col[r] as DataCell, o.includeUser)));
    const n = valid.length;
    const total = g.rows.length;
    const footMeasure = ctx.t('ext.cluster.measureUsed', { measure: measureName(o.measure, ctx) });
    // Case Processing Summary
    children.push(
      tableItem(
        {
          caption: ctx.t('ext.cluster.caseSummary'),
          head: [
            [th('', { rowspan: 3 }), th(ctx.t('ext.cluster.cases'), { colspan: 6 })],
            [th(ctx.t('ext.cluster.valid'), { colspan: 2 }), th(ctx.t('ext.cluster.missing'), { colspan: 2 }), th(ctx.t('ext.cluster.total'), { colspan: 2 })],
            [0, 1, 2].flatMap(() => [th('N'), th(ctx.t('ext.cluster.percent'))]),
          ],
          body: [
            [
              td(String(n)),
              td(pct(total ? (100 * n) / total : 0, ctx)),
              td(String(total - n)),
              td(pct(total ? (100 * (total - n)) / total : 0, ctx)),
              td(String(total)),
              td(pct(total ? 100 : 0, ctx)),
            ],
          ],
          footnotes: [footMeasure, ...(o.methods.length === 1 ? [methodName(o.methods[0].method, ctx)] : [])],
        },
        NAME,
      ),
    );
    if (n > MAX_CASES) throw new ExtError(ctx.t('ext.cluster.tooMany', { n, max: MAX_CASES }));
    if (n < 2) {
      children.push(messageItem('warning', ctx.t('ext.cluster.tooFew'), ctx.line));
      continue;
    }
    const X = valid.map((r) => cols.map((c) => c.col[r] as number));
    const label = (i: number) => {
      if (!idv) return String(i + 1);
      const x = idv.col[valid[i]] as DataCell;
      return `${i + 1}:${x === null || x === undefined ? '' : valueText(idv.v, x)}`;
    };
    const D = proximityMatrix(X, o.measure);
    if (o.distance) {
      if (n > MAX_PROXIMITY_CASES) children.push(messageItem('warning', ctx.t('ext.cluster.proximityLarge', { max: MAX_PROXIMITY_CASES }), ctx.line));
      else {
        const diag = sim ? 1 : 0;
        children.push(
          tableItem(
            {
              caption: ctx.t('ext.cluster.proximity'),
              head: [
                [th(ctx.t('ext.cluster.case'), { rowspan: 2 }), th(measureName(o.measure, ctx), { colspan: n })],
                Array.from({ length: n }, (_, j) => th(label(j))),
              ],
              body: Array.from({ length: n }, (_, i) => [
                th(label(i)),
                ...Array.from({ length: n }, (_, j) => td(fmt(i === j ? diag : D[i < j ? cidx(n, i, j) : cidx(n, j, i)], 3, ctx))),
              ]),
              footnotes: [ctx.t(sim ? 'ext.cluster.simMatrix' : 'ext.cluster.dissimMatrix')],
            },
            NAME,
          ),
        );
      }
    }
    for (const [mi, m] of methods.entries()) {
      const out: OutputItem[] = [];
      const stages = agglomerate(D, n, m.method, sim);
      if (o.schedule) {
        out.push(
          tableItem(
            {
              caption: ctx.t('ext.cluster.schedule'),
              head: [
                [
                  th(ctx.t('ext.cluster.stage'), { rowspan: 2 }),
                  th(ctx.t('ext.cluster.combined'), { colspan: 2 }),
                  th(ctx.t('ext.cluster.coefficients'), { rowspan: 2 }),
                  th(ctx.t('ext.cluster.firstAppears'), { colspan: 2 }),
                  th(ctx.t('ext.cluster.nextStage'), { rowspan: 2 }),
                ],
                [th(ctx.t('ext.cluster.cluster1')), th(ctx.t('ext.cluster.cluster2')), th(ctx.t('ext.cluster.cluster1')), th(ctx.t('ext.cluster.cluster2'))],
              ],
              body: stages.map((s, i) => [
                th(String(i + 1)),
                td(String(s.c1)),
                td(String(s.c2)),
                td(fmt(s.coef, 3, ctx)),
                td(String(s.first1)),
                td(String(s.first2)),
                td(String(s.next)),
              ]),
            },
            NAME,
          ),
        );
      }
      if (o.printRange) {
        const ks = range2list(o.printRange).reverse().filter((k) => k <= n);
        if (ks.length < range2list(o.printRange).length) out.push(messageItem('warning', ctx.t('ext.cluster.moreThanCases', { n }), ctx.line));
        if (ks.length) {
          const mem = ks.map((k) => membership(stages, n, k));
          out.push(
            tableItem(
              {
                caption: ctx.t('ext.cluster.membership'),
                head: [[th(ctx.t('ext.cluster.case')), ...ks.map((k) => th(ctx.t('ext.cluster.nClusters', { n: k })))]],
                body: Array.from({ length: n }, (_, i) => [th(label(i)), ...mem.map((mm) => td(String(mm[i])))]),
              },
              NAME,
            ),
          );
        }
      }
      if (o.dendrogram) {
        if (n > MAX_DENDROGRAM_CASES) out.push(messageItem('warning', ctx.t('ext.cluster.dendrogramLarge', { max: MAX_DENDROGRAM_CASES }), ctx.line));
        else {
          const h = rescale(stages, sim);
          out.push(
            chartItem(ctx.t('ext.cluster.dendrogramTitle', { method: methodName(m.method, ctx) }), {
              type: 'dendrogram',
              title: ctx.t('ext.cluster.dendrogramTitle', { method: methodName(m.method, ctx) }),
              xlabel: ctx.t('ext.cluster.rescaled'),
              labels: Array.from({ length: n }, (_, i) => (idv ? label(i).slice(String(i + 1).length + 1) : '')),
              numbers: Array.from({ length: n }, (_, i) => i + 1),
              merges: stages.map((s, i) => [s.c1, s.c2, Math.round(h[i] * 1000) / 1000, s.coef]),
              strings: {
                stage: ctx.t('ext.cluster.stage'),
                cluster1: ctx.t('ext.cluster.cluster1'),
                cluster2: ctx.t('ext.cluster.cluster2'),
                coefficient: ctx.t('ext.cluster.coefficients'),
                distance: ctx.t('ext.cluster.rescaled'),
                case: ctx.t('ext.cluster.case'),
              },
            }),
          );
        }
      }
      if (m.names.length) {
        const sv = saved[mi];
        saveKs.forEach((k, ki) => {
          if (k > n) return;
          const mm = membership(stages, n, k);
          valid.forEach((r, i) => (sv.values[ki][r] = mm[i]));
        });
      }
      if (methods.length > 1) children.push(textItem(methodName(m.method, ctx)));
      children.push(...out);
    }
  }
  items.push(groupItem(ctx.t('ext.cluster.title'), NAME, [...(o.methods.length === 1 ? [textItem(methodName(o.methods[0].method, ctx))] : []), ...children]));

  if (!saved.length) return items;
  const vars: Variable[] = [...ds.variables];
  const columns = [...ds.columns];
  for (const s of saved) {
    s.names.forEach((name, i) => {
      vars.push(
        makeVariable(name, {
          label: methodName(s.method, ctx),
          print: { type: 'F', w: 8, d: 0 },
          write: { type: 'F', w: 8, d: 0 },
          measure: 'nominal',
        }),
      );
      columns.push(s.values[i]);
    });
  }
  return { items, dataset: { ...ds, variables: vars, columns } };
}

function range2list([a, b]: [number, number]): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export const commands: ExtCommand[] = [{ name: NAME, run }];
