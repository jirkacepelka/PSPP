/*
 * Analysis assistant decision table (F5): goal + variables (measurement levels, number of groups)
 * → recommended dialog, pre-filled, with a plain-language reason, assumptions and an alternative.
 * Pure data and functions, unit-tested in rules.test.ts.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Measure } from '../../engine/types';

export type Goal = 'describe' | 'compare' | 'paired' | 'relate' | 'predict' | 'distribution' | 'reliability' | 'testValue';

export interface VarInfo {
  name: string;
  label?: string;
  measure: Measure;
  type: 'numeric' | 'string';
  /** number of distinct non-missing values */
  distinct: number;
  /** groups holding at least 5 % of the cases (tiny groups such as "other" are left out) */
  major?: number;
}

export interface Slot {
  id: string;
  /** i18n key: question shown above the picker */
  label: string;
  min: number;
  max?: number;
  /** suitable levels (sorted first, others marked) */
  prefer: Measure[];
  numericOnly?: boolean;
}

export const GOALS: { id: Goal; icon: string }[] = [
  { id: 'describe', icon: 'bar_chart' },
  { id: 'compare', icon: 'compare_arrows' },
  { id: 'paired', icon: 'swap_vert' },
  { id: 'relate', icon: 'scatter_plot' },
  { id: 'predict', icon: 'trending_up' },
  { id: 'distribution', icon: 'ssid_chart' },
  { id: 'reliability', icon: 'verified' },
  { id: 'testValue', icon: 'straighten' },
];

export const SLOTS: Record<Goal, Slot[]> = {
  describe: [{ id: 'vars', label: 'assistant.slot.describe', min: 1, prefer: ['nominal', 'ordinal', 'scale'] }],
  compare: [
    { id: 'outcome', label: 'assistant.slot.outcome', min: 1, prefer: ['scale', 'ordinal'] },
    { id: 'group', label: 'assistant.slot.group', min: 1, max: 1, prefer: ['nominal', 'ordinal'] },
  ],
  paired: [{ id: 'measures', label: 'assistant.slot.measures', min: 2, prefer: ['scale', 'ordinal'], numericOnly: true }],
  relate: [{ id: 'vars', label: 'assistant.slot.relate', min: 2, prefer: ['scale', 'ordinal', 'nominal'] }],
  predict: [
    { id: 'outcome', label: 'assistant.slot.predictOutcome', min: 1, max: 1, prefer: ['scale', 'nominal'], numericOnly: true },
    { id: 'predictors', label: 'assistant.slot.predictors', min: 1, prefer: ['scale', 'ordinal', 'nominal'], numericOnly: true },
  ],
  distribution: [{ id: 'vars', label: 'assistant.slot.distribution', min: 1, prefer: ['scale'], numericOnly: true }],
  reliability: [{ id: 'items', label: 'assistant.slot.items', min: 2, prefer: ['ordinal', 'scale'], numericOnly: true }],
  testValue: [{ id: 'vars', label: 'assistant.slot.testValue', min: 1, prefer: ['scale'], numericOnly: true }],
};

export interface Step {
  specId: string;
  preset: Record<string, unknown>;
  /** i18n key of the test name */
  name: string;
}

export interface Recommendation {
  primary: Step;
  /** run together with the primary (e.g. Frequencies + Descriptives for mixed variables) */
  also?: Step;
  alternative?: Step;
  /** i18n key + args: why this test */
  reason: { key: string; args?: Record<string, string | number> };
  /** i18n keys: assumptions to check */
  assumptions: string[];
  /** i18n key: when to use the alternative */
  alternativeWhen?: string;
  /** i18n key: menu path to find it next time */
  menuPath: string;
  /** i18n key of a caution (e.g. too few variables) */
  warning?: string;
}

const level = (v: VarInfo): Measure => (v.type === 'string' ? 'nominal' : v.measure === 'unknown' ? 'scale' : v.measure);
const isCat = (v: VarInfo) => level(v) !== 'scale';
const names = (vs: VarInfo[]) => vs.map((v) => v.name);

/** Picks the recommended analysis; returns null while the slots are not filled enough. */
export function recommend(goal: Goal, slots: Record<string, VarInfo[]>, opts: { testValue?: number } = {}): Recommendation | null {
  const s = (id: string) => slots[id] ?? [];
  for (const slot of SLOTS[goal]) if (s(slot.id).length < slot.min) return null;

  switch (goal) {
    case 'describe': {
      const vars = s('vars');
      const cat = vars.filter(isCat);
      const scale = vars.filter((v) => !isCat(v));
      const freq: Step = { specId: 'frequencies', name: 'dlg.frequencies.title', preset: { variables: names(cat), st_MEAN: false, st_STDDEV: false, st_MINIMUM: false, st_MAXIMUM: false, st_MODE: true, st_MEDIAN: cat.some((v) => level(v) === 'ordinal'), chart: 'bar' } };
      const desc: Step = { specId: 'explore', name: 'dlg.explore.title', preset: { dependents: names(scale), histogram: true, boxplot: true } };
      if (!scale.length) return { primary: freq, reason: { key: 'assistant.why.describeCat' }, assumptions: [], menuPath: 'assistant.path.frequencies' };
      if (!cat.length) return { primary: desc, alternative: { specId: 'descriptives', name: 'dlg.descriptives.title', preset: { variables: names(scale) } }, alternativeWhen: 'assistant.alt.descriptivesTable', reason: { key: 'assistant.why.describeScale' }, assumptions: [], menuPath: 'assistant.path.explore' };
      return { primary: freq, also: desc, reason: { key: 'assistant.why.describeMixed' }, assumptions: [], menuPath: 'assistant.path.frequencies' };
    }

    case 'compare': {
      const out = s('outcome');
      const g = s('group')[0];
      const tiny = g.major !== undefined && g.major >= 2 && g.major < g.distinct;
      const k = tiny ? g.major! : g.distinct;
      if (out.every(isCat) && out.every((v) => level(v) === 'nominal')) {
        return {
          primary: { specId: 'crosstabs', name: 'dlg.crosstabs.title', preset: { rows: [g.name], cols: names(out), st_CHISQ: true, st_PHI: true, c_ROW: true } },
          reason: { key: 'assistant.why.crosstabs' },
          assumptions: ['assistant.assume.expected5'],
          menuPath: 'assistant.path.crosstabs',
        };
      }
      const ordinal = out.some((v) => level(v) === 'ordinal');
      if (k <= 1) return null;
      if (k === 2) {
        const mw: Step = { specId: 'mannWhitney', name: 'dlg.mannWhitney.title', preset: { variables: names(out), group: [g.name] } };
        if (ordinal) return { primary: mw, reason: { key: 'assistant.why.mwOrdinal', args: { group: g.name } }, assumptions: ['assistant.assume.independent'], menuPath: 'assistant.path.mw' };
        return {
          primary: { specId: 'ttestIndependent', name: 'dlg.ttestIndependent.title', preset: { variables: names(out), group: [g.name] } },
          alternative: mw,
          alternativeWhen: 'assistant.alt.nonNormal',
          reason: { key: 'assistant.why.ttest', args: { group: g.name } },
          assumptions: ['assistant.assume.independent', 'assistant.assume.normal', 'assistant.assume.levene'],
          menuPath: 'assistant.path.ttest',
          warning: tiny ? 'assistant.warn.tinyGroups' : undefined,
        };
      }
      const kw: Step = { specId: 'kruskalWallis', name: 'dlg.kruskalWallis.title', preset: { variables: names(out), group: [g.name] } };
      const warning = k > 12 ? 'assistant.warn.manyGroups' : undefined;
      if (ordinal || g.type === 'string') return { primary: kw, reason: { key: 'assistant.why.kwOrdinal', args: { group: g.name, k } }, assumptions: ['assistant.assume.independent'], menuPath: 'assistant.path.kw', warning };
      return {
        primary: { specId: 'oneway', name: 'dlg.oneway.title', preset: { dependents: names(out), factor: [g.name], descriptives: true, homogeneity: true, ph_TUKEY: true } },
        alternative: kw,
        alternativeWhen: 'assistant.alt.nonNormal',
        reason: { key: 'assistant.why.anova', args: { group: g.name, k } },
        assumptions: ['assistant.assume.independent', 'assistant.assume.normal', 'assistant.assume.levene'],
        menuPath: 'assistant.path.anova',
        warning,
      };
    }

    case 'paired': {
      const m = s('measures');
      const ordinal = m.some((v) => level(v) === 'ordinal');
      if (m.length === 2) {
        const pairs = [{ a: m[0].name, b: m[1].name }];
        const wx: Step = { specId: 'wilcoxon', name: 'dlg.wilcoxon.title', preset: { pairs } };
        if (ordinal) return { primary: wx, reason: { key: 'assistant.why.wilcoxonOrdinal' }, assumptions: ['assistant.assume.samePeople'], menuPath: 'assistant.path.wilcoxon' };
        return {
          primary: { specId: 'ttestPaired', name: 'dlg.ttestPaired.title', preset: { pairs } },
          alternative: wx,
          alternativeWhen: 'assistant.alt.nonNormalDiff',
          reason: { key: 'assistant.why.paired' },
          assumptions: ['assistant.assume.samePeople', 'assistant.assume.normalDiff'],
          menuPath: 'assistant.path.paired',
        };
      }
      return {
        primary: { specId: 'friedman', name: 'dlg.friedman.title', preset: { variables: names(m) } },
        reason: { key: 'assistant.why.friedman', args: { k: m.length } },
        assumptions: ['assistant.assume.samePeople'],
        alternativeWhen: 'assistant.alt.repeatedGlm',
        menuPath: 'assistant.path.friedman',
      };
    }

    case 'relate': {
      const vs = s('vars');
      if (vs.some((v) => level(v) === 'nominal')) {
        const cat = vs.filter(isCat);
        const scale = vs.filter((v) => !isCat(v));
        if (cat.length >= 2 || !scale.length)
          return {
            primary: { specId: 'crosstabs', name: 'dlg.crosstabs.title', preset: { rows: [cat[0].name], cols: names(cat.slice(1).length ? cat.slice(1) : vs.filter((v) => v !== cat[0])), st_CHISQ: true, st_PHI: true } },
            reason: { key: 'assistant.why.relateNominal' },
            assumptions: ['assistant.assume.expected5'],
            menuPath: 'assistant.path.crosstabs',
          };
        // nominal × scale is a group comparison
        return recommend('compare', { outcome: scale, group: [cat[0]] });
      }
      const ordinal = vs.some((v) => level(v) === 'ordinal');
      const pearson: Step = { specId: 'correlations', name: 'dlg.correlations.title', preset: { variables: names(vs), method: 'PEARSON' } };
      const spearman: Step = { specId: 'correlations', name: 'assistant.test.spearman', preset: { variables: names(vs), method: 'SPEARMAN' } };
      if (ordinal) return { primary: spearman, reason: { key: 'assistant.why.spearman' }, assumptions: ['assistant.assume.monotonic'], menuPath: 'assistant.path.correlations' };
      return {
        primary: pearson,
        also: vs.length === 2 ? { specId: 'scatter', name: 'dlg.scatter.title', preset: { x: [vs[0].name], y: [vs[1].name] } } : undefined,
        alternative: spearman,
        alternativeWhen: 'assistant.alt.outliers',
        reason: { key: 'assistant.why.pearson' },
        assumptions: ['assistant.assume.linear', 'assistant.assume.outliers'],
        menuPath: 'assistant.path.correlations',
      };
    }

    case 'predict': {
      const y = s('outcome')[0];
      const xs = s('predictors');
      if (y.distinct === 2) {
        return {
          primary: { specId: 'logistic', name: 'dlg.logistic.title', preset: { dependent: [y.name], covariates: names(xs.filter((v) => !isCat(v) || level(v) === 'ordinal')), categorical: names(xs.filter((v) => level(v) === 'nominal')) } },
          reason: { key: 'assistant.why.logistic', args: { name: y.name } },
          assumptions: ['assistant.assume.independent', 'assistant.assume.events'],
          menuPath: 'assistant.path.logistic',
        };
      }
      if (level(y) === 'nominal') return { primary: { specId: 'crosstabs', name: 'dlg.crosstabs.title', preset: { rows: names(xs.filter(isCat)), cols: [y.name], st_CHISQ: true } }, reason: { key: 'assistant.why.multinomial' }, assumptions: [], menuPath: 'assistant.path.crosstabs', warning: 'assistant.warn.noMultinomial' };
      const nominalX = xs.filter((v) => level(v) === 'nominal');
      if (nominalX.length && nominalX.length === xs.length)
        return {
          primary: { specId: 'glm', name: 'dlg.glm.title', preset: { dependent: [y.name], factors: names(nominalX) } },
          reason: { key: 'assistant.why.glm' },
          assumptions: ['assistant.assume.normalResid', 'assistant.assume.levene'],
          menuPath: 'assistant.path.glm',
        };
      return {
        primary: { specId: 'regressionLinear', name: 'dlg.regressionLinear.title', preset: { dependent: [y.name], independents: names(xs) } },
        reason: { key: 'assistant.why.regression', args: { name: y.name } },
        assumptions: ['assistant.assume.linear', 'assistant.assume.normalResid', 'assistant.assume.multicol'],
        menuPath: 'assistant.path.regression',
        warning: nominalX.some((v) => v.distinct > 2) ? 'assistant.warn.dummy' : undefined,
      };
    }

    case 'distribution':
      return {
        primary: { specId: 'explore', name: 'dlg.explore.title', preset: { dependents: names(s('vars')), histogram: true, npplot: true, boxplot: true } },
        alternative: { specId: 'ksNormal', name: 'dlg.ksNormal.title', preset: { variables: names(s('vars')) } },
        alternativeWhen: 'assistant.alt.ks',
        reason: { key: 'assistant.why.distribution' },
        assumptions: ['assistant.assume.largeN'],
        menuPath: 'assistant.path.explore',
      };

    case 'reliability': {
      const items = s('items');
      return {
        primary: { specId: 'reliability', name: 'dlg.reliability.title', preset: { items: names(items), total: true } },
        alternative: items.length >= 4 ? { specId: 'factor', name: 'dlg.factor.title', preset: { variables: names(items) } } : undefined,
        alternativeWhen: items.length >= 4 ? 'assistant.alt.factor' : undefined,
        reason: { key: 'assistant.why.reliability', args: { k: items.length } },
        assumptions: ['assistant.assume.sameDirection'],
        menuPath: 'assistant.path.reliability',
        warning: items.length < 3 ? 'assistant.warn.fewItems' : undefined,
      };
    }

    case 'testValue':
      return {
        primary: { specId: 'ttestOneSample', name: 'dlg.ttestOneSample.title', preset: { variables: names(s('vars')), testValue: opts.testValue ?? 0 } },
        reason: { key: 'assistant.why.oneSample', args: { value: opts.testValue ?? 0 } },
        assumptions: ['assistant.assume.normal'],
        menuPath: 'assistant.path.oneSample',
      };
  }
}
