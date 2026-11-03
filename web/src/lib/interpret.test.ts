/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import fixtures from '../features/output/fixtures/tables.json';
import { interpret, cohensD, sizeV, type Fact } from './interpret';
import { parsePivot, parseNumber } from './pivot';
import { fmt, fmtP, formatTableHtml, APA_CS, APA_EN } from './statfmt';
import { describeFact } from '../features/output/interpretText';
import cs from '../i18n/cs.json';
import en from '../i18n/en.json';
import csFrag from '../i18n/fragments/analysis.cs.json';
import enFrag from '../i18n/fragments/analysis.en.json';

type Fx = Record<string, { syntax: string; tables: { title: string; html: string }[] }>;
const F = fixtures as unknown as { en: Fx; cs: Fx };
const COMMAND: Record<string, string> = {
  ttestIndependent: 'T-TEST',
  ttestPaired: 'T-TEST',
  ttestOneSample: 'T-TEST',
  oneway: 'ONEWAY',
  correlations: 'CORRELATIONS',
  crosstabs: 'CROSSTABS',
  regression: 'REGRESSION',
  frequencies: 'FREQUENCIES',
  descriptives: 'DESCRIPTIVES',
  mannWhitney: 'NPAR TESTS',
  kruskalWallis: 'NPAR TESTS',
  wilcoxon: 'NPAR TESTS',
  chisquare: 'NPAR TESTS',
  reliability: 'RELIABILITY',
};
const run = (lang: 'en' | 'cs', k: string) => interpret(COMMAND[k], F[lang][k].tables);
const one = <K extends Fact['kind']>(facts: Fact[], kind: K) => {
  const f = facts.find((x) => x.kind === kind);
  expect(f, kind).toBeTruthy();
  return f as Extract<Fact, { kind: K }>;
};

describe('pivot parsing', () => {
  it('parses numbers in both decimal conventions', () => {
    expect(parseNumber('.414')).toBe(0.414);
    expect(parseNumber(',414')).toBe(0.414);
    expect(parseNumber('-,09')).toBe(-0.09);
    expect(parseNumber('113,00')).toBe(113);
    expect(parseNumber('100.0%')).toBe(100);
    expect(parseNumber('1.2E-5')).toBe(0.000012);
    expect(parseNumber('Female')).toBeNull();
  });
  it('expands row and column spans', () => {
    const t = parsePivot(F.en.ttestIndependent.tables[1].html);
    expect(t.caption).toBe('Independent Samples Test');
    const widths = new Set(t.rows.map((r) => r.length));
    expect(widths.size).toBe(1);
    expect(t.rows[4][0].text).toBe('Grade point average');
  });
});

describe('interpretation facts (same in English and Czech output)', () => {
  for (const lang of ['en', 'cs'] as const) {
    it(`independent t-test (${lang})`, () => {
      const f = one(run(lang, 'ttestIndependent'), 'ttestInd');
      expect(f.groups.map((g) => g.n)).toEqual([67, 48]);
      expect(f.t).toBeCloseTo(0.82);
      expect(f.df).toBe(113);
      expect(f.p).toBeCloseTo(0.414);
      expect(f.welch).toBe(false);
      expect(f.d).toBeCloseTo(0.163, 2);
      expect(f.size).toBe('negligible');
    });
    it(`paired and one-sample t-test (${lang})`, () => {
      const p = one(run(lang, 'ttestPaired'), 'ttestPaired');
      expect(p.t).toBeCloseTo(6.98);
      expect(p.df).toBe(59);
      expect(p.d).toBeCloseTo(7.18 / 7.97, 2);
      expect(p.size).toBe('large');
      const o = one(run(lang, 'ttestOneSample'), 'ttestOne');
      expect(o.testValue).toBe(7);
      expect(o.p).toBeCloseTo(0.021);
      expect(o.mean).toBeCloseTo(6.77);
    });
    it(`oneway ANOVA with η² (${lang})`, () => {
      const f = one(run(lang, 'oneway'), 'anova');
      expect(f.F).toBeCloseTo(1.57);
      expect(f.df1).toBe(4);
      expect(f.df2).toBe(115);
      expect(f.eta2).toBeCloseTo(220.94 / 4256.79, 4);
      expect(f.groups).toHaveLength(5);
      expect(f.leveneP).toBeCloseTo(0.343);
    });
    it(`correlations (${lang})`, () => {
      const f = one(run(lang, 'correlations'), 'correlation');
      expect(f.count).toBe(6);
      expect(f.pairs[0].r).toBeCloseTo(0.458);
      expect(f.pairs[0].n).toBe(120);
    });
    it(`crosstabs χ² with Cramér's V (${lang})`, () => {
      const f = one(run(lang, 'crosstabs'), 'crosstab');
      expect(f.chi2).toBeCloseTo(1.6);
      expect(f.df).toBe(2);
      expect(f.n).toBe(120);
      expect(f.v).toBeCloseTo(0.115, 2);
    });
    it(`regression (${lang})`, () => {
      const f = one(run(lang, 'regression'), 'regression');
      expect(f.r2).toBeCloseTo(0.1);
      expect(f.F).toBeCloseTo(4.28);
      expect(f.df2).toBe(110);
      expect(f.predictors).toHaveLength(3);
      expect(f.predictors[0].p).toBeCloseTo(0.001);
      expect(f.dependent).toBe('Grade point average');
    });
    it(`frequencies and descriptives (${lang})`, () => {
      const fr = run(lang, 'frequencies').filter((x) => x.kind === 'frequency');
      expect(fr).toHaveLength(2);
      expect(fr[0].kind === 'frequency' && fr[0].top).toBe('Science');
      expect(fr[1].kind === 'frequency' && fr[1].missing).toBe(2);
      const d = run(lang, 'descriptives');
      expect(d).toHaveLength(4);
    });
    it(`nonparametric tests (${lang})`, () => {
      const mw = one(run(lang, 'mannWhitney'), 'mannWhitney');
      expect(mw.U).toBeCloseTo(1507.5);
      expect(mw.r).toBeCloseTo(0.57 / Math.sqrt(115), 3);
      const kw = one(run(lang, 'kruskalWallis'), 'kruskal');
      expect(kw.H).toBeCloseTo(6.23);
      expect(kw.groups).toHaveLength(5);
      const wx = one(run(lang, 'wilcoxon'), 'wilcoxon');
      expect(wx.z).toBeCloseTo(-5.23);
      expect(wx.pos).toBe(48);
      const ch = one(run(lang, 'chisquare'), 'chisqOne');
      expect(ch.chi2).toBeCloseTo(11.42);
      expect(ch.over).toBe('Science');
      expect(ch.under).toBe('Law');
    });
    it(`reliability (${lang})`, () => {
      const f = one(run(lang, 'reliability'), 'reliability');
      expect(f.alpha).toBeCloseTo(0.92);
      expect(f.quality).toBe('excellent');
    });
  }
});

describe('effect sizes', () => {
  it("computes Cohen's d with a CI", () => {
    const { d, ci } = cohensD({ label: 'a', n: 20, mean: 10, sd: 2 }, { label: 'b', n: 20, mean: 9, sd: 2 });
    expect(d).toBeCloseTo(0.5);
    expect(ci[0]).toBeLessThan(0.5);
    expect(ci[1]).toBeGreaterThan(0.5);
  });
  it('labels Cramér V by df', () => {
    expect(sizeV(0.12, 1)).toBe('small');
    expect(sizeV(0.3, 1)).toBe('medium');
  });
});

describe('number formatting', () => {
  it('APA English drops the leading zero for bounded statistics', () => {
    expect(fmt(0.414, 3, APA_EN, true)).toBe('.414');
    expect(fmt(0.82, 2, APA_EN)).toBe('0.82');
    expect(fmtP(0.0004, APA_EN)).toBe('p < .001');
    expect(fmtP(0.414, APA_CS)).toBe('p = 0,414');
    expect(fmt(-0.09, 2, APA_CS)).toBe('−0,09');
  });
  it('post-processes table HTML (leading zeros, p < .001)', () => {
    const html = F.en.ttestPaired.tables[2].html;
    const out = formatTableHtml(html, 'apa');
    expect(out).toContain('&lt;.001');
    expect(out).toContain('>7.18<');
    const corr = formatTableHtml(F.en.ttestPaired.tables[1].html, 'apa');
    expect(corr).toContain('>.797<'); // correlation stays without zero
    const always = formatTableHtml(F.cs.ttestIndependent.tables[1].html, 'always');
    expect(always).toContain('>0.414<');
    expect(formatTableHtml(F.en.ttestIndependent.tables[1].html, 'apa')).toContain('>0.82<');
  });
});

describe('interpretation text', () => {
  const make = (lang: 'cs' | 'en') => {
    const inst = i18next.createInstance();
    void inst.init({ lng: lang, resources: { [lang]: { translation: { ...(lang === 'cs' ? cs : en), ...(lang === 'cs' ? csFrag : enFrag) } } }, interpolation: { escapeValue: false } });
    return inst.t;
  };
  it('writes a Czech sentence for the t-test', () => {
    const f = run('cs', 'ttestIndependent');
    const txt = describeFact(f[0], make('cs'), { style: APA_CS });
    expect(txt.headline).toContain('statisticky významně neliší');
    expect(txt.headline).toContain('t(113) = 0,82; p = 0,414');
    expect(txt.report).toBe('t(113) = 0,82; p = 0,414; d = 0,16');
    expect(txt.caveat).toMatch(/nevýznamný/);
  });
  it('writes an English APA sentence', () => {
    const f = run('en', 'ttestIndependent');
    const txt = describeFact(f[0], make('en'), { style: APA_EN });
    expect(txt.report).toBe('t(113) = 0.82, p = .414, d = 0.16');
  });
  it('describes every fixture without throwing', () => {
    for (const k of Object.keys(COMMAND)) for (const fact of run('cs', k)) expect(describeFact(fact, make('cs'), { style: APA_CS }).headline).not.toMatch(/interpret\./);
    for (const k of Object.keys(COMMAND)) for (const fact of run('en', k)) expect(describeFact(fact, make('en'), { style: APA_EN }).headline).not.toMatch(/interpret\./);
  });
});

describe('APA copy', () => {
  it('builds an APA table in English', async () => {
    const { toApa } = await import('./apa');
    const r = toApa(F.en.ttestIndependent.tables[1].html, { locale: 'en', number: 2 });
    expect(r.html).toContain('Table 2');
    expect(r.html).toContain('font-style:italic">Independent Samples Test');
    expect(r.html).not.toMatch(/border-left|border-right/);
    expect(r.text).toContain('.414');
    expect(r.text).toContain('0.82');
    expect(r.text).toContain('113');
  });
  it('uses decimal commas and leading zeros in Czech', async () => {
    const { toApa } = await import('./apa');
    const r = toApa(F.cs.ttestPaired.tables[2].html, { locale: 'cs' });
    expect(r.text).toContain('Tabulka 1');
    expect(r.text).toContain('< 0,001');
    expect(r.text).toContain('7,18');
  });
});

describe('APA copy regressions', () => {
  it('does not treat Czech words starting with P as p values', async () => {
    const { toApa } = await import('./apa');
    const r = toApa(F.cs.ttestIndependent.tables[1].html, { locale: 'cs' });
    const row = r.text.split('\n').find((l) => l.includes('Předpokládá'))!;
    expect(row).toContain('2,15');
    expect(row).toContain('−0,09');
    expect(row).not.toContain('< 0,001');
  });
});
