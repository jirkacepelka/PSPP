/*
 * Goal words for the command palette (audit F12.3): what people type when they do not know the
 * name of the test. Both languages are searched regardless of the UI language, without
 * diacritics. Ids with alternatives ('dialog:x|tpl:Y') resolve like menu ids.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export interface Goal {
  /** i18n key of the goal title shown in the palette */
  label: string;
  words: string;
  /** actions offered for the goal, best first */
  actions: string[];
}

export const GOALS: Goal[] = [
  {
    label: 'shell.goals.compare',
    words: 'porovnat porovnani skupiny skupin rozdil rozdily lisi lisit srovnat srovnani mezi compare comparison groups group difference differ versus',
    actions: ['analysis.assistant', 'dialog:ttestIndependent', 'dialog:oneway', 'dialog:means', 'dialog:mannWhitney|tpl:NPAR TESTS M-W', 'dialog:ttestPaired'],
  },
  {
    label: 'shell.goals.relation',
    words: 'souvislost souvisi vztah zavislost zavisi korelace asociace spojitost relationship relation association correlate related dependence',
    actions: ['dialog:correlations', 'dialog:crosstabs', 'dialog:regressionLinear', 'analysis.assistant'],
  },
  {
    label: 'shell.goals.describe',
    words: 'prumer median odchylka popsat popis prehled shrnuti statistiky average mean median deviation describe summary overview',
    actions: ['dialog:descriptives', 'dialog:frequencies', 'dialog:explore', 'dialog:means'],
  },
  {
    label: 'shell.goals.counts',
    words: 'frekvence frekvencni cetnost cetnosti pocet pocty procenta tabulka kontingencni frequency frequencies count counts percent percentage table contingency',
    actions: ['dialog:frequencies', 'dialog:crosstabs', 'dialog:ctables|tpl:CTABLES'],
  },
  {
    label: 'shell.goals.predict',
    words: 'predikce predikovat predpoved predpovedet vliv model regrese predict prediction influence effect model regression',
    actions: ['dialog:regressionLinear', 'dialog:logistic|dialog:logisticRegression|tpl:LOGISTIC REGRESSION'],
  },
  {
    label: 'shell.goals.reliability',
    words: 'spolehlivost reliabilita alfa cronbach skala dotaznik reliability alpha scale questionnaire consistency',
    actions: ['dialog:reliability|tpl:RELIABILITY', 'dialog:factor|tpl:FACTOR'],
  },
  {
    label: 'shell.goals.normality',
    words: 'normalita normalni rozdeleni shapiro kolmogorov odlehle normality normal distribution outliers',
    actions: ['dialog:explore', 'dialog:ksNormal|tpl:NPAR TESTS K-S', 'dialog:histogram|tpl:GRAPH HISTOGRAM'],
  },
  {
    label: 'shell.goals.recode',
    words: 'prekodovat prekodovani kategorie seskupit sloucit intervaly recode categories group merge bins binning',
    actions: ['dialog:recodeDifferent', 'dialog:recodeSame', 'dialog:visualBinning|tpl:VISUAL BINNING', 'dialog:autorecode'],
  },
  {
    label: 'shell.goals.compute',
    words: 'nova promenna vypocitat vypocet vzorec soucet compute calculate formula new variable sum derive',
    actions: ['dialog:compute', 'dialog:count'],
  },
  {
    label: 'shell.goals.select',
    words: 'vybrat vyber pripady filtr podmnozina jen pouze select filter subset only cases',
    actions: ['dialog:selectCases', 'dialog:splitFile', 'dialog:weightCases'],
  },
  {
    label: 'shell.goals.chart',
    words: 'graf grafy obrazek vizualizace vykreslit plot chart charts graph picture visualise visualize',
    actions: ['dialog:histogram|tpl:GRAPH HISTOGRAM', 'dialog:barChart|dialog:bar|tpl:GRAPH BAR', 'dialog:scatterplot|dialog:scatter|tpl:GRAPH SCATTERPLOT'],
  },
];

/** Extra search words for single actions (common misnomers and the other language). */
export const ACTION_WORDS: Record<string, string> = {
  'dialog:frequencies': 'frekvence frequency cetnosti tabulka cetnosti',
  'dialog:descriptives': 'popisne prumer mean average sd',
  'dialog:crosstabs': 'kontingencni tabulka chi kvadrat chi square krizove',
  'dialog:correlations': 'pearson spearman korelace correlation',
  'dialog:ttestIndependent': 'ttest t test student nezavisle',
  'dialog:ttestPaired': 'ttest t test parovy parovany paired',
  'dialog:ttestOneSample': 'ttest t test jednovyberovy',
  'dialog:oneway': 'anova analyza rozptylu variance',
  'dialog:regressionLinear': 'regrese linearni regression ols',
  'dialog:compute': 'vypocet vzorec formula',
  'file.open': 'nacist import otevrit load sav csv',
  'file.save': 'ulozit stahnout download',
  'edit.settings': 'nastaveni predvolby preferences options',
  'view.valueLabels': 'popisky labels kody codes',
};
