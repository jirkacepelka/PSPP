/*
 * KM (Kaplan–Meier) against independent reference values.
 *
 * Survival estimates, Greenwood SEs and the log rank / Breslow / Tarone–Ware tests come from
 * statsmodels (SurvfuncRight, survdiff with weight_type None / 'gb' / 'tw'). statsmodels has no
 * restricted mean and uses other conventions for the median (strict S < .5, Brookmeyer–Crowley
 * CI), so the SPSS formulas (restricted mean with the m/(m−1) variance factor, median = first
 * time with S ≤ .5, SE(median) = SE(S(t50)) / f̂ with f̂ from the times where S crosses .55 and
 * .45 – Collett 1994 – and estimate ± 1.96·SE) are checked against a separate Python
 * implementation written from the SPSS algorithm description:
 *
 * ```python
 * import numpy as np
 * from statsmodels.duration.survfunc import SurvfuncRight, survdiff
 * mp_t = [6,6,6,6,7,9,10,10,11,13,16,17,19,20,22,23,25,32,32,34,35]
 * mp_s = [1,1,1,0,1,0,1,0,0,1,1,0,0,0,1,1,0,0,0,0,0]
 * pl_t = [1,1,2,2,3,4,4,5,5,8,8,8,8,11,11,12,12,15,17,22,23]; pl_s = [1]*21
 * tie_t = [1,2,2,2,3,4,4,5,6,6,7,8]; tie_s = [1,1,1,0,0,1,0,1,1,0,1,0]
 * def spss(t, s):
 *     t = np.asarray(t, float); s = np.asarray(s, int)
 *     S = 1.0; g = 0.0; steps = []
 *     for u in np.unique(t[s == 1]):
 *         n = np.sum(t >= u); d = np.sum((t == u) & (s == 1))
 *         S *= 1 - d / n
 *         if n > d: g += d / (n * (n - d))
 *         steps.append((u, n, d, S, S * np.sqrt(g) if S > 0 else 0.0))
 *     knots = [0.0] + [x[0] for x in steps] + [t.max()]; Ss = [1.0] + [x[3] for x in steps]
 *     mean = sum(Ss[i] * (knots[i + 1] - knots[i]) for i in range(len(Ss)))
 *     m = s.sum(); tot = 0.0
 *     for i, (u, n, d, Si, _) in enumerate(steps):
 *         A = sum(Ss[j + 1] * (knots[j + 2] - knots[j + 1]) for j in range(i, len(steps)))
 *         if n > d: tot += A * A * d / (n * (n - d))
 *     se_mean = 0.0 if tot == 0 else np.sqrt(m / (m - 1) * tot)
 *     def pct(q):                       # q = target survival proportion
 *         hit = [x for x in steps if x[3] <= q + 1e-10]
 *         if not hit: return (np.nan, np.nan)
 *         uu = ([(0.0, 1.0)] + [(x[0], x[3]) for x in steps if x[3] >= q + 0.05 - 1e-10])[-1]
 *         ll = [x for x in steps if x[3] <= q - 0.05 + 1e-10]
 *         if not ll: return (hit[0][0], np.nan)
 *         return (hit[0][0], hit[0][4] / ((uu[1] - ll[0][3]) / (ll[0][0] - uu[0])))
 *     return dict(steps=steps, mean=mean, se_mean=se_mean, median=pct(.5), q25=pct(.75), q75=pct(.25))
 * sf = SurvfuncRight(np.asarray(mp_t, float), np.asarray(mp_s)); sf.surv_prob, sf.surv_prob_se
 * for wt in (None, 'gb', 'tw'): survdiff(np.asarray(mp_t + pl_t, float), np.asarray(mp_s + pl_s), np.asarray([1]*21 + [2]*21), weight_type=wt)
 * # 3 groups (6-MP, placebo, ties), pairs, and strata = case index % 2 within Gehan: survdiff(..., strata=...)
 * ```
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, OutputItem, Variable } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { dataRows, type PivotTable } from '../../lib/pivot';
import { errorsOf, flatItems, runExt, tables } from '../testing';
import { kmFit, kmPercentile, kmTest, type Obs } from './km';
import cs from '../../i18n/fragments/ext-km.cs.json';
import en from '../../i18n/fragments/ext-km.en.json';

const MP_T = [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35];
const MP_S = [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];
const PL_T = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
const PL_S = new Array(21).fill(1);
const TIE_T = [1, 2, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8];
const TIE_S = [1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0];

const obs = (t: number[], s: number[], w?: number[]): Obs[] => t.map((x, i) => ({ t: x, event: s[i] === 1, w: w?.[i] ?? 1 }));

function dataset(cols: Record<string, (number | null)[]>, vars: Partial<Record<string, Partial<Variable>>> = {}, extra: Partial<Dataset> = {}): Dataset {
  const names = Object.keys(cols);
  return {
    name: 't',
    variables: names.map((n) => makeVariable(n, { print: { type: 'F', w: 8, d: 0 }, ...vars[n] })),
    columns: names.map((n) => cols[n]),
    ...extra,
  };
}

const gehan = () =>
  dataset(
    { weeks: [...MP_T, ...PL_T], relapse: [...MP_S, ...PL_S], drug: [...new Array(21).fill(1), ...new Array(21).fill(2)] },
    { drug: { label: 'Treatment', valueLabels: [{ value: 1, label: '6-MP' }, { value: 2, label: 'Placebo' }] }, weeks: { label: 'Weeks' } },
  );

const byCaption = (items: OutputItem[], caption: string): PivotTable => {
  const t = tables(items).find((x) => x.caption === caption);
  if (!t) throw new Error(`no table ${caption}: ${tables(items).map((x) => x.caption).join(', ')}`);
  return t;
};
/** Data row whose stub contains all LABELS, as numbers (td cells). */
const row = (t: PivotTable, ...labels: string[]) => {
  const r = t.rows.find((x) => x.some((c) => !c.header) && labels.every((l) => x.some((c) => c.header && c.text === l)));
  if (!r) throw new Error(`no row ${labels.join('/')} in ${t.caption}`);
  return r.filter((c) => !c.header).map((c) => c.num);
};

describe('KM maths', () => {
  it('Gehan 6-MP: product limit and Greenwood SE match statsmodels', () => {
    const f = kmFit(obs(MP_T, MP_S));
    expect(f.steps.map((s) => s.t)).toEqual([6, 7, 10, 13, 16, 22, 23]);
    const S = [0.857143, 0.806723, 0.752941, 0.690196, 0.627451, 0.537815, 0.448179];
    const SE = [0.07636, 0.086935, 0.09635, 0.106815, 0.114054, 0.128234, 0.134591];
    f.steps.forEach((s, i) => {
      expect(s.s).toBeCloseTo(S[i], 6);
      expect(s.se).toBeCloseTo(SE[i], 6);
    });
    expect([f.total, f.events, f.censored]).toEqual([21, 9, 12]);
  });

  it('Gehan 6-MP: SPSS restricted mean, median and quartiles', () => {
    const f = kmFit(obs(MP_T, MP_S));
    expect(f.mean).toBeCloseTo(23.287395, 6);
    expect(f.meanSe).toBeCloseTo(2.998982, 6);
    expect(kmPercentile(f, 50)).toEqual({ est: 23, se: expect.closeTo(5.255376, 6) });
    expect(kmPercentile(f, 25)).toEqual({ est: 13, se: expect.closeTo(5.49993, 5) });
    expect(kmPercentile(f, 75)).toEqual({ est: null, se: null }); // S never reaches .25
  });

  it('Gehan placebo (no censoring, curve reaches 0)', () => {
    const f = kmFit(obs(PL_T, PL_S));
    const S = [0.904762, 0.809524, 0.761905, 0.666667, 0.571429, 0.380952, 0.285714, 0.190476, 0.142857, 0.095238, 0.047619, 0];
    const SE = [0.064056, 0.085689, 0.092943, 0.102869, 0.10799, 0.105971, 0.098581, 0.085689, 0.07636, 0.064056, 0.046471, 0];
    f.steps.forEach((s, i) => {
      expect(s.s).toBeCloseTo(S[i], 6);
      expect(s.se).toBeCloseTo(SE[i], 6);
    });
    expect(f.mean).toBeCloseTo(8.666667, 6);
    expect(f.meanSe).toBeCloseTo(1.411405, 6);
    expect(kmPercentile(f, 50).est).toBe(8);
    expect(kmPercentile(f, 50).se).toBeCloseTo(1.669046, 6);
    expect(kmPercentile(f, 25).se).toBeCloseTo(1.440165, 6);
    expect(kmPercentile(f, 75)).toEqual({ est: 12, se: expect.closeTo(1.799471, 6) });
  });

  it('ties of events and censorings at the same time (events first)', () => {
    const f = kmFit(obs(TIE_T, TIE_S));
    const S = [0.916667, 0.75, 0.642857, 0.514286, 0.385714, 0.192857];
    const SE = [0.079786, 0.125, 0.146011, 0.163917, 0.165866, 0.159608];
    f.steps.forEach((s, i) => {
      expect(s.s).toBeCloseTo(S[i], 6);
      expect(s.se).toBeCloseTo(SE[i], 6);
    });
    expect(f.mean).toBeCloseTo(5.152381, 6);
    expect(f.meanSe).toBeCloseTo(0.778945, 6);
    expect(kmPercentile(f, 50)).toEqual({ est: 6, se: expect.closeTo(1.290072, 6) });
    // survival table: the estimate is on the last event row of a time, censored rows are blank
    const t2 = f.rows.filter((r) => r.t === 2);
    expect(t2.map((r) => [r.event, r.est !== null, r.cumEvents, r.remaining])).toEqual([
      [true, false, 2, 10],
      [true, true, 3, 9],
      [false, false, 3, 8],
    ]);
  });

  it('S exactly .5: SPSS median is the first time with S ≤ .5 (statsmodels/SAS: S < .5 → 3)', () => {
    const f = kmFit(obs([1, 2, 3, 4], [1, 1, 1, 1]));
    expect(kmPercentile(f, 50)).toEqual({ est: 2, se: 1 });
    expect(f.mean).toBeCloseTo(2.5, 10);
    expect(f.meanSe).toBeCloseTo(0.645497, 6);
  });

  it('all censored: S = 1, no median, mean = largest time', () => {
    const f = kmFit(obs([3, 5, 8], [0, 0, 0]));
    expect(f.steps).toEqual([]);
    expect(f.mean).toBe(8);
    expect(f.meanSe).toBe(0);
    expect(kmPercentile(f, 50)).toEqual({ est: null, se: null });
  });

  it('frequency weights equal replicated cases', () => {
    const t = [2, 3, 3, 5, 7, 9];
    const s = [1, 0, 1, 1, 0, 1];
    const w = [2, 1, 3, 1, 2, 1];
    const a = kmFit(obs(t, s, w));
    const b = kmFit(obs(t.flatMap((x, i) => new Array(w[i]).fill(x)), s.flatMap((x, i) => new Array(w[i]).fill(x))));
    expect(a.steps).toEqual(b.steps.map((x) => expect.objectContaining({ t: x.t, n: x.n, d: x.d, s: expect.closeTo(x.s, 12), se: expect.closeTo(x.se, 12) })));
    expect(a.mean).toBeCloseTo(b.mean!, 12);
    expect(a.meanSe).toBeCloseTo(b.meanSe!, 12);
  });

  it('log rank, Breslow and Tarone–Ware match statsmodels survdiff', () => {
    const two = [obs(MP_T, MP_S), obs(PL_T, PL_S)];
    expect(kmTest([two], 'LOGRANK')).toEqual({ chi: expect.closeTo(16.792941, 5), df: 1, p: expect.closeTo(4.16881e-5, 9) });
    expect(kmTest([two], 'BRESLOW')!.chi).toBeCloseTo(13.457852, 5);
    expect(kmTest([two], 'TARONE')!.chi).toBeCloseTo(15.123575, 5);
    const three = [obs(MP_T, MP_S), obs(PL_T, PL_S), obs(TIE_T, TIE_S)];
    expect(kmTest([three], 'LOGRANK')).toEqual({ chi: expect.closeTo(20.480908, 5), df: 2, p: expect.closeTo(3.56966e-5, 9) });
    expect(kmTest([three], 'BRESLOW')!.chi).toBeCloseTo(15.779933, 5);
    expect(kmTest([three], 'TARONE')!.chi).toBeCloseTo(18.031531, 5);
    // stratified (strata = case index mod 2 within each group's concatenation)
    const all = obs([...MP_T, ...PL_T], [...MP_S, ...PL_S]);
    const strata = [0, 1].map((k) => [all.filter((_, i) => i < 21 && i % 2 === k), all.filter((_, i) => i >= 21 && i % 2 === k)]);
    expect(kmTest(strata, 'LOGRANK')!.chi).toBeCloseTo(16.130438, 5);
    expect(kmTest(strata, 'BRESLOW')!.chi).toBeCloseTo(13.12722, 5);
    expect(kmTest(strata, 'TARONE')!.chi).toBeCloseTo(14.708241, 5);
    expect(kmTest([[obs(MP_T, MP_S)]], 'LOGRANK')).toBeNull(); // one group
  });
});

describe('KM command', () => {
  it('Gehan: SPSS tables', () => {
    const out = runExt('KM weeks BY drug /STATUS=relapse(1) /PRINT=TABLE MEAN /PERCENTILES /TEST=LOGRANK BRESLOW TARONE /COMPARE=OVERALL POOLED.', gehan());
    expect(errorsOf(out)).toEqual([]);
    const cps = byCaption(out, 'Case Processing Summary');
    expect(row(cps, '6-MP')).toEqual([21, 9, 12, 57.1]);
    expect(row(cps, 'Placebo')).toEqual([21, 21, 0, 0]);
    expect(row(cps, 'Overall')).toEqual([42, 30, 12, 28.6]);

    const st = byCaption(out, 'Survival Table');
    const mp = dataRows(st).filter((r) => r.some((c) => c.header && c.text === '6-MP'));
    expect(mp).toHaveLength(21);
    // row 3 (third tied event at 6): estimate .857, SE .076; row 4 censored at 6: blank
    expect(mp[2].filter((c) => !c.header).map((c) => c.text)).toEqual(['6', '1', '.857', '.076', '3', '18']);
    expect(mp[3].filter((c) => !c.header).map((c) => c.text)).toEqual(['6', '0', '', '', '3', '17']);

    const mm = byCaption(out, 'Means and Medians for Survival Time');
    expect(row(mm, '6-MP')).toEqual([23.287, 2.999, 17.409, 29.165, 23, 5.255, 12.7, 33.3]);
    expect(row(mm, 'Placebo')).toEqual([8.667, 1.411, 5.9, 11.433, 8, 1.669, 4.729, 11.271]);
    expect(row(mm, 'Overall')).toEqual([15.339, 1.892, 11.631, 19.048, 12, 1.717, 8.636, 15.364]);
    expect(mm.footnotes).toHaveLength(1);

    const pc = byCaption(out, 'Percentiles');
    // columns 25% (S ≤ .25), 50%, 75% (S ≤ .75): Estimate, Std. Error
    expect(row(pc, 'Placebo')).toEqual([12, 1.799, 8, 1.669, 4, 1.44]);
    expect(row(pc, '6-MP')).toEqual([null, null, 23, 5.255, 13, 5.5]);

    const oc = byCaption(out, 'Overall Comparisons');
    expect(row(oc, 'Log Rank (Mantel-Cox)')).toEqual([16.793, 1, 0]);
    expect(row(oc, 'Breslow (Generalized Wilcoxon)')).toEqual([13.458, 1, 0]);
    expect(row(oc, 'Tarone-Ware')).toEqual([15.124, 1, 0]);
    expect(oc.footnotes[0]).toContain('Treatment');
  });

  it('pairwise comparisons over three levels', () => {
    const ds = dataset({
      t: [...MP_T, ...PL_T, ...TIE_T],
      s: [...MP_S, ...PL_S, ...TIE_S],
      g: [...new Array(21).fill(1), ...new Array(21).fill(2), ...new Array(12).fill(3)],
    });
    const out = runExt('KM t BY g /STATUS=s(1) /PRINT=NONE /TEST=LOGRANK /COMPARE=PAIRWISE.', ds);
    const pw = byCaption(out, 'Pairwise Comparisons');
    expect(row(pw, '1')).toEqual([null, null, 16.793, 0, 13.066, 0]);
    expect(row(pw, '3')[2]).toBeCloseTo(0.891, 3);
    expect(row(pw, '3')[3]).toBeCloseTo(0.345, 3);
    expect(tables(out).map((t) => t.caption)).toEqual(['Case Processing Summary', 'Pairwise Comparisons']);
  });

  it('strata: pooled (stratified) test and per-stratum tests', () => {
    const ds = gehan();
    ds.variables.push(makeVariable('half'));
    ds.columns.push(Array.from({ length: 42 }, (_, i) => i % 2));
    const pooled = runExt('KM weeks BY drug /STRATA=half /STATUS=relapse(1) /PRINT=MEAN /TEST=LOGRANK.', ds);
    expect(row(byCaption(pooled, 'Overall Comparisons'), 'Log Rank (Mantel-Cox)')[0]).toBeCloseTo(16.13, 3);
    const cps = byCaption(pooled, 'Case Processing Summary');
    expect(row(cps, '0', 'Overall')).toEqual([21, 16, 5, 23.8]);
    expect(dataRows(cps).at(-1)!.filter((c) => !c.header).map((c) => c.num)).toEqual([42, 30, 12, 28.6]);
    const per = runExt('KM weeks BY drug /STRATA=half /STATUS=relapse(1) /PRINT=NONE /TEST=LOGRANK BRESLOW /COMPARE=OVERALL STRATA.', ds);
    const oc = byCaption(per, 'Overall Comparisons');
    expect(row(oc, '0', 'Log Rank (Mantel-Cox)')[0]).toBeCloseTo(6.031, 3);
    expect(row(oc, '1', 'Breslow (Generalized Wilcoxon)')[0]).toBeCloseTo(8.894, 3);
  });

  it('status range, user-missing and system-missing values, negative times', () => {
    const ds = dataset(
      { t: [1, 2, 3, 4, null, 6, 7, -1], s: [2, 3, 0, 9, 1, 1, null, 1] },
      { s: { missing: { values: [9] } } },
    );
    const out = runExt('KM t /STATUS=s(1 THRU 3).', ds);
    expect(row(byCaption(out, 'Case Processing Summary'), 'Overall')).toEqual([4, 3, 1, 25]);
    expect(flatItems(out).some((i) => i.kind === 'message' && i.severity === 'warning' && /negative/.test(i.text))).toBe(true);
    // value list form and EVENT keyword
    const out2 = runExt('KM t /STATUS=s EVENT(2, 3).', ds);
    expect(row(byCaption(out2, 'Case Processing Summary'), 'Overall')).toEqual([4, 2, 2, 50]);
  });

  it('WEIGHT, FILTER and SPLIT FILE', () => {
    const base = { t: [2, 3, 5, 7, 9, 4], s: [1, 0, 1, 0, 1, 1], w: [2, 1, 3, 1, 1, 0], f: [1, 1, 1, 1, 1, 0], g: [1, 1, 1, 2, 2, 2] };
    const weighted = runExt('KM t /STATUS=s(1).', dataset(base, {}, { weight: 'w' }));
    expect(row(byCaption(weighted, 'Case Processing Summary'), 'Overall')).toEqual([8, 6, 2, 25]);
    const expanded = kmFit(obs([2, 2, 3, 5, 5, 5, 7, 9], [1, 1, 0, 1, 1, 1, 0, 1]));
    expect(row(byCaption(weighted, 'Means and Medians for Survival Time'), 'Overall')[0]).toBeCloseTo(expanded.mean!, 3);

    const filtered = runExt('KM t /STATUS=s(1).', dataset(base, {}, { filter: 'f' }));
    expect(row(byCaption(filtered, 'Case Processing Summary'), 'Overall')).toEqual([5, 3, 2, 40]);

    const split = runExt('KM t /STATUS=s(1).', dataset(base, {}, { split: ['g'] }));
    const cpss = tables(split).filter((t) => t.caption === 'Case Processing Summary');
    expect(cpss.map((t) => row(t, 'Overall'))).toEqual([
      [3, 2, 1, 33.3],
      [3, 2, 1, 33.3],
    ]);
    expect(flatItems(split).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toEqual(['g = 1', 'g = 2']);
  });

  it('factor with one level: tests not computed, warning', () => {
    const ds = dataset({ t: [1, 2, 3], s: [1, 1, 0], g: [5, 5, 5] });
    const out = runExt('KM t BY g /STATUS=s(1) /TEST=LOGRANK.', ds);
    expect(row(byCaption(out, 'Overall Comparisons'), 'Log Rank (Mantel-Cox)')).toEqual([null, null, null]);
    expect(flatItems(out).some((i) => i.kind === 'message' && i.severity === 'warning')).toBe(true);
  });

  it('survival plot spec with censor marks; SAVE warns', () => {
    const out = runExt('KM weeks BY drug /STATUS=relapse(1) /PRINT=NONE /PLOT=SURVIVAL HAZARD /SAVE=SURVIVAL.', gehan());
    const charts = flatItems(out).filter((i) => i.kind === 'chart') as { chart: { type: string; kind: string; curves: { name: string; points: number[][]; censored: number[][]; end: number | null }[] } }[];
    expect(charts.map((c) => c.chart.kind)).toEqual(['survival', 'hazard']);
    const [mp, pl] = charts[0].chart.curves;
    expect(mp.name).toBe('6-MP');
    expect(mp.points[0]).toEqual([0, 1]);
    expect(mp.points[1][0]).toBe(6);
    expect(mp.points[1][1]).toBeCloseTo(0.857143, 6);
    expect(mp.censored).toHaveLength(12);
    expect(mp.end).toBe(35);
    expect(pl.points.at(-1)).toEqual([23, 0]);
    // cumulative hazard stops before S = 0
    expect(charts[1].chart.curves[1].points.at(-1)![1]).toBeCloseTo(-Math.log(0.047619), 5);
    expect(charts[1].chart.curves[1].end).toBeNull();
    expect(flatItems(out).some((i) => i.kind === 'message' && i.severity === 'warning' && /SAVE/.test(i.text))).toBe(true);
  });

  it('errors and Czech output', () => {
    expect(errorsOf(runExt('KM weeks BY drug.', gehan()))[0]).toMatch(/STATUS/);
    expect(errorsOf(runExt('KM weeks /STATUS=relapse.', gehan()))).toHaveLength(1);
    expect(errorsOf(runExt('KM weeks /STATUS=relapse(1) /FOO=1.', gehan()))).toHaveLength(1);
    const out = runExt('KM weeks BY drug /STATUS=relapse(1) /PRINT=MEAN.', gehan(), 'cs', ',');
    const mm = byCaption(out, 'Průměry a mediány doby přežití');
    expect(dataRows(mm)[0].filter((c) => !c.header)[0].text).toBe('23,287');
  });

  it('fragments have identical keys', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
    expect(keys(cs)).toEqual(keys(en));
  });
});
