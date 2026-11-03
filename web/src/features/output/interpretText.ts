/*
 * Turns interpretation facts (lib/interpret.ts) into short plain-language text.
 * Strings live in i18n fragments under "interpret.*" (Czech and English).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { TFunction } from 'i18next';
import type { Fact, Size } from '../../lib/interpret';
import { autoDecimals, fmt, fmtP, statSep, type NumStyle } from '../../lib/statfmt';

export interface InterpretText {
  /** one-sentence key finding (may contain **bold** markers) */
  headline: string;
  /** supporting sentences */
  details: string[];
  /** a reportable sentence ("t(113) = 0.82, p = .414, d = 0.16") */
  report: string;
  /** effect size chip */
  effect?: { label: string; value: string; size: Size };
  /** caution line */
  caveat?: string;
  /** significant at alpha */
  significant?: boolean;
}

export interface TextOptions {
  style: NumStyle;
  alpha?: number;
  pThreshold?: boolean;
}

export function describeFact(f: Fact, t: TFunction, o: TextOptions): InterpretText {
  const s = o.style;
  const alpha = o.alpha ?? 0.05;
  const n = (x: number | null | undefined, d?: number, bounded = false) => fmt(x ?? NaN, d ?? autoDecimals(x ?? 0), s, bounded);
  const p = (x: number | null | undefined) => fmtP(x, s, o.pThreshold);
  const sep = statSep(s);
  const size = (z: Size | null | undefined) => (z ? t(`interpret.size.${z}`) : '');
  const sig = (x: number | null | undefined) => typeof x === 'number' && x < alpha;
  const caveatNs = t('interpret.caveat.notSame');
  const caveatCause = t('interpret.caveat.cause');

  switch (f.kind) {
    case 'ttestInd': {
      const [a, b] = f.groups;
      const higher = a.mean >= b.mean ? a : b;
      const lower = higher === a ? b : a;
      const significant = sig(f.p);
      const details = [
        t('interpret.groupMeans', { a: a.label, ma: n(a.mean, 2), sda: n(a.sd, 2), b: b.label, mb: n(b.mean, 2), sdb: n(b.sd, 2) }),
        t(significant ? 'interpret.ttest.diffSig' : 'interpret.ttest.diffNs', { diff: n(Math.abs(f.diff), 2), higher: higher.label, size: size(f.size), d: n(f.d, 2) }),
      ];
      if (f.leveneP !== null) details.push(t(f.welch ? 'interpret.ttest.leveneWelch' : 'interpret.ttest.leveneOk', { p: p(f.leveneP) }));
      return {
        headline: t(significant ? 'interpret.ttest.indSig' : 'interpret.ttest.indNs', { variable: f.variable, higher: higher.label, lower: lower.label, stats: `t(${n(f.df, Number.isInteger(f.df) ? 0 : 2)}) = ${n(f.t, 2)}${sep}${p(f.p)}` }),
        details,
        report: `t(${n(f.df, Number.isInteger(f.df) ? 0 : 2)}) = ${n(f.t, 2)}${sep}${p(f.p)}${sep}d = ${n(f.d, 2)}`,
        effect: { label: "Cohenovo d|Cohen's d", value: `${n(f.d, 2)} [${n(f.dCi[0], 2)}; ${n(f.dCi[1], 2)}]`, size: f.size },
        caveat: significant ? caveatCause : caveatNs,
        significant,
      };
    }
    case 'ttestPaired': {
      const significant = sig(f.p);
      const up = f.b.mean > f.a.mean;
      return {
        headline: t(significant ? 'interpret.ttest.pairedSig' : 'interpret.ttest.pairedNs', { a: f.a.label, b: f.b.label, dir: t(up ? 'interpret.dir.up' : 'interpret.dir.down'), stats: `t(${n(f.df, 0)}) = ${n(f.t, 2)}${sep}${p(f.p)}` }),
        details: [
          t('interpret.groupMeans', { a: f.a.label, ma: n(f.a.mean, 2), sda: n(f.a.sd, 2), b: f.b.label, mb: n(f.b.mean, 2), sdb: n(f.b.sd, 2) }),
          t('interpret.ttest.pairedDiff', { diff: n(Math.abs(f.diff), 2), size: size(f.size), d: n(f.d, 2) }),
        ],
        report: `t(${n(f.df, 0)}) = ${n(f.t, 2)}${sep}${p(f.p)}${sep}dz = ${n(f.d, 2)}`,
        effect: { label: 'dz', value: `${n(f.d, 2)} [${n(f.dCi[0], 2)}; ${n(f.dCi[1], 2)}]`, size: f.size },
        caveat: significant ? undefined : caveatNs,
        significant,
      };
    }
    case 'ttestOne': {
      const significant = sig(f.p);
      return {
        headline: t(significant ? 'interpret.ttest.oneSig' : 'interpret.ttest.oneNs', { variable: f.variable, mean: n(f.mean, 2), value: n(f.testValue), dir: t(f.mean > f.testValue ? 'interpret.dir.higher' : 'interpret.dir.lower'), stats: `t(${n(f.df, 0)}) = ${n(f.t, 2)}${sep}${p(f.p)}` }),
        details: [t('interpret.ttest.oneDetail', { mean: n(f.mean, 2), sd: n(f.sd, 2), n: f.n, size: size(f.size), d: n(f.d, 2) })],
        report: `M = ${n(f.mean, 2)}${sep}SD = ${n(f.sd, 2)}${sep}t(${n(f.df, 0)}) = ${n(f.t, 2)}${sep}${p(f.p)}${sep}d = ${n(f.d, 2)}`,
        effect: { label: "Cohenovo d|Cohen's d", value: n(f.d, 2), size: f.size },
        caveat: significant ? undefined : caveatNs,
        significant,
      };
    }
    case 'anova': {
      const significant = sig(f.p);
      const sorted = [...f.groups].sort((x, y) => y.mean - x.mean);
      const details: string[] = [];
      if (sorted.length >= 2) details.push(t('interpret.anova.range', { hi: sorted[0].label, mhi: n(sorted[0].mean, 2), lo: sorted[sorted.length - 1].label, mlo: n(sorted[sorted.length - 1].mean, 2) }));
      details.push(t('interpret.anova.eta', { eta: n(f.eta2, 2, true), pct: Math.round(f.eta2 * 100), size: size(f.size) }));
      if (significant) details.push(t('interpret.anova.posthoc'));
      if (f.leveneP !== null && f.leveneP < alpha) details.push(t('interpret.anova.levene', { p: p(f.leveneP) }));
      return {
        headline: t(significant ? 'interpret.anova.sig' : 'interpret.anova.ns', { variable: f.variable, stats: `F(${n(f.df1, 0)}, ${n(f.df2, 0)}) = ${n(f.F, 2)}${sep}${p(f.p)}` }),
        details,
        report: `F(${n(f.df1, 0)}, ${n(f.df2, 0)}) = ${n(f.F, 2)}${sep}${p(f.p)}${sep}η² = ${n(f.eta2, 2, true)}`,
        effect: { label: 'η²', value: n(f.eta2, 2, true), size: f.size },
        caveat: significant ? caveatCause : caveatNs,
        significant,
      };
    }
    case 'correlation': {
      const top = f.pairs[0];
      const sigPairs = f.pairs.filter((x) => sig(x.p));
      const one = (x: (typeof f.pairs)[number]) =>
        t('interpret.corr.pair', {
          a: x.a,
          b: x.b,
          dir: t(x.r >= 0 ? 'interpret.corr.positive' : 'interpret.corr.negative'),
          size: size(sizeOfR(x.r)),
          stats: `r${x.n ? `(${x.n - 2})` : ''} = ${n(x.r, 2, true)}${sep}${p(x.p)}`,
        });
      const details = sigPairs.slice(0, 4).map(one);
      if (top.r >= 0 && sigPairs.length) details.push(t('interpret.corr.posMeaning'));
      return {
        headline: sigPairs.length
          ? t('interpret.corr.someSig', { count: sigPairs.length, total: f.count })
          : t('interpret.corr.noneSig', { count: f.count }),
        details: details.length ? details : [one(top)],
        report: `r${top.n ? `(${top.n - 2})` : ''} = ${n(top.r, 2, true)}${sep}${p(top.p)}`,
        effect: { label: 'r', value: n(top.r, 2, true), size: sizeOfR(top.r) },
        caveat: caveatCause,
        significant: sigPairs.length > 0,
      };
    }
    case 'crosstab': {
      const significant = sig(f.p);
      return {
        headline: t(significant ? 'interpret.crosstab.sig' : 'interpret.crosstab.ns', { title: f.title, stats: `χ²(${n(f.df, 0)}, N = ${n(f.n, 0)}) = ${n(f.chi2, 2)}${sep}${p(f.p)}` }),
        details: f.v !== null ? [t('interpret.crosstab.v', { v: n(f.v, 2, true), size: size(f.size) })] : [],
        report: `χ²(${n(f.df, 0)}, N = ${n(f.n, 0)}) = ${n(f.chi2, 2)}${sep}${p(f.p)}${f.v !== null ? `${sep}V = ${n(f.v, 2, true)}` : ''}`,
        effect: f.v !== null && f.size ? { label: 'Cramérovo V|Cramér’s V', value: n(f.v, 2, true), size: f.size } : undefined,
        caveat: t('interpret.caveat.expected'),
        significant,
      };
    }
    case 'regression': {
      const significant = sig(f.p);
      const sigPred = f.predictors.filter((x) => sig(x.p));
      const details = [t('interpret.reg.r2', { pct: Math.round(f.r2 * 100), dependent: f.dependent || t('interpret.reg.dv') })];
      for (const pr of sigPred.slice(0, 4))
        details.push(t('interpret.reg.pred', { name: pr.name, dir: t(pr.b >= 0 ? 'interpret.reg.up' : 'interpret.reg.down'), b: n(Math.abs(pr.b), autoDecimals(pr.b) + 1), stats: `${pr.beta !== null ? `β = ${n(pr.beta, 2, true)}${sep}` : ''}${p(pr.p)}` }));
      const ns = f.predictors.filter((x) => !sig(x.p)).map((x) => x.name);
      if (ns.length) details.push(t('interpret.reg.ns', { names: ns.join(', ') }));
      return {
        headline: t(significant ? 'interpret.reg.sig' : 'interpret.reg.ns_model', { dependent: f.dependent || t('interpret.reg.dv'), stats: f.F !== null ? `F(${n(f.df1, 0)}, ${n(f.df2, 0)}) = ${n(f.F, 2)}${sep}${p(f.p)}` : `R² = ${n(f.r2, 2, true)}` }),
        details,
        report: `R² = ${n(f.r2, 2, true)}${f.F !== null ? `${sep}F(${n(f.df1, 0)}, ${n(f.df2, 0)}) = ${n(f.F, 2)}${sep}${p(f.p)}` : ''}`,
        effect: { label: 'R²', value: n(f.r2, 2, true), size: f.size },
        caveat: caveatCause,
        significant,
      };
    }
    case 'frequency':
      return {
        headline: t('interpret.freq.top', { variable: f.variable, top: f.top, pct: f.topPct !== null ? n(f.topPct, 1) : '–' }),
        details: [t('interpret.freq.detail', { count: f.categories, n: f.n ?? '–' }), ...(f.missing ? [t('interpret.freq.missing', { count: f.missing })] : [])],
        report: `${f.top}: ${f.topPct !== null ? n(f.topPct, 1) : '–'} %`,
      };
    case 'descriptive':
      return {
        headline: t('interpret.desc.line', { variable: f.variable, mean: n(f.mean, 2), sd: n(f.sd, 2), n: f.n }),
        details: f.min !== null && f.max !== null ? [t('interpret.desc.range', { min: n(f.min), max: n(f.max) })] : [],
        report: `M = ${n(f.mean, 2)}${sep}SD = ${n(f.sd, 2)}`,
      };
    case 'mannWhitney': {
      const significant = sig(f.p);
      const hi = [...f.groups].sort((x, y) => y.meanRank - x.meanRank)[0];
      return {
        headline: t(significant ? 'interpret.mw.sig' : 'interpret.mw.ns', { variable: f.variable, higher: hi?.label ?? '', stats: `U = ${n(f.U, 1)}${sep}z = ${n(f.z, 2)}${sep}${p(f.p)}` }),
        details: [t('interpret.rankEffect', { r: n(f.r, 2, true), size: size(f.size) })],
        report: `U = ${n(f.U, 1)}${sep}z = ${n(f.z, 2)}${sep}${p(f.p)}${sep}r = ${n(f.r, 2, true)}`,
        effect: { label: 'r', value: n(f.r, 2, true), size: f.size },
        caveat: significant ? undefined : caveatNs,
        significant,
      };
    }
    case 'kruskal': {
      const significant = sig(f.p);
      const hi = [...f.groups].sort((x, y) => y.meanRank - x.meanRank)[0];
      return {
        headline: t(significant ? 'interpret.kw.sig' : 'interpret.kw.ns', { variable: f.variable, stats: `H(${n(f.df, 0)}) = ${n(f.H, 2)}${sep}${p(f.p)}` }),
        details: [hi ? t('interpret.kw.highest', { group: hi.label }) : '', f.eps2 !== null ? t('interpret.kw.eps', { e: n(f.eps2, 2, true), size: size(f.size) }) : ''].filter(Boolean),
        report: `H(${n(f.df, 0)}) = ${n(f.H, 2)}${sep}${p(f.p)}${f.eps2 !== null ? `${sep}ε² = ${n(f.eps2, 2, true)}` : ''}`,
        effect: f.eps2 !== null && f.size ? { label: 'ε²', value: n(f.eps2, 2, true), size: f.size } : undefined,
        caveat: significant ? undefined : caveatNs,
        significant,
      };
    }
    case 'wilcoxon': {
      const significant = sig(f.p);
      return {
        headline: t(significant ? 'interpret.wx.sig' : 'interpret.wx.ns', { label: f.label, stats: `z = ${n(f.z, 2)}${sep}${p(f.p)}` }),
        details: [t('interpret.wx.counts', { pos: f.pos, neg: f.neg, ties: f.ties }), ...(f.r !== null ? [t('interpret.rankEffect', { r: n(f.r, 2, true), size: size(f.size) })] : [])],
        report: `z = ${n(f.z, 2)}${sep}${p(f.p)}${f.r !== null ? `${sep}r = ${n(f.r, 2, true)}` : ''}`,
        effect: f.r !== null && f.size ? { label: 'r', value: n(f.r, 2, true), size: f.size } : undefined,
        caveat: significant ? undefined : caveatNs,
        significant,
      };
    }
    case 'chisqOne': {
      const significant = sig(f.p);
      return {
        headline: t(significant ? 'interpret.chi1.sig' : 'interpret.chi1.ns', { variable: f.variable, stats: `χ²(${n(f.df, 0)}) = ${n(f.chi2, 2)}${sep}${p(f.p)}` }),
        details: significant && f.over && f.under ? [t('interpret.chi1.detail', { over: f.over, under: f.under })] : [],
        report: `χ²(${n(f.df, 0)}) = ${n(f.chi2, 2)}${sep}${p(f.p)}`,
        significant,
      };
    }
    case 'reliability':
      return {
        headline: t('interpret.rel.line', { alpha: n(f.alpha, 2, true), items: f.items, quality: t(`interpret.rel.${f.quality}`) }),
        details: [t('interpret.rel.detail')],
        report: `α = ${n(f.alpha, 2, true)}`,
        caveat: f.quality === 'excellent' && f.alpha > 0.95 ? t('interpret.rel.tooHigh') : undefined,
      };
  }
}

function sizeOfR(r: number): Size {
  const a = Math.abs(r);
  return a < 0.1 ? 'negligible' : a < 0.3 ? 'small' : a < 0.5 ? 'medium' : 'large';
}

/** Picks "cs|en" halves of an inline bilingual label. */
export function pickLang(label: string, lang: string): string {
  const [cs, en] = label.split('|');
  return en === undefined ? cs : lang === 'cs' ? cs : en;
}
