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

/** Line the syntax editor should jump to when TABID is shown next (from Output error links). */
let pendingGoto: { tabId: string; line: number } | null = null;

/** Opens syntax tab TABID with the cursor on LINE (SY-4). */
export function gotoSyntaxLine(tabId: string, line: number) {
  const s = useSyntax.getState();
  if (!s.tabs.some((t) => t.id === tabId)) return false;
  pendingGoto = { tabId, line };
  s.setActive(tabId);
  useUi.getState().setView('syntax');
  // the editor may already show this tab
  setTimeout(() => consumeGoto(), 0);
  return true;
}

/** Applies a pending jump if the registered editor shows its tab. */
export function consumeGoto() {
  if (!pendingGoto || !editor || editor.tabId !== pendingGoto.tabId) return;
  const { view } = editor;
  const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, pendingGoto.line)));
  pendingGoto = null;
  view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
  view.focus();
}
