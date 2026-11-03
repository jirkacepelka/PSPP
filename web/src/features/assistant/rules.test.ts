/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { recommend, SLOTS, GOALS, type VarInfo } from './rules';
import { SPECS_BY_ID } from '../dialogs/specs';
import cs from '../../i18n/fragments/analysis.cs.json';

const v = (name: string, measure: VarInfo['measure'], distinct = 50, type: VarInfo['type'] = 'numeric'): VarInfo => ({ name, measure, type, distinct });
const gpa = v('gpa', 'scale');
const stress = v('stress', 'scale');
const satisf = v('satisf', 'ordinal', 5);
const gender2 = v('gender', 'nominal', 2);
const faculty = v('faculty', 'nominal', 5);
const job = v('job', 'nominal', 2);

describe('assistant decision table', () => {
  it('describe: categorical → Frequencies, scale → Explore, mixed → both', () => {
    expect(recommend('describe', { vars: [faculty] })?.primary.specId).toBe('frequencies');
    expect(recommend('describe', { vars: [gpa] })?.primary.specId).toBe('explore');
    const mixed = recommend('describe', { vars: [faculty, gpa] });
    expect(mixed?.primary.preset.variables).toEqual(['faculty']);
    expect(mixed?.also?.preset.dependents).toEqual(['gpa']);
  });
  it('compare groups: 2 groups → t-test (alt Mann-Whitney), ≥3 → ANOVA (alt Kruskal-Wallis)', () => {
    const r2 = recommend('compare', { outcome: [gpa], group: [gender2] });
    expect(r2?.primary.specId).toBe('ttestIndependent');
    expect(r2?.primary.preset).toEqual({ variables: ['gpa'], group: ['gender'] });
    expect(r2?.alternative?.specId).toBe('mannWhitney');
    const r5 = recommend('compare', { outcome: [stress], group: [faculty] });
    expect(r5?.primary.specId).toBe('oneway');
    expect(r5?.alternative?.specId).toBe('kruskalWallis');
    expect(r5?.reason.args?.k).toBe(5);
  });
  it('leaves out tiny groups (e.g. 3 × "other")', () => {
    const r = recommend('compare', { outcome: [gpa], group: [{ ...gender2, distinct: 3, major: 2 }] });
    expect(r?.primary.specId).toBe('ttestIndependent');
    expect(r?.warning).toBe('assistant.warn.tinyGroups');
  });
  it('compare groups: ordinal outcome → rank tests; nominal outcome → crosstabs', () => {
    expect(recommend('compare', { outcome: [satisf], group: [gender2] })?.primary.specId).toBe('mannWhitney');
    expect(recommend('compare', { outcome: [satisf], group: [faculty] })?.primary.specId).toBe('kruskalWallis');
    const ct = recommend('compare', { outcome: [job], group: [gender2] });
    expect(ct?.primary.specId).toBe('crosstabs');
    expect(ct?.primary.preset.st_CHISQ).toBe(true);
  });
  it('same people: 2 → paired t (alt Wilcoxon), ≥3 → Friedman', () => {
    const p = recommend('paired', { measures: [gpa, stress] });
    expect(p?.primary.specId).toBe('ttestPaired');
    expect(p?.alternative?.specId).toBe('wilcoxon');
    expect(recommend('paired', { measures: [gpa, stress, v('x', 'scale')] })?.primary.specId).toBe('friedman');
  });
  it('relationship: scale×scale → Pearson, ordinal → Spearman, nominal → crosstabs or group comparison', () => {
    expect(recommend('relate', { vars: [gpa, stress] })?.primary.preset.method).toBe('PEARSON');
    expect(recommend('relate', { vars: [gpa, satisf] })?.primary.preset.method).toBe('SPEARMAN');
    expect(recommend('relate', { vars: [job, faculty] })?.primary.specId).toBe('crosstabs');
    expect(recommend('relate', { vars: [gpa, gender2] })?.primary.specId).toBe('ttestIndependent');
  });
  it('predict: scale → linear regression, binary → logistic', () => {
    expect(recommend('predict', { outcome: [gpa], predictors: [stress] })?.primary.specId).toBe('regressionLinear');
    const l = recommend('predict', { outcome: [job], predictors: [gpa, faculty] });
    expect(l?.primary.specId).toBe('logistic');
    expect(l?.primary.preset.categorical).toEqual(['faculty']);
  });
  it('reliability, distribution and test value', () => {
    expect(recommend('reliability', { items: [satisf, satisf, satisf] })?.primary.specId).toBe('reliability');
    expect(recommend('reliability', { items: [satisf, satisf] })?.warning).toBeTruthy();
    expect(recommend('distribution', { vars: [gpa] })?.alternative?.specId).toBe('ksNormal');
    expect(recommend('testValue', { vars: [gpa] }, { testValue: 3 })?.primary.preset.testValue).toBe(3);
  });
  it('waits until slots are filled', () => {
    expect(recommend('compare', { outcome: [gpa] })).toBeNull();
    expect(recommend('paired', { measures: [gpa] })).toBeNull();
  });
  it('recommends only existing dialogs and fields, with translated texts', () => {
    const all = [
      recommend('describe', { vars: [faculty, gpa] }),
      recommend('compare', { outcome: [gpa], group: [gender2] }),
      recommend('compare', { outcome: [stress], group: [faculty] }),
      recommend('paired', { measures: [gpa, stress] }),
      recommend('paired', { measures: [gpa, stress, gpa] }),
      recommend('relate', { vars: [gpa, stress] }),
      recommend('predict', { outcome: [job], predictors: [gpa] }),
      recommend('predict', { outcome: [gpa], predictors: [faculty] }),
      recommend('distribution', { vars: [gpa] }),
      recommend('reliability', { items: [satisf, satisf, satisf, satisf] }),
      recommend('testValue', { vars: [gpa] }),
    ];
    const get = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], cs);
    for (const r of all) {
      expect(r).not.toBeNull();
      for (const step of [r!.primary, r!.also, r!.alternative].filter(Boolean)) {
        const spec = SPECS_BY_ID[step!.specId];
        expect(spec, step!.specId).toBeTruthy();
        const ids = new Set<string>();
        const walk = (fs: typeof spec.fields) => fs.forEach((f) => ('id' in f && ids.add(f.id), (f.kind === 'group' || f.kind === 'subdialog') && walk(f.fields), f.kind === 'groupvalues' && f.ids.forEach((i) => ids.add(i))));
        walk(spec.fields);
        for (const k of Object.keys(step!.preset)) expect(ids.has(k), `${step!.specId}.${k}`).toBe(true);
      }
      expect(get(r!.reason.key), r!.reason.key).toBeTypeOf('string');
      expect(get(r!.menuPath), r!.menuPath).toBeTypeOf('string');
      for (const a of r!.assumptions) expect(get(a), a).toBeTypeOf('string');
      if (r!.alternativeWhen) expect(get(r!.alternativeWhen), r!.alternativeWhen).toBeTypeOf('string');
      if (r!.warning) expect(get(r!.warning), r!.warning).toBeTypeOf('string');
    }
    for (const g of GOALS) {
      expect(get(`assistant.goal.${g.id}.title`)).toBeTypeOf('string');
      for (const s of SLOTS[g.id]) expect(get(s.label), s.label).toBeTypeOf('string');
    }
  });
});
