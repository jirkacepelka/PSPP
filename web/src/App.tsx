/*
 * PSPP Studio application shell.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppBar } from './features/shell/AppBar';
import { Toolbar } from './features/shell/Toolbar';
import { FormulaBar } from './features/shell/FormulaBar';
import { ViewTabs } from './features/shell/ViewTabs';
import { StatusBar } from './features/shell/StatusBar';
import { MobileMenu } from './features/shell/MobileMenu';
import { StartScreen } from './features/start/StartScreen';
import { CommandPalette } from './features/palette/CommandPalette';
import { Toasts } from './components/Toasts';
import { Icon } from './components/Icon';
import { useUi } from './store/ui';
import { useSettings } from './store/settings';
import { useData } from './store/data';
import { ACTIONS, matchShortcut, runAction } from './app/actions';
import { openFiles, startAutosave } from './app/files';
import { initEngine } from './app/engine';
import { startAppearance } from './app/theme';
import { SPECS_BY_ID } from './features/dialogs/specs';
import { AnalysisDialog } from './features/dialogs/DialogRenderer';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { AboutDialog } from './features/misc/AboutDialog';
import { ShortcutsDialog } from './features/misc/ShortcutsDialog';
import { ConfirmDialog, FindDialog, GotoDialog, SaveAsDialog } from './features/misc/SmallDialogs';
import { MissingDialog, TypeDialog, ValueLabelsDialog } from './features/variables/VariableDialogs';

const DataView = lazy(() => import('./features/data/DataView').then((m) => ({ default: m.DataView })));
const VariableView = lazy(() => import('./features/variables/VariableView').then((m) => ({ default: m.VariableView })));
const SyntaxView = lazy(() => import('./features/syntax/SyntaxView').then((m) => ({ default: m.SyntaxView })));
const OutputView = lazy(() => import('./features/output/OutputView').then((m) => ({ default: m.OutputView })));

/** Shortcuts that still work while typing in a text field or the syntax editor. */
const GLOBAL_IN_INPUT = new Set(['util.palette', 'file.open', 'file.save', 'file.saveAs', 'file.print', 'edit.settings', 'help.shortcuts', 'help.manual', 'view:data', 'view:variables', 'view:output', 'view:syntax', 'file.newData']);
/** Shortcuts handled natively by the grid / editor. */
const NATIVE = new Set(['edit.copy', 'edit.paste', 'edit.cut', 'edit.clear', 'syntax.runCurrent']);

function isEditable(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable || !!e.closest?.('.cm-editor');
}

function Modals() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'analysis': {
      const spec = SPECS_BY_ID[modal.specId];
      return spec ? <AnalysisDialog key={modal.specId} spec={spec} /> : null;
    }
    case 'settings':
      return <SettingsDialog section={modal.section} />;
    case 'about':
      return <AboutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'varType':
      return <TypeDialog index={modal.index} />;
    case 'valueLabels':
      return <ValueLabelsDialog index={modal.index} />;
    case 'missing':
      return <MissingDialog index={modal.index} />;
    case 'goto':
      return <GotoDialog />;
    case 'find':
      return <FindDialog />;
    case 'saveAs':
      return <SaveAsDialog />;
    case 'confirm':
      return <ConfirmDialog modal={modal} />;
  }
}

function MainView() {
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const { t } = useTranslation();
  if (showStart) return <StartScreen />;
  return (
    <Suspense
      fallback={
        <div className="view-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('common.loading')}
        </div>
      }
    >
      {view === 'data' && <DataView />}
      {view === 'variables' && <VariableView />}
      {view === 'output' && <OutputView />}
      {view === 'syntax' && <SyntaxView />}
    </Suspense>
  );
}

export function App() {
  const { t } = useTranslation();
  const showToolbar = useSettings((s) => s.showToolbar);
  const showFormula = useSettings((s) => s.showFormulaBar);
  const showStatus = useSettings((s) => s.showStatusBar);
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const title = useData((s) => s.title);
  const dirty = useData((s) => s.dirty);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const stopAppearance = startAppearance();
    void useSettings.getState().load();
    void initEngine();
    const stopAutosave = startAutosave();
    return () => {
      stopAppearance();
      stopAutosave();
    };
  }, []);

  useEffect(() => {
    document.title = title ? `${dirty ? '• ' : ''}${title} – PSPP Studio` : 'PSPP Studio';
  }, [title, dirty]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.modal || ui.paletteOpen) return;
      const editable = isEditable(e.target);
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z' && !editable) {
        e.preventDefault();
        runAction('edit.redo');
        return;
      }
      for (const a of ACTIONS) {
        if (!a.shortcut || NATIVE.has(a.id)) continue;
        if (!matchShortcut(e, a.shortcut)) continue;
        if (editable && !GLOBAL_IN_INPUT.has(a.id)) return;
        e.preventDefault();
        runAction(a.id);
        return;
      }
      if (e.key === 'F10' && !editable) {
        e.preventDefault();
        document.querySelector<HTMLElement>('.menubar-item')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drag & drop files onto the window
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void openFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <AppBar />
      {showToolbar && <Toolbar />}
      {showFormula && view === 'data' && !showStart && <FormulaBar />}
      <main id="main" className={`main view-${showStart ? 'start' : view}`}>
        <MainView />
      </main>
      <ViewTabs />
      {showStatus && <StatusBar />}
      <Modals />
      <CommandPalette />
      <MobileMenu />
      <Toasts />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Icon name="upload_file" size={48} />
            <span>{t('files.dropToOpen')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
