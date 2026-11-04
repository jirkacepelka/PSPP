/*
 * PSPP Studio application shell ("Klidná pracovní plocha").
 *   header (logo · title/menu bar · engine · profile · search)
 *   contextual command bar (per view)
 *   [formula bar]  workspace (view or split view · right panel slot)
 *   bottom row (view tabs · syntax tabs · journal · status)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppBar } from './features/shell/AppBar';
import { CommandBar } from './features/shell/CommandBar';
import { FormulaBar } from './features/shell/FormulaBar';
import { BottomBar } from './features/shell/BottomBar';
import { MobileMenu } from './features/shell/MobileMenu';
import { Workspace } from './features/shell/Workspace';
import { ShellToasts } from './features/shell/ShellToasts';
import { useLayout } from './features/shell/layout';
import { OPEN_MENU_EVENT, mnemonicIndex } from './features/shell/MenuBar';
import { CommandPalette } from './features/palette/CommandPalette';
import { Icon } from './components/Icon';
import { useUi } from './store/ui';
import { useSettings } from './store/settings';
import { useData } from './store/data';
import { ACTIONS, currentScope, matchShortcut, runAction } from './app/actions';
import { openFiles, startAutosave } from './app/files';
import { initEngine } from './app/engine';
import { startAppearance } from './app/theme';
import { SPECS_BY_ID } from './features/dialogs/specs';
import { AnalysisDialog } from './features/dialogs/DialogRenderer';
import { AssistantDialog } from './features/assistant/AssistantDialog';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { OnboardingGate } from './features/onboarding/Onboarding';
import { AboutDialog } from './features/misc/AboutDialog';
import { ShortcutsDialog } from './features/misc/ShortcutsDialog';
import { ConfirmDialog, FindDialog, GotoDialog, SaveAsDialog } from './features/misc/SmallDialogs';
import { MissingDialog, TypeDialog, ValueLabelsDialog } from './features/variables/VariableDialogs';
import './features/shell/shell.css';

/** Shortcuts that still work while typing in a text field or the syntax editor. */
const GLOBAL_IN_INPUT = new Set([
  'util.palette',
  'file.open',
  'file.save',
  'syntax.save',
  'file.saveAs',
  'file.print',
  'edit.settings',
  'help.shortcuts',
  'help.manual',
  'view:data',
  'view:variables',
  'view:output',
  'view:syntax',
  'file.newData',
  'analysis.assistant',
  'dialog.recall',
  'view.split',
  'view.journal',
  'syntax.runAll',
]);
/** Shortcuts handled natively by the grid / editor. */
const NATIVE = new Set(['edit.copy', 'edit.paste', 'edit.cut', 'edit.clear', 'syntax.runCurrent']);

function isEditable(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable || !!e.closest?.('.cm-editor');
}

/** F6 / Shift+F6 cycle between the big regions (WAI landmark navigation). */
function cycleRegion(back: boolean) {
  const regions = Array.from(document.querySelectorAll<HTMLElement>('.sh-header, .sh-commandbar, #main, .sh-bottom, .sh-toasts')).filter(
    (r) => r.offsetParent !== null || r.classList.contains('sh-toasts'),
  );
  if (!regions.length) return;
  const cur = regions.findIndex((r) => r.contains(document.activeElement));
  const next = regions[(cur + (back ? -1 : 1) + regions.length) % regions.length];
  const target = next.matches('#main, .sh-toasts') ? next.querySelector<HTMLElement>('button, [tabindex="0"]') ?? next : next.querySelector<HTMLElement>('[tabindex="0"], button:not([tabindex="-1"]), input');
  (target ?? next).focus();
}

function Modals() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'analysis': {
      const spec = SPECS_BY_ID[modal.specId];
      return spec ? <AnalysisDialog key={modal.specId} spec={spec} preset={modal.preset} replaceEntryId={modal.replaceEntryId} /> : null;
    }
    case 'assistant':
      return <AssistantDialog />;
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

export function App() {
  const { t } = useTranslation();
  const showToolbar = useSettings((s) => s.showToolbar);
  const showFormula = useSettings((s) => s.showFormulaBar);
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const title = useData((s) => s.title);
  const dirty = useData((s) => s.dirty);
  const altHeld = useLayout((s) => s.altHeld);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const stopAppearance = startAppearance();
    void useSettings.getState().load();
    void initEngine();
    const stopAutosave = startAutosave();
    // value labels: the persisted setting drives the grid's transient flag
    const syncLabels = () => {
      const want = useSettings.getState().showValueLabels;
      if (useUi.getState().valueLabels !== want) useUi.getState().toggleValueLabels();
    };
    syncLabels();
    const stopLabels = useSettings.subscribe(syncLabels);
    return () => {
      stopAppearance();
      stopAutosave();
      stopLabels();
    };
  }, []);

  useEffect(() => {
    document.title = title ? `${dirty ? '• ' : ''}${title} – PSPP Studio` : 'PSPP Studio';
  }, [title, dirty]);

  // global keyboard shortcuts
  useEffect(() => {
    const layout = useLayout.getState;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') layout().setAltHeld(true);
      // a handler closer to the focus (syntax editor, grid, dialog) already took this key
      if (e.defaultPrevented) return;
      const ui = useUi.getState();
      if (ui.modal || ui.paletteOpen) return;
      const editable = isEditable(e.target);
      if (e.key === 'F6') {
        e.preventDefault();
        cycleRegion(e.shiftKey);
        return;
      }
      // Alt+letter opens a menu (mnemonics), Alt+digit stays for the view actions
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Key[A-Z]$/.test(e.code)) {
        const idx = mnemonicIndex(e.code, t);
        if (idx >= 0) {
          e.preventDefault();
          layout().setAltHeld(false);
          window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: idx }));
          return;
        }
      }
      if (!editable && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        runAction('help.shortcuts');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z' && !editable) {
        e.preventDefault();
        runAction('edit.redo');
        return;
      }
      const scope = currentScope();
      for (const a of ACTIONS) {
        if (!a.shortcut || NATIVE.has(a.id)) continue;
        if (!matchShortcut(e, a.shortcut)) continue;
        // scoped shortcuts mean something only in their own views (Ctrl+S, Ctrl+E …)
        if (a.scope && (scope === 'start' || !a.scope.includes(scope))) continue;
        if (editable && !GLOBAL_IN_INPUT.has(a.id)) return;
        e.preventDefault();
        runAction(a.id);
        return;
      }
      if (e.key === 'F10' && !e.shiftKey && !editable) {
        e.preventDefault();
        document.querySelector<HTMLElement>('.sh-menubar-item[tabindex="0"], .sh-menubar-item')?.focus();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') layout().setAltHeld(false);
    };
    const onBlur = () => layout().setAltHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [t]);

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
      if (files.length) {
        useUi.getState().toast(t('shell.loadingFile', { name: files.map((f) => f.name).join(', ') }));
        void openFiles(files);
      }
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
  }, [t]);

  const h1 = showStart ? 'PSPP Studio' : `${title || 'PSPP Studio'}: ${t(`views.${view}`)}`;
  return (
    <div className={`app sh-app ${altHeld ? 'alt-held' : ''} ${showStart ? 'is-start' : ''}`}>
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <h1 className="sr-only">{h1}</h1>
      <AppBar />
      {showToolbar && !showStart && <CommandBar />}
      {showFormula && view === 'data' && !showStart && (
        <div className="sh-formula">
          <FormulaBar />
        </div>
      )}
      <Workspace />
      <BottomBar />
      <Modals />
      <CommandPalette />
      <MobileMenu />
      <ShellToasts />
      <OnboardingGate />
      {dragging && (
        <div className="sh-drop" aria-hidden="true">
          <div className="sh-drop-card">
            <Icon name="upload_file" size={40} />
            <span>{t('files.dropToOpen')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
