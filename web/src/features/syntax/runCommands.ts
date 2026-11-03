/*
 * Running syntax from the editor: all, selection, current command, to end.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { EditorView } from '@codemirror/view';
import { useSyntax } from '../../store/syntax';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { runSyntax } from '../../app/engine';
import { commandAtLine } from '../../lib/syntax';

let editor: { view: EditorView; tabId: string } | null = null;

export function registerEditor(view: EditorView, tabId: string): () => void {
  editor = { view, tabId };
  return () => {
    if (editor?.view === view) editor = null;
  };
}

export function getEditor() {
  return editor;
}

export type RunMode = 'all' | 'selection' | 'current' | 'toEnd';

export function runSyntaxCommand(mode: RunMode) {
  const s = useSyntax.getState();
  const tab = s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0];
  if (!tab) return;
  const view = editor && editor.tabId === tab.id ? editor.view : null;
  const text = view ? view.state.doc.toString() : tab.text;
  if (!text.trim()) {
    useUi.getState().setView('syntax');
    return;
  }
  if (!view || mode === 'all') {
    void runSyntax(text, { tabId: tab.id, lineOffset: 1 });
    return;
  }
  const sel = view.state.selection.main;
  if ((mode === 'selection' || (mode === 'current' && useSettings.getState().autoRunSelection)) && !sel.empty) {
    const from = view.state.doc.lineAt(sel.from);
    const to = view.state.doc.lineAt(sel.to);
    // run whole lines covered by the selection so commands are complete
    const chunk = view.state.sliceDoc(from.from, to.to);
    void runSyntax(chunk, { tabId: tab.id, lineOffset: from.number });
    return;
  }
  const line = view.state.doc.lineAt(sel.head).number;
  const cmd = commandAtLine(text, line);
  if (!cmd) return;
  if (mode === 'toEnd') {
    void runSyntax(text.slice(cmd.from), { tabId: tab.id, lineOffset: cmd.startLine });
    return;
  }
  void runSyntax(cmd.text, { tabId: tab.id, lineOffset: cmd.startLine });
  // move the cursor to the next command, like PSPP's "run current"
  const next = view.state.doc.line(Math.min(view.state.doc.lines, cmd.endLine + 1));
  view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, next.from) }, scrollIntoView: true });
}
