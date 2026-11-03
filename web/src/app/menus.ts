/*
 * Menu bar structure. Entries reference action ids from actions.ts.
 * An entry 'dialog:x|tpl:Y' uses the first id that exists: as soon as the analysis work package
 * ships a real dialog `x`, the menu shows it instead of the syntax template `Y`.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export type MenuDef = string | '-' | { sub: string; icon?: string; items: MenuDef[] } | { header: string };

export interface TopMenu {
  id: string;
  label: string;
  /** i18n key of the Alt mnemonic letter (must occur in the translated label). */
  mnemonic: string;
  items: MenuDef[];
}

export const MENUS: TopMenu[] = [
  {
    id: 'file',
    label: 'menu.file',
    mnemonic: 'shell.mnemonic.file',
    items: [
      { sub: 'menu.new', icon: 'add', items: ['file.newData', 'file.newSyntax'] },
      'file.open',
      { sub: 'menu.samples', icon: 'dataset', items: ['file.sample.students', 'file.sample.employees', 'file.sample.trial'] },
      'file.start',
      '-',
      'file.save',
      'file.saveAs',
      { sub: 'menu.export', icon: 'ios_share', items: ['file.export.sav', 'file.export.zsav', 'file.export.por', 'file.export.csv', '-', 'file.saveSyntax', 'file.exportOutput'] },
      '-',
      'file.print',
      'tpl:SYSFILE INFO',
      '-',
      'file.close',
    ],
  },
  {
    id: 'edit',
    label: 'menu.edit',
    mnemonic: 'shell.mnemonic.edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.clear',
      '-',
      'edit.insertVariable',
      'edit.insertCase',
      'edit.deleteVariables',
      'edit.deleteCases',
      '-',
      'edit.find',
      'edit.goto',
      'edit.gotoVariable',
      '-',
      'edit.settings',
    ],
  },
  {
    id: 'view',
    label: 'menu.view',
    mnemonic: 'shell.mnemonic.view',
    items: [
      'view:data',
      'view:variables',
      'view:output',
      'view:syntax',
      '-',
      'view.valueLabels',
      'view.inspector',
      'view.journal',
      'view.split',
      '-',
      'view.toolbar',
      'view.formulaBar',
      'view.statusBar',
      '-',
      { sub: 'menu.theme', icon: 'palette', items: ['view.theme.light', 'view.theme.dark', 'view.theme.system'] },
      { sub: 'menu.zoom', icon: 'zoom_in', items: ['view.zoomIn', 'view.zoomOut', 'view.zoomReset'] },
      'view.fullscreen',
    ],
  },
  {
    id: 'data',
    label: 'menu.data',
    mnemonic: 'shell.mnemonic.data',
    items: [
      'dialog:defineProperties|tpl:VARIABLE LEVEL',
      '-',
      'dialog:sortCases',
      'tpl:SORT VARIABLES',
      'dialog:transpose',
      { sub: 'menu.merge', icon: 'merge_type', items: ['tpl:ADD FILES', 'tpl:MATCH FILES'] },
      'dialog:aggregate',
      'dialog:identifyDuplicates|tpl:IDENTIFY DUPLICATES',
      '-',
      'dialog:splitFile',
      'dialog:selectCases',
      'dialog:weightCases',
      '-',
      'tpl:DATASET COPY',
    ],
  },
  {
    id: 'transform',
    label: 'menu.transform',
    mnemonic: 'shell.mnemonic.transform',
    items: [
      'dialog:compute',
      'dialog:count',
      '-',
      'dialog:recodeSame',
      'dialog:recodeDifferent',
      'dialog:autorecode',
      'dialog:visualBinning|tpl:VISUAL BINNING',
      '-',
      'dialog:rank',
      'tpl:SHIFT VALUES',
      'tpl:DO IF',
      '-',
      'transform.execute',
    ],
  },
  {
    id: 'analyze',
    label: 'menu.analyze',
    mnemonic: 'shell.mnemonic.analyze',
    items: [
      'analysis.assistant',
      'dialog.recall',
      '-',
      { sub: 'menu.descriptive', icon: 'bar_chart', items: ['dialog:frequencies', 'dialog:descriptives', 'dialog:explore', 'dialog:crosstabs'] },
      'dialog:ctables|tpl:CTABLES',
      { sub: 'menu.compareMeans', icon: 'compare_arrows', items: ['dialog:means', '-', 'dialog:ttestOneSample', 'dialog:ttestIndependent', 'dialog:ttestPaired', '-', 'dialog:oneway'] },
      'dialog:glm|tpl:GLM',
      { sub: 'menu.correlate', icon: 'scatter_plot', items: ['dialog:correlations'] },
      { sub: 'menu.regression', icon: 'trending_up', items: ['dialog:regressionLinear', 'dialog:logistic|dialog:logisticRegression|tpl:LOGISTIC REGRESSION'] },
      '-',
      'dialog:factor|tpl:FACTOR',
      'dialog:reliability|tpl:RELIABILITY',
      'dialog:quickCluster|dialog:cluster|tpl:QUICK CLUSTER',
      {
        sub: 'menu.nonparametric',
        icon: 'ssid_chart',
        items: [
          'dialog:chiSquare|dialog:npChisq|tpl:NPAR TESTS CHISQUARE',
          'dialog:binomial|dialog:npBinomial|tpl:NPAR TESTS BINOMIAL',
          'dialog:runs|dialog:npRuns|tpl:NPAR TESTS RUNS',
          'dialog:ksOneSample|dialog:npKs|tpl:NPAR TESTS K-S',
          '-',
          'dialog:mannWhitney|dialog:npMw|tpl:NPAR TESTS M-W',
          'dialog:kruskalWallis|dialog:npKw|tpl:NPAR TESTS K-W',
          'dialog:wilcoxon|dialog:npWilcoxon|tpl:NPAR TESTS WILCOXON',
          'dialog:friedman|dialog:npFriedman|tpl:NPAR TESTS FRIEDMAN',
        ],
      },
      'dialog:roc|tpl:ROC',
      '-',
      'tpl:MATRIX',
    ],
  },
  {
    id: 'graphs',
    label: 'menu.graphs',
    mnemonic: 'shell.mnemonic.graphs',
    items: ['dialog:scatterplot|dialog:scatter|tpl:GRAPH SCATTERPLOT', 'dialog:histogram|tpl:GRAPH HISTOGRAM', 'dialog:barChart|dialog:bar|tpl:GRAPH BAR', 'dialog:barChartMean|tpl:GRAPH BAR MEAN'],
  },
  {
    id: 'utilities',
    label: 'menu.utilities',
    mnemonic: 'shell.mnemonic.utilities',
    items: ['tpl:DISPLAY', 'tpl:DOCUMENT', 'tpl:SHOW', 'tpl:SET', 'tpl:OUTPUT MODIFY', '-', 'util.clearOutput', 'view.journal', 'util.palette', 'edit.settings'],
  },
  {
    id: 'help',
    label: 'menu.help',
    mnemonic: 'shell.mnemonic.help',
    items: ['help.shortcuts', 'help.manual', 'help.source', '-', 'help.about'],
  },
];

/** Resolves a menu id with alternatives ('dialog:x|tpl:Y') to the first id in HAS. */
export function resolveMenuId(id: string, has: (id: string) => boolean): string | undefined {
  return id.split('|').find(has);
}
