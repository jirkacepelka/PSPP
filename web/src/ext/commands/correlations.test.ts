/*
 * NONPAR CORR and PARTIAL CORR checked against scipy / numpy.
 *
 * Reference values were produced with scipy 1.18.1 / numpy by this script (user-missing
 * satisf = 9 treated as missing, as PSPP does):
 *
 *   import json, numpy as np
 *   from scipy import stats
 *   d = json.load(open('src/samples/students.json'))
 *   names = [v['name'] for v in d['variables']]
 *   def col(n):
 *       v = d['variables'][names.index(n)]; c = d['columns'][names.index(n)]
 *       miss = set(v['missing'].get('values', []))
 *       return np.array([np.nan if (x is None or x in miss) else x for x in c], float)
 *   V = ['hours', 'sleep', 'stress', 'gpa', 'satisf']
 *   C = {n: col(n) for n in V + ['gender', 'year', 'job']}
 *   def pair(a, b, mask=None, rep=None):
 *       x, y = C[a], C[b]
 *       ok = ~np.isnan(x) & ~np.isnan(y)
 *       if mask is not None: ok &= mask
 *       x, y = x[ok], y[ok]
 *       if rep is not None: r = rep[ok].astype(int); x, y = np.repeat(x, r), np.repeat(y, r)
 *       s = stats.spearmanr(x, y); k = stats.kendalltau(x, y, variant='b', method='asymptotic')
 *       return [s.statistic, s.pvalue, k.statistic, k.pvalue, len(x)]
 *   pairwise = {f'{a}-{b}': pair(a, b) for i, a in enumerate(V) for b in V[i+1:]}
 *   lw = np.all([~np.isnan(C[n]) for n in V], axis=0)
 *   listwise = {f'{a}-{b}': pair(a, b, lw) for ...}
 *   weighted_year = pair('hours', 'gpa', rep=C['year']), pair('stress', 'satisf', rep=C['year'])
 *   filter_job = pair('hours', 'gpa', mask=C['job'] == 1)
 *   split_gender = {g: pair('hours', 'gpa', mask=C['gender'] == g) for g in (1, 2, 3)}
 *   def partial(x, y, ctrl, mask=None):      # residual regression, listwise
 *       cols = [x, y] + ctrl
 *       ok = np.all([~np.isnan(C[n]) for n in cols], axis=0)
 *       if mask is not None: ok &= mask
 *       Z = np.column_stack([np.ones(ok.sum())] + [C[n][ok] for n in ctrl])
 *       rx = C[x][ok] - Z @ np.linalg.lstsq(Z, C[x][ok], rcond=None)[0]
 *       ry = C[y][ok] - Z @ np.linalg.lstsq(Z, C[y][ok], rcond=None)[0]
 *       r = np.corrcoef(rx, ry)[0, 1]; df = ok.sum() - 2 - len(ctrl)
 *       return [r, 2 * stats.t.sf(abs(r * np.sqrt(df / (1 - r * r))), df), df]
 *   # partial_rep: the same on np.repeat(..., year) (frequency weights by replication)
 *   # zero-order / descriptives: stats.pearsonr and mean/std(ddof=1) on the listwise cases of
 *   #   hours, stress, gpa, sleep
 *   ties: spearmanr / kendalltau(method='asymptotic') of
 *     [1,2,2,3,3,3,4,5,5,6] and [2,1,2,2,4,3,5,5,4,6];  n3: [1,2,3] and [1,3,2]
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import students from '../../samples/students.json';
import type { Dataset, OutputItem } from '../../engine/types';
import type { PivotTable } from '../../lib/pivot';
import { errorsOf, flatItems, haveEngine, runExt, runMixed, tables } from '../testing';
import { kendallTauB, midranks, partialFromCorr, pearson, spearman } from './correlations';

const ds = students as unknown as Dataset;

// [rho, p(rho), tau_b, p(tau_b), n]
const PAIRWISE: Record<string, number[]> = {
  'hours-sleep': [-0.1560932185478817, 0.09427970731937693, -0.1094890523797763, 0.08514217939490049, 116],
  'hours-stress': [0.3577031586346025, 6.046961228413118e-5, 0.2501763405515687, 7.563076486956889e-5, 120],
  'hours-gpa': [0.28077499836728365, 0.0020718912566307815, 0.18907742250746104, 0.0024925243012401898, 118],
  'hours-satisf': [-0.016618290465098516, 0.8582427755842934, -0.010585073722724507, 0.8810429319522519, 118],
  'sleep-stress': [-0.42467272301477454, 2.0219452865659203e-6, -0.3016426399711509, 3.4398386224674777e-6, 116],
  'sleep-gpa': [0.06684080825281255, 0.47982113790937697, 0.034657981948940375, 0.5897482931806491, 114],
  'sleep-satisf': [0.06166183599915539, 0.5145732963446018, 0.05116018671472341, 0.48153421789016393, 114],
  'stress-gpa': [-0.03528343538364535, 0.7044544766560006, -0.022778282626774986, 0.721313994909456, 118],
  'stress-satisf': [-0.13484398777154377, 0.14543527076801707, -0.10551568050269977, 0.14441214273789552, 118],
  'gpa-satisf': [-0.007382271651730463, 0.9373114119166462, -0.008589729085001416, 0.9043118761482933, 116],
};
const LISTWISE: Record<string, number[]> = {
  'hours-sleep': [-0.1888648890402464, 0.046116921574405195, -0.1328196625841156, 0.04028296777462527, 112],
  'hours-gpa': [0.32364952159675936, 0.0004996585011843094, 0.21852577466680473, 0.0006671063753838023, 112],
  'sleep-stress': [-0.4313956656697045, 2.0471303145977583e-6, -0.30584447826106803, 3.821208014495066e-6, 112],
  'gpa-satisf': [0.009920231432409828, 0.9173196316561669, 0.004700712784927278, 0.9484452538633396, 112],
};
const WEIGHTED_YEAR = {
  'hours-gpa': [0.26386282901872393, 2.7625332117985586e-6, 0.18033096678786326, 3.1298791807872987e-6, 307],
  'stress-satisf': [-0.24249115012243455, 2.0412781686480536e-5, -0.18989956482818673, 2.4464013548174838e-5, 302],
};
const FILTER_JOB = [0.3248850218001225, 0.04081000719004919, 0.2337003782453777, 0.034798447843079804, 40];
const SPLIT_GENDER = [
  [0.21645812133867912, 0.07851527901907294, 0.14473685700319505, 0.08423428388987639, 67],
  [0.370754509558336, 0.009483039022313263, 0.263043733869733, 0.008704256303763282, 48],
  [0.5, 0.6666666666666666, 0.33333333333333337, 0.6015081344405899, 3],
];
// [r, p, df]
const PARTIAL = {
  'hours-gpa|sleep': [0.3032110989118965, 0.001096384549333462, 111],
  'hours-stress|sleep': [0.43249787107110726, 1.3861699044488015e-6, 113],
  'stress-gpa|sleep': [0.05633921713417968, 0.5533777540787272, 111],
  'hours-gpa|sleep,stress': [0.30929913413796295, 0.0009054984460984001, 110],
  'hours-satisf|sleep,stress': [0.07526082217991846, 0.430305046492121, 110],
};
const ZERO_HSG_SLEEP = { 'hours-stress': [0.4554473306285936, 3.551757302789134e-7], 'hours-gpa': [0.28328137983310653, 0.002257356268019842], 'stress-gpa': [0.015941775717341344, 0.8663107439689515], 'hours-sleep': [-0.17405580012738187, 0.06401283789904347] };
const DESC_HSG_SLEEP = { hours: [23.235964912280703, 8.096936241216993, 114], stress: [22.05263157894737, 6.048245712547394, 114], gpa: [2.7618421052631574, 0.4386192450238169, 114], sleep: [6.75701754385965, 1.0584651852385394, 114] };
const PARTIAL_WEIGHTED_YEAR = [0.29137813432420995, 3.5002723202764073e-7, 293];
const PARTIAL_FILTER_JOB = [0.3679861133412507, 0.021175571396411744, 37];

/* ------------------------------------------------------------------ helpers */

const label = (name: string) => ds.variables.find((v) => v.name === name)!.label || name;

/** Raw values of A and B on cases valid for both (user-missing excluded). */
function columns(a: string, b: string, data: Dataset = ds): [number[], number[]] {
  const ia = data.variables.findIndex((v) => v.name === a);
  const ib = data.variables.findIndex((v) => v.name === b);
  const miss = (i: number, x: unknown) => x === null || (data.variables[i].missing?.values ?? []).includes(x as number);
  const x: number[] = [];
  const y: number[] = [];
  data.columns[ia].forEach((v, r) => {
    const u = data.columns[ib][r];
    if (!miss(ia, v) && !miss(ib, u)) {
      x.push(v as number);
      y.push(u as number);
    }
  });
  return [x, y];
}

/** The cell at the row whose stub contains all STUBS (in order) and the column headed COL. */
function cell(t: PivotTable, stubs: string[], col: string) {
  const header = t.rows[0];
  const c = header.findIndex((h) => h.text === col);
  if (c < 0) throw new Error(`no column ${col} in ${header.map((h) => h.text).join('|')}`);
  const row = t.rows.find((r) => {
    const s = r.filter((x) => x.header).map((x) => x.text);
    let k = 0;
    for (const x of s) if (x === stubs[k]) k++;
    return k === stubs.length;
  });
  if (!row) throw new Error(`no row ${stubs.join(' / ')}`);
  return row[c];
}
const num = (t: PivotTable, stubs: string[], col: string) => cell(t, stubs, col).num;

/** Printed value equals X rounded to D decimals. */
function printed(got: number | null, x: number, d = 3) {
  expect(got).not.toBeNull();
  expect(Math.abs((got as number) - x)).toBeLessThanOrEqual(0.5 * 10 ** -d + 1e-9);
}

const K = "Kendall's tau_b";
const S = "Spearman's rho";
const COEF = 'Correlation Coefficient';
const SIG = 'Sig. (2-tailed)';
const warnings = (items: OutputItem[]) => flatItems(items).filter((i) => i.kind === 'message' && i.severity === 'warning');

/* ------------------------------------------------------------------ compute functions */

describe('rank correlation functions (full precision vs scipy)', () => {
  it('midranks average ties', () => {
    expect(midranks([10, 20, 20, 5, 20])).toEqual([2, 4, 4, 1, 4]);
  });
  it('Spearman and Kendall tau-b on the students sample, pairwise', () => {
    for (const [key, [rho, prho, tau, ptau, n]] of Object.entries(PAIRWISE)) {
      const [x, y] = columns(...(key.split('-') as [string, string]));
      const s = spearman(x, y);
      const k = kendallTauB(x, y);
      expect(s.n, key).toBe(n);
      expect(s.r, key).toBeCloseTo(rho, 10);
      expect(s.p, key).toBeCloseTo(prho, 9);
      expect(k.r, key).toBeCloseTo(tau, 10);
      expect(Math.abs(k.p - ptau) / ptau, key).toBeLessThan(1e-6);
    }
  });
  it('heavy ties and n = 3', () => {
    const tx = [1, 2, 2, 3, 3, 3, 4, 5, 5, 6];
    const ty = [2, 1, 2, 2, 4, 3, 5, 5, 4, 6];
    expect(spearman(tx, ty).r).toBeCloseTo(0.8805031446540882, 12);
    expect(spearman(tx, ty).p).toBeCloseTo(0.0007704198786218628, 10);
    expect(kendallTauB(tx, ty).r).toBeCloseTo(0.775, 12);
    expect(kendallTauB(tx, ty).p).toBeCloseTo(0.0037254433769676495, 9);
    expect(spearman([1, 2, 3], [1, 3, 2]).p).toBeCloseTo(0.6666666666666666, 9);
    expect(kendallTauB([1, 2, 3], [1, 3, 2]).r).toBeCloseTo(1 / 3, 12);
    expect(kendallTauB([1, 2, 3], [1, 3, 2]).p).toBeCloseTo(0.6015081344405899, 9);
  });
  it('constant variable and n < 3', () => {
    expect(spearman([1, 2, 3], [4, 4, 4]).r).toBeNaN();
    expect(kendallTauB([1, 2, 3], [4, 4, 4]).r).toBeNaN();
    expect(spearman([1, 2], [3, 5])).toMatchObject({ r: 1, n: 2 });
    expect(spearman([1, 2], [3, 5]).p).toBeNaN();
    expect(kendallTauB([1], [1]).r).toBeNaN();
  });
  it('partial correlation from the inverse correlation matrix equals residual regression', () => {
    const names = ['hours', 'gpa', 'sleep', 'stress'];
    // listwise over the four variables (no missing in stress, so the same cases as the reference)
    const idx = names.map((n) => ds.variables.findIndex((v) => v.name === n));
    const rows = ds.columns[0].map((_, r) => r).filter((r) => idx.every((i) => ds.columns[i][r] !== null));
    const cols = idx.map((i) => rows.map((r) => ds.columns[i][r] as number));
    const R = cols.map((a) => cols.map((b) => (a === b ? 1 : pearson(a, b))));
    expect(partialFromCorr(R, 0, 1, [2, 3])).toBeCloseTo(PARTIAL['hours-gpa|sleep,stress'][0], 12);
    const rows3 = ds.columns[0].map((_, r) => r).filter((r) => idx.slice(0, 3).every((i) => ds.columns[i][r] !== null));
    const c3 = idx.slice(0, 3).map((i) => rows3.map((r) => ds.columns[i][r] as number));
    const R3 = c3.map((a) => c3.map((b) => (a === b ? 1 : pearson(a, b))));
    expect(partialFromCorr(R3, 0, 1, [2])).toBeCloseTo(PARTIAL['hours-gpa|sleep'][0], 12);
  });
});

/* ------------------------------------------------------------------ NONPAR CORR */

describe('NONPAR CORR', () => {
  it('Spearman table in SPSS layout (default PRINT), pairwise', () => {
    const out = runExt('NONPAR CORR /VARIABLES=hours sleep stress gpa satisf.', ds);
    expect(errorsOf(out)).toEqual([]);
    const [t] = tables(out);
    expect(t.caption).toBe('Correlations');
    expect(t.rows[1].slice(0, 3).map((c) => c.text)).toEqual([S, label('hours'), COEF]);
    expect(t.rows[2][2].text).toBe(SIG);
    expect(t.rows[3][2].text).toBe('N');
    expect(t.rows.some((r) => r[0].text === K)).toBe(false);
    for (const [key, [rho, p, , , n]] of Object.entries(PAIRWISE)) {
      const [a, b] = key.split('-');
      printed(num(t, [S, label(a), COEF], label(b)), rho);
      printed(num(t, [S, label(b), COEF], label(a)), rho);
      printed(num(t, [S, label(a), SIG], label(b)), p);
      expect(num(t, [S, label(a), 'N'], label(b))).toBe(n);
    }
    // diagonal: 1.000, empty significance, N of the variable
    expect(cell(t, [S, label('hours'), COEF], label('hours')).text).toBe('1.000');
    expect(cell(t, [S, label('hours'), SIG], label('hours')).text).toBe('');
    expect(num(t, [S, label('satisf'), 'N'], label('satisf'))).toBe(118);
    expect(t.footnotes).toEqual([]); // SIG (default): no flags
  });

  it('PRINT=BOTH NOSIG: Kendall then Spearman, flags with footnotes', () => {
    const out = runExt('NONPAR CORR VARIABLES=hours sleep stress gpa /PRINT=BOTH TWOTAIL NOSIG /MISSING=PAIRWISE.', ds);
    const [t] = tables(out);
    const groups = t.rows.slice(1).map((r) => r[0].text);
    expect(groups.indexOf(K)).toBeLessThan(groups.indexOf(S));
    for (const key of ['hours-sleep', 'hours-stress', 'hours-gpa', 'sleep-stress', 'stress-gpa']) {
      const [a, b] = key.split('-');
      const [rho, , tau, ptau] = PAIRWISE[key];
      printed(num(t, [K, label(a), COEF], label(b)), tau);
      printed(num(t, [K, label(a), SIG], label(b)), ptau);
      printed(num(t, [S, label(a), COEF], label(b)), rho);
    }
    // ** for p < .01, * for p < .05, none otherwise (markers are <sup>, so the numbers still parse)
    const html = flatItems(out).find((i) => i.kind === 'table')!;
    expect(html.kind === 'table' && html.html).toContain('.358<sup>**</sup>');
    expect(html.kind === 'table' && html.html).not.toContain('-.156<sup>');
    expect(t.footnotes).toEqual(['Correlation is significant at the 0.01 level (2-tailed).']);
  });

  it('flags at the 0.05 level and one-tailed significance', () => {
    const out = runExt('NONPAR CORR /VARIABLES=hours sleep /PRINT=SPEARMAN ONETAIL NOSIG.', ds);
    const [t] = tables(out);
    printed(num(t, [S, label('hours'), 'Sig. (1-tailed)'], label('sleep')), PAIRWISE['hours-sleep'][1] / 2);
    expect(t.footnotes).toEqual(['Correlation is significant at the 0.05 level (1-tailed).']);
  });

  it('LISTWISE uses the cases complete on all variables', () => {
    const out = runExt('NONPAR CORR /VARIABLES=hours sleep stress gpa satisf /PRINT=BOTH /MISSING=LISTWISE.', ds);
    const [t] = tables(out);
    for (const [key, [rho, prho, tau, ptau, n]] of Object.entries(LISTWISE)) {
      const [a, b] = key.split('-');
      printed(num(t, [S, label(a), COEF], label(b)), rho);
      printed(num(t, [S, label(a), SIG], label(b)), prho);
      printed(num(t, [K, label(a), COEF], label(b)), tau);
      printed(num(t, [K, label(a), SIG], label(b)), ptau);
      expect(num(t, [K, label(a), 'N'], label(b))).toBe(n);
    }
  });

  it('MISSING=INCLUDE treats user-missing 9 as valid', () => {
    const [t] = tables(runExt('NONPAR CORR /VARIABLES=hours satisf /MISSING=PAIRWISE INCLUDE.', ds));
    expect(num(t, [S, label('hours'), 'N'], label('satisf'))).toBe(120);
  });

  it('WITH gives a rectangular table', () => {
    const [t] = tables(runExt('NONPAR CORR /VARIABLES=hours sleep WITH gpa stress /PRINT=KENDALL.', ds));
    expect(t.rows[0].slice(3).map((c) => c.text)).toEqual([label('gpa'), label('stress')]);
    printed(num(t, [K, label('sleep'), COEF], label('stress')), PAIRWISE['sleep-stress'][2]);
    printed(num(t, [K, label('hours'), COEF], label('gpa')), PAIRWISE['hours-gpa'][2]);
    expect(t.rows.length).toBe(1 + 2 * 3);
  });

  it('variable list without VARIABLES= and TO', () => {
    const [t] = tables(runExt('NONPAR CORR hours TO sleep.', ds));
    printed(num(t, [S, label('hours'), COEF], label('sleep')), PAIRWISE['hours-sleep'][0]);
  });

  it('integer WEIGHT replicates cases', () => {
    const [t] = tables(runExt('NONPAR CORR /VARIABLES=hours gpa stress satisf /PRINT=BOTH.', { ...ds, weight: 'year' }));
    for (const [key, [rho, prho, tau, ptau, n]] of Object.entries(WEIGHTED_YEAR)) {
      const [a, b] = key.split('-');
      printed(num(t, [S, label(a), COEF], label(b)), rho);
      printed(num(t, [S, label(a), SIG], label(b)), prho);
      printed(num(t, [K, label(a), COEF], label(b)), tau);
      printed(num(t, [K, label(a), SIG], label(b)), ptau);
      expect(num(t, [K, label(a), 'N'], label(b))).toBe(n);
    }
  });

  it('non-integer WEIGHT is ignored with a warning', () => {
    const out = runExt('NONPAR CORR /VARIABLES=hours gpa.', { ...ds, weight: 'gpa' });
    expect(warnings(out).length).toBe(1);
    const [t] = tables(out);
    printed(num(t, [S, label('hours'), COEF], label('gpa')), PAIRWISE['hours-gpa'][0]);
    expect(num(t, [S, label('hours'), 'N'], label('gpa'))).toBe(118);
  });

  it('FILTER', () => {
    const [t] = tables(runExt('NONPAR CORR /VARIABLES=hours gpa /PRINT=BOTH.', { ...ds, filter: 'job' }));
    printed(num(t, [S, label('hours'), COEF], label('gpa')), FILTER_JOB[0]);
    printed(num(t, [K, label('hours'), SIG], label('gpa')), FILTER_JOB[3]);
    expect(num(t, [S, label('hours'), 'N'], label('gpa'))).toBe(40);
  });

  it('SPLIT FILE: one table per group, preceded by the group label (incl. a group of n = 3)', () => {
    const gi = ds.variables.findIndex((v) => v.name === 'gender');
    const order = ds.columns[gi].map((_, r) => r).sort((a, b) => (ds.columns[gi][a] as number) - (ds.columns[gi][b] as number) || a - b);
    const sorted: Dataset = { ...ds, columns: ds.columns.map((c) => order.map((r) => c[r])), split: ['gender'] };
    const out = runExt('NONPAR CORR /VARIABLES=hours gpa /PRINT=BOTH.', sorted);
    const ts = tables(out);
    expect(ts.length).toBe(3);
    expect(flatItems(out).filter((i) => i.kind === 'text').length).toBe(3);
    ts.forEach((t, g) => {
      const [rho, prho, tau, ptau, n] = SPLIT_GENDER[g];
      printed(num(t, [S, label('hours'), COEF], label('gpa')), rho);
      printed(num(t, [S, label('hours'), SIG], label('gpa')), prho);
      printed(num(t, [K, label('hours'), COEF], label('gpa')), tau);
      printed(num(t, [K, label('hours'), SIG], label('gpa')), ptau);
      expect(num(t, [K, label('hours'), 'N'], label('gpa'))).toBe(n);
    });
  });

  it('constant variable: empty cells and a warning; n < 3: no significance', () => {
    const small: Dataset = {
      ...ds,
      variables: [ds.variables[5], ds.variables[6], { ...ds.variables[9], name: 'k', label: '' }],
      columns: [
        [1, 2, null, 4],
        [3, 5, 6, null],
        [7, 7, 7, 7],
      ],
    };
    const out = runExt('NONPAR CORR /VARIABLES=hours sleep k /PRINT=BOTH.', small);
    expect(warnings(out).length).toBe(1);
    const [t] = tables(out);
    expect(cell(t, [S, label('hours'), COEF], 'k').text).toBe('');
    expect(cell(t, [S, label('hours'), SIG], 'k').text).toBe('');
    expect(num(t, [S, label('hours'), 'N'], 'k')).toBe(3);
    expect(num(t, [S, label('hours'), COEF], label('sleep'))).toBe(1);
    expect(cell(t, [S, label('hours'), SIG], label('sleep')).text).toBe('');
    expect(num(t, [S, label('hours'), 'N'], label('sleep'))).toBe(2);
  });

  it('Czech output and decimal comma', () => {
    const out = runExt('NONPAR CORR /VARIABLES=hours stress /PRINT=BOTH NOSIG.', ds, 'cs', ',');
    const [t] = tables(out);
    expect(t.caption).toBe('Korelace');
    expect(t.rows.map((r) => r[0].text)).toContain('Spearmanovo rho');
    expect(t.rows.map((r) => r[0].text)).toContain('Kendallovo tau_b');
    expect(t.rows.map((r) => r[2].text)).toContain('Korelační koeficient');
    expect(t.rows.map((r) => r[2].text)).toContain('Sig. (oboustranná)');
    expect(cell(t, ['Spearmanovo rho', label('hours'), 'Korelační koeficient'], label('stress')).text).toBe(',358');
  });

  it('errors', () => {
    expect(errorsOf(runExt('NONPAR CORR /VARIABLES=hours.', ds)).length).toBe(1);
    expect(errorsOf(runExt('NONPAR CORR /VARIABLES=hours commute.', ds))[0]).toContain('commute');
    expect(errorsOf(runExt('NONPAR CORR /VARIABLES=hours nosuch.', ds))[0]).toContain('nosuch');
    expect(errorsOf(runExt('NONPAR CORR /VARIABLES=hours sleep /FOO=1.', ds))[0]).toContain('FOO');
  });
});

/* ------------------------------------------------------------------ PARTIAL CORR */

describe('PARTIAL CORR', () => {
  const CV = 'Control Variables';
  const COR = 'Correlation';
  const PSIG = 'Significance (2-tailed)';

  it('partial block (listwise) in SPSS layout', () => {
    const out = runExt('PARTIAL CORR /VARIABLES=hours stress gpa BY sleep /SIGNIFICANCE=TWOTAIL /MISSING=LISTWISE.', ds);
    expect(errorsOf(out)).toEqual([]);
    const [t] = tables(out);
    expect(t.caption).toBe('Correlations');
    expect(t.rows[0][0].text).toBe(CV);
    const sl = label('sleep');
    expect(t.rows[1].slice(0, 3).map((c) => c.text)).toEqual([sl, label('hours'), COR]);
    for (const key of ['hours-gpa|sleep', 'stress-gpa|sleep'] as const) {
      const [a, b] = key.split('|')[0].split('-');
      const [r, p, df] = PARTIAL[key];
      printed(num(t, [sl, label(a), COR], label(b)), r);
      printed(num(t, [sl, label(b), COR], label(a)), r);
      printed(num(t, [sl, label(a), PSIG], label(b)), p);
      expect(num(t, [sl, label(a), 'df'], label(b))).toBe(df);
    }
    expect(cell(t, [sl, label('hours'), COR], label('hours')).text).toBe('1.000');
    expect(cell(t, [sl, label('hours'), PSIG], label('hours')).text).toBe('');
    expect(num(t, [sl, label('hours'), 'df'], label('hours'))).toBe(0);
    expect(tables(out).length).toBe(1);
  });

  it('pairwise-sized listwise sample: only the variables named are used', () => {
    const [t] = tables(runExt('PARTIAL CORR /VARIABLES=hours stress BY sleep.', ds));
    const [r, p, df] = PARTIAL['hours-stress|sleep'];
    printed(num(t, [label('sleep'), label('hours'), COR], label('stress')), r);
    printed(num(t, [label('sleep'), label('hours'), PSIG], label('stress')), p);
    expect(num(t, [label('sleep'), label('hours'), 'df'], label('stress'))).toBe(df);
  });

  it('two control variables, DESCRIPTIVES and zero-order correlations', () => {
    const out = runExt('PARTIAL CORR /VARIABLES=hours gpa BY sleep stress /STATISTICS=DESCRIPTIVES CORR.', ds);
    const [desc, t] = tables(out);
    expect(desc.caption).toBe('Descriptive Statistics');
    expect(desc.rows[0].slice(1).map((c) => c.text)).toEqual(['Mean', 'Std. Deviation', 'N']);
    expect(desc.rows.slice(1).map((r) => r[0].text)).toEqual(['hours', 'gpa', 'sleep', 'stress'].map(label));
    // zero-order block heads with "-none-" (footnote a), control variables included as rows and columns
    expect(t.rows[1][0].text).toBe('-none-');
    expect(t.footnotes).toEqual(['Cells contain zero-order (Pearson) correlations.']);
    expect(t.rows[0].slice(3).map((c) => c.text)).toEqual(['hours', 'gpa', 'sleep', 'stress'].map(label));
    const ctl = `${label('sleep')} & ${label('stress')}`;
    const [r, p, df] = PARTIAL['hours-gpa|sleep,stress'];
    printed(num(t, [ctl, label('hours'), COR], label('gpa')), r);
    printed(num(t, [ctl, label('hours'), PSIG], label('gpa')), p);
    expect(num(t, [ctl, label('hours'), 'df'], label('gpa'))).toBe(df);
    // control columns are empty in the partial block
    expect(cell(t, [ctl, label('hours'), COR], label('sleep')).text).toBe('');
    // zero-order df = n - 2
    expect(num(t, ['-none-', label('hours'), 'df'], label('gpa'))).toBe(112);
  });

  it('zero-order block and descriptives match numpy on the listwise sample', () => {
    const out = runExt('PARTIAL CORR /VARIABLES=hours stress gpa BY sleep /STATISTICS=DESCRIPTIVES CORR.', ds);
    const [desc, t] = tables(out);
    for (const [n, [mean, sd, N]] of Object.entries(DESC_HSG_SLEEP)) {
      const row = desc.rows.find((r) => r[0].text === label(n))!;
      const d = (ds.variables.find((v) => v.name === n)!.print.d ?? 0) + 2;
      printed(row[1].num, mean, d);
      printed(row[2].num, sd, d);
      expect(row[3].num).toBe(N);
    }
    for (const [key, [r, p]] of Object.entries(ZERO_HSG_SLEEP)) {
      const [a, b] = key.split('-');
      printed(num(t, ['-none-', label(a), COR], label(b)), r);
      printed(num(t, ['-none-', label(a), PSIG], label(b)), p);
      expect(num(t, ['-none-', label(a), 'df'], label(b))).toBe(112);
    }
  });

  it('FORMAT=NOSIG (condensed) flags significant partials; one-tailed', () => {
    const out = runExt('PARTIAL CORR hours stress gpa BY sleep /SIGNIFICANCE=ONETAIL /FORMAT=NOSIG.', ds);
    const [t] = tables(out);
    expect(t.rows.some((r) => r.some((c) => c.text.startsWith('Significance')))).toBe(false);
    expect(t.footnotes).toEqual(['Correlation is significant at the 0.01 level (1-tailed).']);
    const html = flatItems(out).find((i) => i.kind === 'table');
    expect(html?.kind === 'table' && html.html).toContain('.303<sup>**</sup>');
    const [t2] = tables(runExt('PARTIAL CORR hours gpa BY sleep /SIGNIFICANCE=ONETAIL.', ds));
    printed(num(t2, [label('sleep'), label('hours'), 'Significance (1-tailed)'], label('gpa')), PARTIAL['hours-gpa|sleep'][1] / 2);
  });

  it('WEIGHT (frequency) and FILTER', () => {
    const [tw] = tables(runExt('PARTIAL CORR /VARIABLES=hours gpa BY sleep.', { ...ds, weight: 'year' }));
    printed(num(tw, [label('sleep'), label('hours'), COR], label('gpa')), PARTIAL_WEIGHTED_YEAR[0]);
    printed(num(tw, [label('sleep'), label('hours'), PSIG], label('gpa')), PARTIAL_WEIGHTED_YEAR[1]);
    expect(num(tw, [label('sleep'), label('hours'), 'df'], label('gpa'))).toBe(PARTIAL_WEIGHTED_YEAR[2]);
    const [tf] = tables(runExt('PARTIAL CORR /VARIABLES=hours gpa BY sleep.', { ...ds, filter: 'job' }));
    printed(num(tf, [label('sleep'), label('hours'), COR], label('gpa')), PARTIAL_FILTER_JOB[0]);
    printed(num(tf, [label('sleep'), label('hours'), PSIG], label('gpa')), PARTIAL_FILTER_JOB[1]);
    expect(num(tf, [label('sleep'), label('hours'), 'df'], label('gpa'))).toBe(PARTIAL_FILTER_JOB[2]);
  });

  it('user-missing values are excluded (satisf = 9)', () => {
    const [t] = tables(runExt('PARTIAL CORR /VARIABLES=hours satisf BY sleep stress.', ds));
    const ctl = `${label('sleep')} & ${label('stress')}`;
    const [r, p, df] = PARTIAL['hours-satisf|sleep,stress'];
    printed(num(t, [ctl, label('hours'), COR], label('satisf')), r);
    printed(num(t, [ctl, label('hours'), PSIG], label('satisf')), p);
    expect(num(t, [ctl, label('hours'), 'df'], label('satisf'))).toBe(df);
  });

  it('MISSING=ANALYSIS: pairwise zero-order correlations, df from the smallest pairwise n', () => {
    const [t] = tables(runExt('PARTIAL CORR /VARIABLES=hours satisf BY sleep /STATISTICS=CORR /MISSING=ANALYSIS.', ds));
    printed(num(t, ['-none-', label('hours'), COR], label('satisf')), pearson(...columns('hours', 'satisf')));
    expect(num(t, ['-none-', label('hours'), 'df'], label('satisf'))).toBe(118 - 2);
    expect(num(t, ['-none-', label('hours'), 'df'], label('sleep'))).toBe(116 - 2);
    // smallest pairwise n among hours, satisf, sleep is 114 (sleep–satisf)
    expect(num(t, [label('sleep'), label('hours'), 'df'], label('satisf'))).toBe(114 - 3);
    // the partial from the pairwise matrix
    const r = (a: string, b: string) => pearson(...columns(a, b));
    const R = [
      [1, r('hours', 'satisf'), r('hours', 'sleep')],
      [r('hours', 'satisf'), 1, r('satisf', 'sleep')],
      [r('hours', 'sleep'), r('satisf', 'sleep'), 1],
    ];
    printed(num(t, [label('sleep'), label('hours'), COR], label('satisf')), partialFromCorr(R, 0, 1, [2]));
  });

  it('SPLIT FILE gives one table per group', () => {
    const out = runExt('PARTIAL CORR /VARIABLES=hours gpa BY sleep.', { ...ds, split: ['job'] });
    expect(tables(out).length).toBe(flatItems(out).filter((i) => i.kind === 'text').length);
    expect(tables(out).length).toBeGreaterThan(1);
  });

  it('constant control variable: empty partials and a warning', () => {
    const k: Dataset = { ...ds, variables: [...ds.variables, { ...ds.variables[5], name: 'k', label: '' }], columns: [...ds.columns, ds.columns[0].map(() => 5)] };
    const out = runExt('PARTIAL CORR /VARIABLES=hours gpa BY k.', k);
    expect(warnings(out).length).toBe(1);
    const [t] = tables(out);
    expect(cell(t, ['k', label('hours'), COR], label('gpa')).text).toBe('');
  });

  it('Czech output', () => {
    const [t] = tables(runExt('PARTIAL CORR /VARIABLES=hours gpa BY sleep /STATISTICS=CORR.', ds, 'cs', ','));
    expect(t.rows[0][0].text).toBe('Kontrolní proměnné');
    expect(t.rows[1][0].text).toBe('-žádné-');
    expect(t.rows.map((r) => r[2].text)).toContain('Významnost (oboustranná)');
  });

  it('errors', () => {
    expect(errorsOf(runExt('PARTIAL CORR /VARIABLES=hours gpa.', ds))[0]).toContain('BY');
    expect(errorsOf(runExt('PARTIAL CORR /VARIABLES=hours gpa BY gpa.', ds))[0]).toContain('gpa');
    expect(errorsOf(runExt('PARTIAL CORR /VARIABLES=hours BY gpa.', ds)).length).toBe(1);
  });
});

describe.skipIf(!haveEngine)('through the engine', () => {
  it('NONPAR CORR and PARTIAL CORR after PSPP transformations', async () => {
    const r = await runMixed('COMPUTE h2 = hours * 2.\nNONPAR CORR /VARIABLES=h2 gpa.\nPARTIAL CORR /VARIABLES=h2 gpa BY sleep.\n', ds);
    expect(errorsOf(r.items)).toEqual([]);
    const ts = tables(r.items);
    printed(ts[0].rows[1][3].num === 1 ? ts[0].rows[1][4].num : ts[0].rows[1][3].num, PAIRWISE['hours-gpa'][0]);
    expect(ts.length).toBe(2);
  }, 60000);
});

describe('dialog syntax is accepted by the parser', () => {
  it('Correlations dialog (Spearman / Kendall / both) and Partial correlations dialog', async () => {
    const { SPECS_BY_ID } = await import('../../features/dialogs/specs');
    const { defaultValues } = await import('../../features/dialogs/types');
    const ctx = { variables: ds.variables };
    const gen = (id: string, patch: Record<string, unknown>) => SPECS_BY_ID[id].toSyntax({ ...defaultValues(SPECS_BY_ID[id]), ...patch }, ctx);
    for (const method of ['SPEARMAN', 'KENDALL', 'BOTH']) {
      const out = runExt(gen('correlations', { variables: ['hours', 'stress'], method, tails: 'ONETAIL', missing: 'LISTWISE' }), ds);
      expect(errorsOf(out)).toEqual([]);
      const [t] = tables(out);
      expect(t.footnotes).toEqual(['Correlation is significant at the 0.01 level (1-tailed).']); // flag on by default
      expect(t.rows.some((r) => r[0].text === K)).toBe(method !== 'SPEARMAN');
      expect(t.rows.some((r) => r[0].text === S)).toBe(method !== 'KENDALL');
    }
    const out = runExt(gen('partialCorr', { variables: ['hours', 'gpa'], controls: ['sleep'], descriptives: true, zeroOrder: true, showSig: false, missing: 'ANALYSIS' }), ds);
    expect(errorsOf(out)).toEqual([]);
    expect(tables(out).map((t) => t.caption)).toEqual(['Descriptive Statistics', 'Correlations']);
  });
});

describe('interpretation cards read the SPSS-layout table', () => {
  it('NONPAR CORR with PRINT=BOTH yields Kendall pairs with variable names', async () => {
    const { interpret } = await import('../../lib/interpret');
    const items = flatItems(runExt('NONPAR CORR /VARIABLES=hours sleep stress /PRINT=BOTH.', ds)).filter((i) => i.kind === 'table');
    const facts = interpret('NONPAR CORR', items.map((i) => ({ title: i.title ?? '', html: i.kind === 'table' ? i.html : '' })));
    const f = facts[0];
    expect(f?.kind).toBe('correlation');
    if (f?.kind !== 'correlation') return;
    expect(f.count).toBe(3);
    const hs = f.pairs.find((p) => p.a === label('hours') && p.b === label('stress'))!;
    printed(hs.r, PAIRWISE['hours-stress'][2]);
    expect(hs.n).toBe(120);
  });
});
