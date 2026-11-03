/*
 * Syntax editor (CodeMirror 6) with PSPP highlighting, completion and engine diagnostics.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef } from 'react';
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
} from '@codemirror/view';
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
import { registerEditor, runSyntaxCommand } from './runCommands';
import { Icon } from '../../components/Icon';
import { formatShortcut } from '../../app/actions';
import { saveSyntaxFile } from '../../app/files';

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
      return () => unregister();
    }
    return registerEditor(view, tab.id);
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

  return (
    <div className="syntax-view">
      <div className="syntax-bar" role="toolbar" aria-label={t('syntax.toolbar')}>
        <button type="button" className="btn btn-filled btn-sm" disabled={running} onClick={() => runSyntaxCommand('all')}>
          <Icon name="play_arrow" filled />
          {t('actions.runAll')}
        </button>
        <button type="button" className="btn btn-tonal btn-sm" disabled={running} onClick={() => runSyntaxCommand('selection')} data-tip={t('actions.runSelection')}>
          <Icon name="play_circle" />
          <span className="hide-sm">{t('syntax.selection')}</span>
        </button>
        <button type="button" className="btn btn-tonal btn-sm" disabled={running} onClick={() => runSyntaxCommand('current')} data-tip={`${t('actions.runCurrent')} (${formatShortcut('Mod+Enter')})`}>
          <Icon name="subdirectory_arrow_right" />
          <span className="hide-sm">{t('syntax.current')}</span>
        </button>
        <button type="button" className="btn btn-text btn-sm" disabled={running} onClick={() => runSyntaxCommand('toEnd')}>
          <Icon name="vertical_align_bottom" />
          <span className="hide-sm">{t('syntax.toEnd')}</span>
        </button>
        <span className="spacer" />
        {errors.length > 0 && (
          <button
            type="button"
            className="chip syntax-errors"
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              const line = view.state.doc.line(Math.min(errors[0].line, view.state.doc.lines));
              view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
              view.focus();
            }}
          >
            <Icon name="error" />
            {t('syntax.errorCount', { count: errors.length })}
          </button>
        )}
        <span className="syntax-hint hide-sm">{t('syntax.hint', { key: formatShortcut('Mod+Enter') })}</span>
      </div>
      <div className="syntax-editor" ref={host} />
    </div>
  );
}
