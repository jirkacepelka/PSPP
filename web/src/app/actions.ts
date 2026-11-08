/*
 * Central action registry: every menu entry, toolbar button and command-palette entry
 * is an action. Menus (menus.ts) reference actions by id.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import i18n from '../i18n';
import { useData } from '../store/data';
import { useOutput } from '../store/output';
import { useDialogMemory } from '../store/dialogs';
import { useSettings } from '../store/settings';
import { useSyntax } from '../store/syntax';
import { useUi, type View } from '../store/ui';
import { SPECS_BY_ID } from '../features/dialogs/specs';
import { syntaxTemplate } from '../features/syntax/templates';
import { newDataset, newSyntax, openFileDialog, openSample, printOutput, saveDataset, saveSyntaxFile } from './files';
import { pasteSyntax, runSyntax } from './engine';
import { manualUrl, SOURCE_URL } from './help';
import { gridCommands } from './gridBus';
import { runSyntaxCommand } from '../features/syntax/runCommands';
import { useLayout, SPLIT_MIN_WIDTH } from '../features/shell/layout';

export interface Action {
  id: string;
  /** i18n key */
  label: string;
  icon?: string;
  /** e.g. 'Mod+S', 'Mod+Shift+Z', 'F1' */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** extra search keywords for the command palette */
  keywords?: string;
  /** Views where the action is relevant (toolbar / palette context); all if omitted.
   *  Shortcuts of scoped actions only fire in those views, so one key can mean different
   *  things per view (Ctrl+S saves syntax in Syntax and the dataset elsewhere). */
  scope?: View[];
  /** PSPP command of a syntax template: the action pastes syntax instead of opening a dialog. */
  template?: string;
}

/**
 * Opens analysis dialog SPECID, optionally pre-filled (field id → value), e.g. with the
 * variables selected in the grid.  REPLACEENTRYID makes the run replace that output result.
 */
export function openDialog(specId: string, preset?: Record<string, unknown>, replaceEntryId?: string) {
  useUi.getState().openModal({ kind: 'analysis', specId, preset, replaceEntryId });
}

const hasData = () => !!useData.getState().dataset;
/** The output entry containing the selected output item (or the selected entry itself). */
function selectedEntry() {
  const { entries, selectedId } = useOutput.getState();
  if (!selectedId) return entries[entries.length - 1];
  const has = (items: { id: string; kind: string; children?: unknown }[]): boolean =>
    items.some((i) => i.id === selectedId || (i.kind === 'group' && has(i.children as { id: string; kind: string }[])));
  return entries.find((e) => e.id === selectedId || has(e.items as { id: string; kind: string }[]));
}
const ui = () => useUi.getState();
const lang = () => (i18n.language === 'cs' ? 'cs' : 'en');

function template(command: string) {
  pasteSyntax(syntaxTemplate(command, lang()));
}

function dialog(id: string): Action {
  const spec = SPECS_BY_ID[id];
  return {
    id: `dialog:${id}`,
    label: spec.title,
    icon: spec.icon,
    keywords: spec.command,
    run: () => openDialog(id),
  };
}

function tpl(command: string, label: string, icon?: string): Action {
  return { id: `tpl:${command}`, label, icon: icon ?? 'code_blocks', keywords: `${command} syntax syntaxe`, template: command, run: () => template(command) };
}

/** Active view for scoped shortcuts ('start' while the start screen is shown). */
export function currentScope(): View | 'start' {
  const u = useUi.getState();
  return u.showStart ? 'start' : u.view;
}

function toggleValueLabels() {
  const next = !useSettings.getState().showValueLabels;
  useSettings.getState().set({ showValueLabels: next });
  if (ui().valueLabels !== next) ui().toggleValueLabels();
}

/** Opens the command palette, optionally with a query prefix ('@' variables, '>' commands). */
export function openPalette(seed = '') {
  useLayout.getState().setPaletteSeed(seed);
  ui().setPalette(true);
}

function view(v: View, label: string, icon: string, shortcut: string): Action {
  return { id: `view:${v}`, label, icon, shortcut, run: () => ui().setView(v), checked: () => ui().view === v && !ui().showStart };
}

export const ACTIONS: Action[] = [
  // ---- file
  { id: 'file.newData', label: 'actions.newData', icon: 'note_add', shortcut: 'Mod+Alt+N', run: newDataset },
  { id: 'file.newSyntax', label: 'actions.newSyntax', icon: 'code', run: newSyntax },
  { id: 'file.open', label: 'actions.open', icon: 'folder_open', shortcut: 'Mod+O', run: () => void openFileDialog() },
  { id: 'file.sample.students', label: 'samples.students.title', icon: 'school', run: () => void openSample('students') },
  { id: 'file.sample.employees', label: 'samples.employees.title', icon: 'badge', run: () => void openSample('employees') },
  { id: 'file.sample.trial', label: 'samples.trial.title', icon: 'monitor_heart', run: () => void openSample('trial') },
  { id: 'file.save', label: 'actions.save', icon: 'save', shortcut: 'Mod+S', scope: ['data', 'variables', 'output'], run: () => void saveDataset(), enabled: hasData },
  { id: 'syntax.save', label: 'actions.saveSyntax', icon: 'download', shortcut: 'Mod+S', scope: ['syntax'], run: saveSyntaxFile },
  { id: 'file.saveAs', label: 'actions.saveAs', icon: 'save_as', shortcut: 'Mod+Shift+S', run: () => ui().openModal({ kind: 'saveAs' }), enabled: hasData },
  { id: 'file.saveSyntax', label: 'actions.saveSyntax', icon: 'download', run: saveSyntaxFile },
  { id: 'file.exportOutput', label: 'actions.exportOutput', icon: 'ios_share', run: () => ui().openModal({ kind: 'exportOutput' }) },
  { id: 'file.print', label: 'actions.print', icon: 'print', shortcut: 'Mod+P', run: printOutput },
  tpl('SYSFILE INFO', 'actions.sysfileInfo', 'info'),
  { id: 'file.start', label: 'actions.startScreen', icon: 'home', run: () => ui().setShowStart(true) },
  {
    id: 'file.close',
    label: 'actions.closeData',
    icon: 'close',
    enabled: hasData,
    run: () => {
      const d = useData.getState();
      const close = () => {
        useData.getState().load(null, { title: '', fileName: null });
        ui().setShowStart(true);
      };
      if (d.dirty) ui().openModal({ kind: 'confirm', titleKey: 'files.discardTitle', messageKey: 'files.discardMessage', messageArgs: { name: d.title }, confirmKey: 'files.discardConfirm', danger: true, onConfirm: close });
      else close();
    },
  },

  // ---- edit
  { id: 'edit.undo', label: 'actions.undo', icon: 'undo', shortcut: 'Mod+Z', run: () => {
    const label = useData.getState().undo();
    if (label) ui().toast(i18n.t('actions.undone', { label }), { action: { label: i18n.t('actions.redo'), run: () => useData.getState().redo() } });
  }, enabled: () => useData.getState().past.length > 0 },
  { id: 'edit.redo', label: 'actions.redo', icon: 'redo', shortcut: 'Mod+Y', run: () => {
    const label = useData.getState().redo();
    if (label) ui().toast(i18n.t('actions.redone', { label }));
  }, enabled: () => useData.getState().future.length > 0 },
  { id: 'edit.cut', label: 'actions.cut', icon: 'content_cut', shortcut: 'Mod+X', run: () => gridCommands.cut(), enabled: hasData },
  { id: 'edit.copy', label: 'actions.copy', icon: 'content_copy', shortcut: 'Mod+C', run: () => gridCommands.copy(), enabled: hasData },
  { id: 'edit.paste', label: 'actions.paste', icon: 'content_paste', shortcut: 'Mod+V', run: () => gridCommands.paste(), enabled: hasData },
  { id: 'edit.clear', label: 'actions.clearCells', icon: 'backspace', shortcut: 'Delete', run: () => gridCommands.clear(), enabled: hasData },
  { id: 'edit.insertCase', label: 'actions.insertCase', icon: 'add_row_below', shortcut: 'Mod+Shift+=', scope: ['data', 'variables'], run: () => gridCommands.insertCase(), enabled: hasData },
  { id: 'edit.insertVariable', label: 'actions.insertVariable', icon: 'add_column_right', shortcut: 'Mod+Alt+=', scope: ['data', 'variables'], run: () => gridCommands.insertVariable(), enabled: hasData },
  { id: 'edit.deleteCases', label: 'actions.deleteCases', icon: 'delete_sweep', run: () => gridCommands.deleteCases(), enabled: hasData },
  { id: 'edit.deleteVariables', label: 'actions.deleteVariables', icon: 'variable_remove', run: () => gridCommands.deleteVariables(), enabled: hasData },
  { id: 'edit.find', label: 'actions.find', icon: 'search', shortcut: 'Mod+F', run: () => ui().openModal({ kind: 'find' }), enabled: hasData },
  { id: 'edit.goto', label: 'actions.gotoCase', icon: 'move_down', shortcut: 'Mod+G', run: () => ui().openModal({ kind: 'goto' }), enabled: hasData },
  { id: 'edit.gotoVariable', label: 'shell.actions.gotoVariable', icon: 'view_column', shortcut: 'Mod+Shift+G', keywords: 'proměnná sloupec variable column jump skok', run: () => openPalette('@'), enabled: hasData },
  { id: 'edit.settings', label: 'actions.settings', icon: 'settings', shortcut: 'Mod+,', run: () => ui().openModal({ kind: 'settings' }) },

  // ---- analysis helpers
  { id: 'analysis.assistant', label: 'actions.assistant', icon: 'explore', shortcut: 'Mod+Shift+A', keywords: 'průvodce pomoc test vybrat assistant choose test which', run: () => ui().openModal({ kind: 'assistant' }), enabled: hasData },
  {
    id: 'dialog.recall',
    label: 'actions.recallDialog',
    icon: 'history',
    shortcut: 'Mod+Shift+R',
    run: () => {
      const recent = useDialogMemory.getState().recent[0];
      if (recent) openDialog(recent);
    },
    enabled: () => useDialogMemory.getState().recent.length > 0,
  },

  // ---- output results
  {
    id: 'output.edit',
    label: 'actions.editResult',
    icon: 'tune',
    shortcut: 'Mod+E',
    scope: ['output'],
    run: () => {
      const e = selectedEntry();
      if (e?.source) openDialog(e.source.specId, e.source.values, useSettings.getState().rerunReplaces ? e.id : undefined);
    },
    enabled: () => !!selectedEntry()?.source,
  },
  {
    id: 'output.rerun',
    label: 'actions.rerunResult',
    icon: 'replay',
    shortcut: 'Mod+R',
    scope: ['output'],
    run: () => {
      const e = selectedEntry();
      if (e) void runSyntax(e.syntax, { source: e.source, replaceEntryId: useSettings.getState().rerunReplaces ? e.id : undefined, origin: 'menu' });
    },
    enabled: () => !!selectedEntry() && hasData(),
  },
  {
    id: 'output.pin',
    label: 'actions.pinResult',
    icon: 'push_pin',
    scope: ['output'],
    run: () => {
      const e = selectedEntry();
      if (e) useOutput.getState().togglePin(e.id);
    },
    checked: () => !!selectedEntry()?.pinned,
    enabled: () => !!selectedEntry(),
  },

  // ---- view
  { id: 'view.inspector', label: 'actions.inspector', icon: 'right_panel_open', shortcut: 'Mod+I', scope: ['data', 'variables'], run: () => useSettings.getState().set({ inspectorOpen: !useSettings.getState().inspectorOpen }), checked: () => useSettings.getState().inspectorOpen },
  {
    id: 'view.split',
    label: 'actions.splitView',
    icon: 'splitscreen_right',
    shortcut: 'Mod+\\',
    run: () => {
      const s = useSettings.getState();
      const on = s.splitView === 'off';
      s.set({ splitView: on ? (ui().view === 'syntax' ? 'syntax-output' : 'data-output') : 'off' });
      if (on && ui().view === 'variables') ui().setView('data');
    },
    checked: () => useSettings.getState().splitView !== 'off',
    enabled: () => typeof window === 'undefined' || window.innerWidth >= SPLIT_MIN_WIDTH,
  },
  {
    id: 'view.journal',
    label: 'shell.actions.journal',
    icon: 'history_edu',
    shortcut: 'Mod+Shift+J',
    keywords: 'deník journal historie history log záznam syntaxe',
    run: () => {
      const l = useLayout.getState();
      const open = !l.journalOpen;
      l.setJournal(open);
      if (open && ui().showStart) ui().setShowStart(false);
    },
    checked: () => useLayout.getState().journalOpen,
  },
  view('data', 'views.data', 'table', 'Alt+1'),
  view('variables', 'views.variables', 'view_list', 'Alt+2'),
  view('output', 'views.output', 'article', 'Alt+3'),
  view('syntax', 'views.syntax', 'code', 'Alt+4'),
  { id: 'view.valueLabels', label: 'actions.valueLabels', icon: 'label', shortcut: 'Mod+L', run: toggleValueLabels, checked: () => useSettings.getState().showValueLabels },
  { id: 'view.toolbar', label: 'actions.showToolbar', run: () => useSettings.getState().set({ showToolbar: !useSettings.getState().showToolbar }), checked: () => useSettings.getState().showToolbar },
  { id: 'view.formulaBar', label: 'actions.showFormulaBar', run: () => useSettings.getState().set({ showFormulaBar: !useSettings.getState().showFormulaBar }), checked: () => useSettings.getState().showFormulaBar },
  { id: 'view.statusBar', label: 'actions.showStatusBar', run: () => useSettings.getState().set({ showStatusBar: !useSettings.getState().showStatusBar }), checked: () => useSettings.getState().showStatusBar },
  { id: 'view.theme.light', label: 'settings.themeLight', icon: 'light_mode', run: () => useSettings.getState().set({ theme: 'light' }), checked: () => useSettings.getState().theme === 'light' },
  { id: 'view.theme.dark', label: 'settings.themeDark', icon: 'dark_mode', run: () => useSettings.getState().set({ theme: 'dark' }), checked: () => useSettings.getState().theme === 'dark' },
  { id: 'view.theme.system', label: 'settings.themeSystem', icon: 'contrast', run: () => useSettings.getState().set({ theme: 'system' }), checked: () => useSettings.getState().theme === 'system' },
  { id: 'view.zoomIn', label: 'actions.zoomIn', icon: 'zoom_in', shortcut: 'Mod+=', run: () => ui().setZoom(ui().zoom + 0.1) },
  { id: 'view.zoomOut', label: 'actions.zoomOut', icon: 'zoom_out', shortcut: 'Mod+-', run: () => ui().setZoom(ui().zoom - 0.1) },
  { id: 'view.zoomReset', label: 'actions.zoomReset', icon: 'fit_screen', shortcut: 'Mod+0', run: () => ui().setZoom(1) },
  {
    id: 'view.fullscreen',
    label: 'actions.fullscreen',
    icon: 'fullscreen',
    run: () => {
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      } catch {
        /* unsupported */
      }
    },
  },

  // ---- data
  tpl('VARIABLE LEVEL', 'actions.defineProperties', 'tune'),
  dialog('sortCases'),
  tpl('SORT VARIABLES', 'actions.sortVariables', 'sort_by_alpha'),
  dialog('transpose'),
  tpl('ADD FILES', 'actions.addFiles', 'library_add'),
  tpl('MATCH FILES', 'actions.matchFiles', 'join'),
  dialog('aggregate'),
  tpl('IDENTIFY DUPLICATES', 'actions.identifyDuplicates', 'content_copy'),
  dialog('splitFile'),
  dialog('selectCases'),
  dialog('weightCases'),
  tpl('DATASET COPY', 'actions.datasetCopy', 'file_copy'),

  // ---- transform
  dialog('compute'),
  dialog('count'),
  dialog('recodeSame'),
  dialog('recodeDifferent'),
  dialog('autorecode'),
  dialog('rank'),
  tpl('VISUAL BINNING', 'actions.visualBinning', 'view_week'),
  tpl('SHIFT VALUES', 'actions.shiftValues', 'keyboard_double_arrow_right'),
  tpl('DO IF', 'actions.doIf', 'alt_route'),
  { id: 'transform.execute', label: 'actions.runPending', icon: 'play_circle', run: () => void runSyntax('EXECUTE.', { showOutput: false, quiet: true }) },

  // ---- analyze
  dialog('frequencies'),
  dialog('descriptives'),
  dialog('explore'),
  dialog('crosstabs'),
  tpl('CTABLES', 'actions.ctables', 'table_chart'),
  dialog('means'),
  dialog('ttestOneSample'),
  dialog('ttestIndependent'),
  dialog('ttestPaired'),
  dialog('oneway'),
  tpl('GLM', 'actions.glm', 'hub'),
  dialog('correlations'),
  dialog('regressionLinear'),
  tpl('LOGISTIC REGRESSION', 'actions.logistic', 'show_chart'),
  tpl('FACTOR', 'actions.factor', 'scatter_plot'),
  tpl('RELIABILITY', 'actions.reliability', 'verified'),
  tpl('QUICK CLUSTER', 'actions.cluster', 'bubble_chart'),
  tpl('NPAR TESTS CHISQUARE', 'actions.npChisq'),
  tpl('NPAR TESTS BINOMIAL', 'actions.npBinomial'),
  tpl('NPAR TESTS RUNS', 'actions.npRuns'),
  tpl('NPAR TESTS K-S', 'actions.npKs'),
  tpl('NPAR TESTS M-W', 'actions.npMw'),
  tpl('NPAR TESTS K-W', 'actions.npKw'),
  tpl('NPAR TESTS WILCOXON', 'actions.npWilcoxon'),
  tpl('NPAR TESTS FRIEDMAN', 'actions.npFriedman'),
  tpl('ROC', 'actions.roc', 'ssid_chart'),
  tpl('MATRIX', 'actions.matrix', 'data_array'),

  // ---- graphs
  tpl('GRAPH SCATTERPLOT', 'actions.scatter', 'scatter_plot'),
  tpl('GRAPH HISTOGRAM', 'actions.histogram', 'equalizer'),
  tpl('GRAPH BAR', 'actions.barChart', 'bar_chart'),
  tpl('GRAPH BAR MEAN', 'actions.barChartMean', 'stacked_bar_chart'),

  // ---- utilities
  tpl('DISPLAY', 'actions.variablesInfo', 'list_alt'),
  tpl('DOCUMENT', 'actions.documents', 'sticky_note_2'),
  tpl('SHOW', 'actions.showSettings', 'settings_suggest'),
  tpl('SET', 'actions.setOptions', 'settings_applications'),
  tpl('OUTPUT MODIFY', 'actions.outputModify', 'edit_note'),
  { id: 'util.palette', label: 'actions.palette', icon: 'search', shortcut: 'Mod+K', run: () => openPalette() },
  { id: 'util.clearOutput', label: 'actions.clearOutput', icon: 'delete_sweep', run: () => useOutput.getState().clear() },

  // ---- syntax
  { id: 'syntax.runAll', label: 'actions.runAll', icon: 'play_arrow', shortcut: 'Mod+Shift+Enter', scope: ['syntax'], run: () => runSyntaxCommand('all') },
  { id: 'syntax.runSelection', label: 'actions.runSelection', icon: 'play_circle', run: () => runSyntaxCommand('selection') },
  { id: 'syntax.runCurrent', label: 'actions.runCurrent', icon: 'subdirectory_arrow_right', shortcut: 'Mod+Enter', scope: ['syntax'], run: () => runSyntaxCommand('current') },
  { id: 'syntax.runToEnd', label: 'actions.runToEnd', icon: 'vertical_align_bottom', run: () => runSyntaxCommand('toEnd') },

  // ---- help
  { id: 'help.shortcuts', label: 'actions.shortcuts', icon: 'keyboard', shortcut: 'Mod+/', run: () => ui().openModal({ kind: 'shortcuts' }) },
  { id: 'help.manual', label: 'actions.manual', icon: 'menu_book', shortcut: 'F1', run: () => window.open(manualUrl(), '_blank', 'noopener') },
  { id: 'help.source', label: 'actions.source', icon: 'code', run: () => window.open(SOURCE_URL, '_blank', 'noopener') },
  { id: 'help.about', label: 'actions.about', icon: 'info', run: () => ui().openModal({ kind: 'about' }) },
];

// Dialogs added by the analysis work package without a hand-written entry above.
for (const id of Object.keys(SPECS_BY_ID)) if (!ACTIONS.some((a) => a.id === `dialog:${id}`)) ACTIONS.push(dialog(id));

export const ACTIONS_BY_ID: Record<string, Action> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

export function runAction(id: string) {
  const a = ACTIONS_BY_ID[id];
  if (!a) return;
  if (a.enabled && !a.enabled()) return;
  a.run();
}

/** Display form of a shortcut for the current platform. */
export function formatShortcut(s?: string): string {
  if (!s) return '';
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return s
    .split('+')
    .map((k) => {
      if (k === 'Mod') return mac ? '⌘' : 'Ctrl';
      if (k === 'Alt') return mac ? '⌥' : 'Alt';
      if (k === 'Shift') return mac ? '⇧' : 'Shift';
      if (k === 'Enter') return mac ? '↩' : 'Enter';
      return k;
    })
    .join(mac ? '' : '+');
}

export function matchShortcut(e: KeyboardEvent, s: string): boolean {
  const parts = s.split('+');
  const key = parts[parts.length - 1];
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if (mod !== (e.ctrlKey || e.metaKey)) return false;
  if (shift !== e.shiftKey) return false;
  if (alt !== e.altKey) return false;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key.length === 1 && /\d/.test(key)) return e.code === `Digit${key}`;
  if (key === '=') return k === '=' || k === '+' || e.code === 'Equal';
  if (key === '\\') return k === '\\' || e.code === 'Backslash' || e.code === 'IntlBackslash';
  if (key === '/') return k === '/' || e.code === 'Slash';
  return k === key.toUpperCase() || k === key;
}

void useSyntax;
