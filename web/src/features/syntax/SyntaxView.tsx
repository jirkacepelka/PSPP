/*
 * Syntax editor (CodeMirror 6) with PSPP highlighting, completion and engine diagnostics.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { useSyntax, type SyntaxDiagnostic } from '../../store/syntax';
import { useSettings } from '../../store/settings';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { pspp, psppCompletion, setKnownVariables } from './psppLanguage';
import { consumeGoto, registerEditor, runSyntaxCommand } from './runCommands';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { MenuButton } from '../../components/MenuButton';
import { formatShortcut } from '../../app/actions';
import { saveSyntaxFile } from '../../app/files';
import { runSyntax } from '../../app/engine';
import { splitCommands } from '../../lib/syntax';
import { JournalPanel } from './JournalPanel';
import './syntax.css';

/* ---- gutter ▶ next to the first line of each command (SY-2) ---- */
class RunMarker extends GutterMarker {
  toDOM() {
    const b = document.createElement('span');
    b.className = 'syn-run-marker';
    b.textContent = '▶';
    b.setAttribute('aria-hidden', 'true');
    return b;
  }
}
const runMarker = new RunMarker();
const commandStarts = StateField.define<Set<number>>({
  create: (st) => new Set(splitCommands(st.doc.toString()).map((c) => c.startLine)),
  update: (v, tr) => (tr.docChanged ? new Set(splitCommands(tr.state.doc.toString()).map((c) => c.startLine)) : v),
});
function runGutter(getTab: () => string, title: string) {
  return [
    commandStarts,
    gutter({
      class: 'syn-run-gutter',
      markers: (view) => {
        const b = new RangeSetBuilder<GutterMarker>();
        const starts = view.state.field(commandStarts);
        for (const n of [...starts].sort((a, c) => a - c)) if (n <= view.state.doc.lines) b.add(view.state.doc.line(n).from, view.state.doc.line(n).from, runMarker);
        return b.finish();
      },
      domEventHandlers: {
        mousedown: (view, block) => {
          const line = view.state.doc.lineAt(block.from).number;
          const cmd = splitCommands(view.state.doc.toString()).find((c) => c.startLine === line);
          if (!cmd) return false;
          void runSyntax(cmd.text, { tabId: getTab(), lineOffset: cmd.startLine });
          return true;
        },
      },
    }),
    EditorView.editorAttributes.of({ 'data-run-title': title }),
  ];
}

const states = new Map<string, EditorState>();

function toCm(state: EditorState, diags: SyntaxDiagnostic[]): Diagnostic[] {
  return diags
    .filter((d) => d.line >= 1 && d.line <= state.doc.lines)
    .map((d) => {
      const line = state.doc.line(d.line);
      return { from: line.from, to: Math.max(line.from, line.to), severity: d.severity, message: d.message, source: 'PSPP' };
    });
}

export function SyntaxView() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const tabIdRef = useRef<string>('');
  const compartments = useRef({ lines: new Compartment(), wrap: new Compartment(), font: new Compartment(), placeholder: new Compartment() });
  const tabs = useSyntax((s) => s.tabs);
  const activeId = useSyntax((s) => s.activeId);
  const tab = tabs.find((x) => x.id === activeId) ?? tabs[0];
  const lineNums = useSettings((s) => s.lineNumbers);
  const wrap = useSettings((s) => s.wordWrap);
  const fontSize = useSettings((s) => s.editorFontSize);
  const variables = useData((s) => s.dataset?.variables);
  const engineStatus = useUi((s) => s.engineStatus);

  useEffect(() => {
    setKnownVariables((variables ?? []).map((v) => ({ name: v.name, label: v.label })));
  }, [variables]);

  const makeExtensions = (): Extension[] => {
    const c = compartments.current;
    const s = useSettings.getState();
    return [
      c.lines.of(s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
      c.wrap.of(s.wordWrap ? EditorView.lineWrapping : []),
      c.font.of(EditorView.theme({ '&': { fontSize: `${s.editorFontSize}px` } })),
      c.placeholder.of(placeholder(t('syntax.placeholder'))),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [psppCompletion], icons: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      lintGutter(),
      runGutter(() => tabIdRef.current, t('syntax.runCommand')),
      pspp(),
      keymap.of([
        { key: 'Mod-Enter', run: () => (runSyntaxCommand('current'), true) },
        { key: 'Shift-Mod-Enter', run: () => (runSyntaxCommand('all'), true) },
        { key: 'F5', run: () => (runSyntaxCommand('all'), true) },
        { key: 'Mod-s', run: () => (saveSyntaxFile(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) useSyntax.getState().setText(tabIdRef.current, u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ 'aria-label': t('syntax.editorLabel') }),
    ];
  };

  // create the view once
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: '', extensions: makeExtensions() }) });
    viewRef.current = view;
    return () => {
      if (tabIdRef.current) states.set(tabIdRef.current, view.state);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // switch tabs
  const versionRef = useRef<number>(-1);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !tab) return;
    if (tabIdRef.current !== tab.id) {
      if (tabIdRef.current) states.set(tabIdRef.current, view.state);
      tabIdRef.current = tab.id;
      const saved = states.get(tab.id);
      if (saved && saved.doc.toString() === tab.text) view.setState(saved);
      else view.setState(EditorState.create({ doc: tab.text, extensions: makeExtensions() }));
      versionRef.current = tab.version;
      const unregister = registerEditor(view, tab.id);
      view.focus();
      consumeGoto();
      return () => unregister();
    }
    const un = registerEditor(view, tab.id);
    consumeGoto();
    return un;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id]);

  // external text replacement (paste from dialog, templates)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !tab || tabIdRef.current !== tab.id) return;
    if (versionRef.current !== tab.version) {
      versionRef.current = tab.version;
      if (view.state.doc.toString() !== tab.text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: tab.text }, selection: { anchor: tab.text.length }, scrollIntoView: true });
      }
      view.focus();
    }
  }, [tab?.version, tab?.id, tab?.text, tab]);

  // diagnostics
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !tab || tabIdRef.current !== tab.id) return;
    view.dispatch(setDiagnostics(view.state, toCm(view.state, tab.diagnostics)));
  }, [tab?.diagnostics, tab?.id, tab]);

  // settings
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const c = compartments.current;
    view.dispatch({
      effects: [
        c.lines.reconfigure(lineNums ? [lineNumbers(), highlightActiveLineGutter()] : []),
        c.wrap.reconfigure(wrap ? EditorView.lineWrapping : []),
        c.font.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
        c.placeholder.reconfigure(placeholder(t('syntax.placeholder'))),
      ],
    });
  }, [lineNums, wrap, fontSize, t]);

  const errors = tab?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const running = engineStatus === 'running';
  const [journalOpen, setJournalOpen] = useState(false);
  const gotoLine = (n: number) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  };

  return (
    <div className="syntax-view">
      <div className="syntax-bar" role="toolbar" aria-label={t('syntax.toolbar')}>
        <div className="syn-run-split">
          <button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={() => runSyntaxCommand('current')} data-tip={`${t('actions.runCurrent')} (${formatShortcut('Mod+Enter')})`}>
            <Icon name="play_arrow" filled />
            {t('syntax.runCurrentShort')}
          </button>
          <MenuButton
            iconOnly
            icon="expand_more"
            variant="primary"
            className="primary syn-run-more"
            size="sm"
            label={t('syntax.runMore')}
            disabled={running}
            items={[
              { type: 'item', id: 'sel', label: t('actions.runSelection'), icon: 'play_circle', onSelect: () => runSyntaxCommand('selection') },
              { type: 'item', id: 'end', label: t('actions.runToEnd'), icon: 'vertical_align_bottom', onSelect: () => runSyntaxCommand('toEnd') },
              { type: 'item', id: 'all', label: t('actions.runAll'), icon: 'playlist_play', shortcut: 'Mod+Shift+Enter', onSelect: () => runSyntaxCommand('all') },
            ]}
          />
        </div>
        <span className="syntax-hint hide-sm">{t('syntax.hintGutter', { key: formatShortcut('Mod+Enter'), all: formatShortcut('Mod+Shift+Enter') })}</span>
        <span className="spacer" />
        {errors.length > 0 && (
          <button type="button" className="syn-errors" onClick={() => gotoLine(errors[0].line)} title={errors[0].message}>
            <Icon name="error" />
            <span>{t('syntax.errorCount', { count: errors.length })}</span>
            <span className="syn-errors-msg hide-sm">
              {t('output.line', { line: errors[0].line })}: {errors[0].message}
            </span>
          </button>
        )}
        <IconButton icon="history_edu" small pressed={journalOpen} label={t('syntax.journal')} onClick={() => setJournalOpen(!journalOpen)} />
        <IconButton icon="download" small label={t('actions.saveSyntax')} onClick={saveSyntaxFile} />
      </div>
      <div className="syntax-main">
        <div className="syntax-editor" ref={host} />
        {journalOpen && <JournalPanel onClose={() => setJournalOpen(false)} onInsert={(text) => {
          const view = viewRef.current;
          if (!view) return;
          const pos = view.state.selection.main.head;
          const line = view.state.doc.lineAt(pos);
          const at = line.length ? line.to : line.from;
          const ins = `${line.length ? '\n' : ''}${text.trim()}\n`;
          view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true });
          view.focus();
        }} />}
      </div>
    </div>
  );
}
