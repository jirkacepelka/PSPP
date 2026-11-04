/*
 * Plain-language interpretation of PSPP results (F6) and effect sizes (OUT-9).
 *
 * Works from the *structure* of PSPP's HTML tables (column positions, stub layout, table order),
 * not from their header text, so it reads output in any language and either decimal separator.
 * Each analyser returns language-neutral facts; features/output/interpretText.ts turns them into
 * Czech or English sentences.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { dataRows, parsePivot, stub, values, type PivotTable } from './pivot';

export interface GroupStat {
  label: string;
  n: number;
  mean: number;
  sd: number;
}

export type Size = 'negligible' | 'small' | 'medium' | 'large';

export type Fact =
  | {
      kind: 'ttestInd';
      variable: string;
      groups: [GroupStat, GroupStat];
      leveneP: number | null;
      /** true when the Welch row (equal variances not assumed) is reported */
      welch: boolean;
      t: number;
      df: number;
      p: number;
      diff: number;
      ci: [number, number] | null;
      d: number;
      dCi: [number, number];
      size: Size;
    }
  | { kind: 'ttestPaired'; label: string; a: GroupStat; b: GroupStat; r: number | null; diff: number; t: number; df: number; p: number; d: number; dCi: [number, number]; size: Size }
  | { kind: 'ttestOne'; variable: string; n: number; mean: number; sd: number; testValue: number; t: number; df: number; p: number; d: number; size: Size }
  | { kind: 'anova'; variable: string; groups: GroupStat[]; F: number; df1: number; df2: number; p: number; eta2: number; size: Size; leveneP: number | null }
  | { kind: 'correlation'; pairs: { a: string; b: string; r: number; p: number | null; n: number | null }[]; count: number }
  | { kind: 'crosstab'; title: string; chi2: number; df: number; p: number; n: number; v: number | null; size: Size | null }
  | { kind: 'regression'; dependent: string; r2: number; adjR2: number | null; F: number | null; df1: number | null; df2: number | null; p: number | null; predictors: { name: string; b: number; beta: number | null; t: number | null; p: number | null }[]; size: Size }
  | { kind: 'frequency'; variable: string; top: string; topPct: number | null; n: number | null; categories: number; missing: number | null }
  | { kind: 'descriptive'; variable: string; n: number; mean: number; sd: number; min: number | null; max: number | null }
  | { kind: 'mannWhitney'; variable: string; groups: { label: string; n: number; meanRank: number }[]; U: number; z: number; p: number; r: number; size: Size }
  | { kind: 'kruskal'; variable: string; groups: { label: string; n: number; meanRank: number }[]; H: number; df: number; p: number; eps2: number | null; size: Size | null }
  | { kind: 'wilcoxon'; label: string; neg: number; pos: number; ties: number; z: number; p: number; r: number | null; size: Size | null }
  | { kind: 'chisqOne'; variable: string; chi2: number; df: number; p: number; over: string | null; under: string | null }
  | { kind: 'reliability'; alpha: number; items: number; quality: 'excellent' | 'good' | 'acceptable' | 'questionable' | 'poor' };

export interface TableInput {
  title: string;
  html: string;
}

/* ------------------------------------------------------------------------- effect sizes */

/** Cohen's labels for d. */
export const sizeD = (d: number): Size => (Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large');
/** Cohen's labels for r (also used for r effect sizes of rank tests). */
export const sizeR = (r: number): Size => (Math.abs(r) < 0.1 ? 'negligible' : Math.abs(r) < 0.3 ? 'small' : Math.abs(r) < 0.5 ? 'medium' : 'large');
/** η² (Cohen 1988: .01 / .06 / .14). */
export const sizeEta = (e: number): Size => (e < 0.01 ? 'negligible' : e < 0.06 ? 'small' : e < 0.14 ? 'medium' : 'large');
/** Cramér's V, thresholds depend on df* = min(r, c) − 1 (Cohen 1988). */
export function sizeV(v: number, dfStar: number): Size {
  const k = Math.max(1, Math.min(dfStar, 5));
  const s = 0.1 / Math.sqrt(k);
  const m = 0.3 / Math.sqrt(k);
  const l = 0.5 / Math.sqrt(k);
  return v < s ? 'negligible' : v < m ? 'small' : v < l ? 'medium' : 'large';
}
/** f² for regression from R² (Cohen: .02 / .15 / .35). */
export const sizeR2 = (r2: number): Size => {
  const f2 = r2 / Math.max(1e-9, 1 - r2);
  return f2 < 0.02 ? 'negligible' : f2 < 0.15 ? 'small' : f2 < 0.35 ? 'medium' : 'large';
};

/** Cohen's d for two independent groups (pooled SD) with an approximate 95% CI (Hedges & Olkin). */
export function cohensD(a: GroupStat, b: GroupStat, z = 1.96): { d: number; ci: [number, number] } {
  const sp = Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / Math.max(1, a.n + b.n - 2));
  const d = sp > 0 ? (a.mean - b.mean) / sp : 0;
  const se = Math.sqrt((a.n + b.n) / (a.n * b.n) + d ** 2 / (2 * (a.n + b.n)));
  return { d, ci: [d - z * se, d + z * se] };
}

/** d_z for paired data: mean difference / SD of differences, with an approximate CI. */
export function cohensDz(diff: number, sdDiff: number, n: number, z = 1.96): { d: number; ci: [number, number] } {
  const d = sdDiff > 0 ? diff / sdDiff : 0;
  const se = Math.sqrt(1 / n + d ** 2 / (2 * n));
  return { d, ci: [d - z * se, d + z * se] };
}

export function alphaQuality(a: number): 'excellent' | 'good' | 'acceptable' | 'questionable' | 'poor' {
  return a >= 0.9 ? 'excellent' : a >= 0.8 ? 'good' : a >= 0.7 ? 'acceptable' : a >= 0.6 ? 'questionable' : 'poor';
}

/* ------------------------------------------------------------------------- helpers */

const num = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
/** Number of stub (row header) columns of a data row. */
const stubCount = (row: ReturnType<typeof dataRows>[number]) => row.findIndex((c) => !c.header);
function rowsOf(t: PivotTable) {
  return dataRows(t).map((row) => ({ stub: stub(row), vals: values(row), texts: row.filter((c) => !c.header).map((c) => c.text) }));
}

/* ------------------------------------------------------------------------- analysers */

function ttest(tables: PivotTable[]): Fact[] {
  const out: Fact[] = [];
  if (tables.length >= 3) {
    // paired: statistics (pair, var, N, M, SD, SE) · correlations (pair, label, N, r, p) · test
    const stats = rowsOf(tables[0]);
    const corr = rowsOf(tables[1]);
    const test = rowsOf(tables[2]);
    test.forEach((row, i) => {
      const a = stats[i * 2];
      const b = stats[i * 2 + 1];
      const [mean, sdDiff, , , , t, df, p] = row.vals;
      if (!a || !b || ![mean, sdDiff, t, df, p].every(num)) return;
      const ga: GroupStat = { label: a.stub[a.stub.length - 1], n: a.vals[0] ?? 0, mean: a.vals[1] ?? 0, sd: a.vals[2] ?? 0 };
      const gb: GroupStat = { label: b.stub[b.stub.length - 1], n: b.vals[0] ?? 0, mean: b.vals[1] ?? 0, sd: b.vals[2] ?? 0 };
      const { d, ci } = cohensDz(mean!, sdDiff!, ga.n);
      out.push({ kind: 'ttestPaired', label: row.stub[row.stub.length - 1], a: ga, b: gb, r: corr[i]?.vals[1] ?? null, diff: mean!, t: t!, df: df!, p: p!, d, dCi: ci, size: sizeD(d) });
    });
    return out;
  }
  if (tables.length < 2) return out;
  const stats = rowsOf(tables[0]);
  const test = rowsOf(tables[1]);
  const twoStub = dataRows(tables[0]).some((r) => stubCount(r) >= 2);
  if (twoStub) {
    // independent: stats rows come in pairs per variable; test rows in pairs (equal / unequal variances)
    for (let i = 0; i + 1 < test.length; i += 2) {
      const eq = test[i];
      const uneq = test[i + 1];
      const a = stats[i];
      const b = stats[i + 1];
      if (!a || !b) continue;
      const leveneP = eq.vals[1];
      const welch = num(leveneP) && leveneP < 0.05;
      const row = welch ? uneq : eq;
      const [, , t, df, p, diff, , lo, hi] = row.vals;
      if (![t, df, p].every(num)) continue;
      const ga: GroupStat = { label: a.stub[1] ?? '1', n: a.vals[0] ?? 0, mean: a.vals[1] ?? 0, sd: a.vals[2] ?? 0 };
      const gb: GroupStat = { label: b.stub[1] ?? '2', n: b.vals[0] ?? 0, mean: b.vals[1] ?? 0, sd: b.vals[2] ?? 0 };
      const { d, ci } = cohensD(ga, gb);
      out.push({
        kind: 'ttestInd',
        variable: a.stub[0],
        groups: [ga, gb],
        leveneP: num(leveneP) ? leveneP : null,
        welch,
        t: t!,
        df: df!,
        p: p!,
        diff: num(diff) ? diff : ga.mean - gb.mean,
        ci: num(lo) && num(hi) ? [lo, hi] : null,
        d,
        dCi: ci,
        size: sizeD(d),
      });
    }
    return out;
  }
  // one sample: stats (var, N, M, SD, SE) · test (var, t, df, p, diff, lo, hi); test value from the header
  const header = tables[1].rows[0]?.find((c) => c.header && /\d/.test(c.text))?.text ?? '';
  const tv = Number((/(-?[\d.,]+)\s*$/.exec(header)?.[1] ?? '0').replace(',', '.'));
  test.forEach((row, i) => {
    const s = stats[i];
    const [t, df, p] = row.vals;
    if (!s || ![t, df, p].every(num)) return;
    const [n, mean, sd] = s.vals;
    const d = num(sd) && sd > 0 ? ((mean ?? 0) - tv) / sd : 0;
    out.push({ kind: 'ttestOne', variable: s.stub[0], n: n ?? 0, mean: mean ?? 0, sd: sd ?? 0, testValue: Number.isFinite(tv) ? tv : 0, t: t!, df: df!, p: p!, d, size: sizeD(d) });
  });
  return out;
}

function oneway(tables: PivotTable[]): Fact[] {
  // ANOVA table: rows (var, between/within/total) with SS, df, MS, F, p. Optional descriptives / Levene before it.
  const anova = tables.find((t) => {
    const r = rowsOf(t);
    return r.length >= 3 && r.length % 3 === 0 && r[0].vals.length === 5 && num(r[0].vals[3]);
  });
  if (!anova) return [];
  const desc = tables.find((t) => t !== anova && rowsOf(t)[0]?.vals.length >= 8);
  const lev = tables.find((t) => t !== anova && t !== desc && rowsOf(t)[0]?.vals.length === 4);
  const rows = rowsOf(anova);
  const out: Fact[] = [];
  for (let i = 0; i + 2 < rows.length; i += 3) {
    const [ssB, df1, , F, p] = rows[i].vals;
    const ssT = rows[i + 2].vals[0];
    const df2 = rows[i + 1].vals[1];
    if (![ssB, df1, F, p, ssT, df2].every(num)) continue;
    const variable = rows[i].stub[0];
    const groups: GroupStat[] = desc
      ? rowsOf(desc)
          .filter((r) => r.stub[0] === variable)
          .slice(0, -1)
          .map((r) => ({ label: r.stub[1] ?? '', n: r.vals[0] ?? 0, mean: r.vals[1] ?? 0, sd: r.vals[2] ?? 0 }))
      : [];
    const levRow = lev ? rowsOf(lev).find((r) => r.stub[0] === variable) : undefined;
    const eta2 = ssB! / ssT!;
    out.push({ kind: 'anova', variable, groups, F: F!, df1: df1!, df2: df2!, p: p!, eta2, size: sizeEta(eta2), leveneP: levRow?.vals[3] ?? null });
  }
  return out;
}

function correlations(tables: PivotTable[]): Fact[] {
  const t = tables[0];
  if (!t) return [];
  const header = t.rows.find((r) => r.filter((c) => c.header && c.text).length >= 2) ?? [];
  const sw = stubCount(dataRows(t)[0] ?? []);
  const names = header.slice(sw).map((c) => c.text);
  const rows = rowsOf(t);
  // rows come in triples (r, p, N) per variable; NONPAR CORR (SPSS layout) adds a leading method
  // column (Kendall's tau_b / Spearman's rho) and with PRINT=BOTH repeats the rows per method:
  // the first method block is read
  const blocks = sw >= 3 ? Math.max(1, new Set(rows.map((r) => r.stub[0])).size) : 1;
  const per = rows.length / blocks / Math.max(1, names.length);
  if (!Number.isInteger(per) || per < 1) return [];
  const pairs: { a: string; b: string; r: number; p: number | null; n: number | null }[] = [];
  for (let i = 0; i < names.length; i++) {
    const rRow = rows[i * per];
    const pRow = per >= 2 ? rows[i * per + 1] : undefined;
    const nRow = per >= 3 ? rows[i * per + 2] : undefined;
    for (let j = i + 1; j < names.length; j++) {
      const r = rRow?.vals[j];
      if (!num(r)) continue;
      pairs.push({ a: rRow.stub[sw >= 3 ? 1 : 0], b: names[j], r, p: pRow?.vals[j] ?? null, n: nRow?.vals[j] ?? null });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return pairs.length ? [{ kind: 'correlation', pairs, count: pairs.length }] : [];
}

function crosstabs(tables: PivotTable[]): Fact[] {
  const out: Fact[] = [];
  // a chi-square table: rows (label, value, df, p) with the first row being Pearson
  tables.forEach((t, idx) => {
    const rows = rowsOf(t);
    if (rows.length < 2 || rows[0].vals.length < 3) return;
    const [chi2, df, p] = rows[0].vals;
    if (![chi2, df, p].every(num) || !Number.isInteger(df)) return;
    const nRow = rows[rows.length - 1];
    const n = nRow.vals[0];
    if (!num(n) || nRow.vals.slice(1).some(num)) return;
    // the contingency table precedes the tests; count its row and column categories
    let rCat = 0;
    let cCat = 0;
    for (let k = idx - 1; k >= 0; k--) {
      const ct = dataRows(tables[k]);
      const sw = stubCount(ct[0] ?? []);
      if (sw >= 2) {
        rCat = new Set(ct.map((r) => r[1]?.text)).size - 1; // minus Total
        cCat = (ct[0]?.length ?? 0) - sw - 1;
        break;
      }
    }
    const dfStar = Math.min(rCat, cCat) - 1;
    const v = dfStar >= 1 ? Math.sqrt(chi2! / (n * dfStar)) : null;
    const contingency = tables.slice(0, idx).reverse().find((x) => stubCount(dataRows(x)[0] ?? []) >= 2);
    out.push({ kind: 'crosstab', title: contingency?.caption ?? '', chi2: chi2!, df: df!, p: p!, n, v, size: v !== null ? sizeV(v, dfStar) : null });
  });
  return out;
}

function regression(tables: PivotTable[]): Fact[] {
  // Model summary has no stub: R, R², adj. R², SEE.
  const summary = tables.find((t) => {
    const r = dataRows(t);
    return r.length >= 1 && stubCount(r[0]) === 0 && r[0].length >= 3;
  });
  if (!summary) return [];
  const sv = values(dataRows(summary)[0]);
  const r2 = sv[1];
  if (!num(r2)) return [];
  const anova = tables.find((t) => t !== summary && rowsOf(t).length === 3 && rowsOf(t)[0].vals.length === 5);
  const coeff = tables.find((t) => t !== summary && t !== anova && rowsOf(t).length >= 2 && rowsOf(t)[0].vals.length >= 4);
  const a = anova ? rowsOf(anova) : null;
  const predictors = coeff
    ? rowsOf(coeff)
        .slice(1)
        .map((r) => {
          const n = r.vals.length;
          return { name: r.stub[r.stub.length - 1], b: r.vals[0] ?? 0, beta: n >= 5 ? r.vals[2] : null, t: r.vals[n - 2], p: r.vals[n - 1] };
        })
    : [];
  const dep = /\(([^()]*)\)\s*$/.exec(summary.caption)?.[1] ?? '';
  return [
    {
      kind: 'regression',
      dependent: dep,
      r2,
      adjR2: sv[2] ?? null,
      F: a?.[0].vals[3] ?? null,
      df1: a?.[0].vals[1] ?? null,
      df2: a?.[1].vals[1] ?? null,
      p: a?.[0].vals[4] ?? null,
      predictors,
      size: sizeR2(r2),
    },
  ];
}

function frequencies(tables: PivotTable[]): Fact[] {
  const out: Fact[] = [];
  for (const t of tables) {
    const rows = rowsOf(t);
    // frequency table: 2 stub columns, 4 value columns (freq, %, valid %, cum %)
    if (!rows.length || rows[0].stub.length < 2 || rows[0].vals.length !== 4) continue;
    const validGroup = rows[0].stub[0];
    const valid = rows.filter((r) => r.stub[0] === validGroup && r.stub[1] !== validGroup);
    const missing = rows.filter((r) => r.stub[0] !== validGroup && r.stub[0] !== rows[rows.length - 1].stub[0]);
    if (!valid.length) continue;
    const top = valid.reduce((x, y) => ((y.vals[0] ?? 0) > (x.vals[0] ?? 0) ? y : x));
    const total = rows[rows.length - 1].vals[0];
    out.push({
      kind: 'frequency',
      variable: t.caption,
      top: top.stub[1],
      topPct: top.vals[2] ?? top.vals[1] ?? null,
      n: num(total) ? total : null,
      categories: valid.length,
      missing: missing.reduce((s, r) => s + (r.vals[0] ?? 0), 0),
    });
  }
  return out;
}

function descriptives(tables: PivotTable[]): Fact[] {
  const t = tables[0];
  if (!t) return [];
  return rowsOf(t)
    .filter((r) => r.vals.length >= 3 && r.vals.slice(0, 3).every(num))
    .map((r) => ({ kind: 'descriptive' as const, variable: r.stub[0], n: r.vals[0]!, mean: r.vals[1]!, sd: r.vals[2]!, min: r.vals[3] ?? null, max: r.vals[4] ?? null }));
}

function nparTests(tables: PivotTable[]): Fact[] {
  const out: Fact[] = [];
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const rows = rowsOf(t);
    const prev = i > 0 ? rowsOf(tables[i - 1]) : [];
    // Mann-Whitney: test statistics row with U, W, Z, p (one row per variable)
    if (rows.length && rows[0].vals.length >= 4 && rows[0].stub.length === 1 && prev.length && prev[0].stub.length === 2 && prev[0].vals.length === 3) {
      rows.forEach((row) => {
        const [U, , z, p] = row.vals;
        if (![U, z, p].every(num)) return;
        const groups = prev.filter((r) => r.stub[0] === row.stub[0] && num(r.vals[1])).map((r) => ({ label: r.stub[1], n: r.vals[0] ?? 0, meanRank: r.vals[1] ?? 0 }));
        const N = groups.reduce((s, g) => s + g.n, 0);
        const r = N > 0 ? Math.abs(z!) / Math.sqrt(N) : 0;
        out.push({ kind: 'mannWhitney', variable: row.stub[0], groups, U: U!, z: z!, p: p!, r, size: sizeR(r) });
      });
      continue;
    }
    // Kruskal-Wallis: transposed test table (rows χ², df, p; one column per variable), ranks with N and mean rank
    if (rows.length === 3 && prev.length && prev[0].stub.length === 2 && prev[0].vals.length === 2) {
      const header = t.rows[0].filter((c) => c.header).slice(1).map((c) => c.text);
      header.forEach((variable, j) => {
        const H = rows[0].vals[j];
        const df = rows[1].vals[j];
        const p = rows[2].vals[j];
        if (![H, df, p].every(num)) return;
        const groups = prev.filter((r) => r.stub[0] === variable && num(r.vals[1])).map((r) => ({ label: r.stub[1], n: r.vals[0] ?? 0, meanRank: r.vals[1] ?? 0 }));
        const N = groups.reduce((s, g) => s + g.n, 0);
        const eps2 = N > 1 ? H! / (N - 1) : null;
        out.push({ kind: 'kruskal', variable, groups, H: H!, df: df!, p: p!, eps2, size: eps2 !== null ? sizeEta(eps2) : null });
      });
      continue;
    }
    // Wilcoxon: transposed (rows Z, p), ranks with negative / positive / ties / total per pair
    if (rows.length === 2 && prev.length >= 4 && prev[0].stub.length === 2 && prev[0].vals.length === 3) {
      const header = t.rows[0].filter((c) => c.header).slice(1).map((c) => c.text);
      header.forEach((label, j) => {
        const z = rows[0].vals[j];
        const p = rows[1].vals[j];
        if (![z, p].every(num)) return;
        const pr = prev.filter((r) => r.stub[0] === label);
        const [neg, pos, ties, total] = pr.map((r) => r.vals[0] ?? 0);
        const r = total ? Math.abs(z!) / Math.sqrt(total) : null;
        out.push({ kind: 'wilcoxon', label, neg: neg ?? 0, pos: pos ?? 0, ties: ties ?? 0, z: z!, p: p!, r, size: r !== null ? sizeR(r) : null });
      });
      continue;
    }
    // one-sample chi-square: test statistics rows (variable, χ², df, p) after observed/expected tables
    if (rows.length && rows[0].vals.length === 3 && rows[0].stub.length === 1 && prev.length && prev[0].vals.length === 3 && t.rows[0][0]?.text === '') {
      rows.forEach((row) => {
        const [chi2, df, p] = row.vals;
        if (![chi2, df, p].every(num)) return;
        const freq = tables.slice(0, i).reverse().find((x) => x.caption === row.stub[0]);
        const fr = freq ? rowsOf(freq).filter((r) => num(r.vals[2])) : [];
        const sorted = [...fr].sort((x, y) => (y.vals[2] ?? 0) - (x.vals[2] ?? 0));
        out.push({ kind: 'chisqOne', variable: row.stub[0], chi2: chi2!, df: df!, p: p!, over: sorted[0]?.stub[0] ?? null, under: sorted[sorted.length - 1]?.stub[0] ?? null });
      });
    }
  }
  return out;
}

function reliability(tables: PivotTable[]): Fact[] {
  for (const t of tables) {
    const rows = dataRows(t);
    if (rows.length === 1 && stubCount(rows[0]) <= 0) {
      const [alpha, items] = values(rows[0]);
      if (num(alpha) && num(items) && alpha <= 1) return [{ kind: 'reliability', alpha, items, quality: alphaQuality(alpha) }];
    }
  }
  return [];
}

const ANALYSERS: Record<string, (t: PivotTable[]) => Fact[]> = {
  'T-TEST': ttest,
  ONEWAY: oneway,
  CORRELATIONS: correlations,
  NONPAR: correlations,
  'NONPAR CORR': correlations,
  CROSSTABS: crosstabs,
  REGRESSION: regression,
  FREQUENCIES: frequencies,
  DESCRIPTIVES: descriptives,
  'NPAR TESTS': nparTests,
  RELIABILITY: reliability,
};

/** Commands this module can interpret. */
export const INTERPRETABLE = Object.keys(ANALYSERS);

/** Interprets the tables of one procedure (all tables of an output group, in order). */
export function interpret(command: string, tables: TableInput[]): Fact[] {
  const fn = ANALYSERS[command.toUpperCase().replace(/\s+/g, ' ').trim()];
  if (!fn || !tables.length) return [];
  try {
    return fn(tables.map((t) => parsePivot(t.html)));
  } catch (e) {
    console.warn('[interpret]', command, e);
    return [];
  }
}
