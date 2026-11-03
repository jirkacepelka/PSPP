/*
 * Engine orchestration: initialisation and running syntax against the active dataset.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import i18n from '../i18n';
import { getEngineHandle } from '../engine/client';
import type { OutputItem } from '../engine/types';
import { useData } from '../store/data';
import { useOutput } from '../store/output';
import { useSyntax, type SyntaxDiagnostic } from '../store/syntax';
import { useUi } from '../store/ui';
import { commandName } from '../lib/commands';
import { splitCommands } from '../lib/syntax';

export async function initEngine() {
  const ui = useUi.getState();
  ui.setEngine({ engineStatus: 'loading' });
  try {
    const h = await getEngineHandle();
    useUi.getState().setEngine({ engineStatus: 'ready', engineKind: h.kind, engineVersion: h.version });
  } catch (e) {
    console.error(e);
    useUi.getState().setEngine({ engineStatus: 'error' });
  }
}

function collectMessages(items: OutputItem[], out: SyntaxDiagnostic[] = []): SyntaxDiagnostic[] {
  for (const it of items) {
    if (it.kind === 'message' && it.line) out.push({ line: it.line, severity: it.severity === 'note' ? 'info' : it.severity, message: it.text });
    if (it.kind === 'group') collectMessages(it.children, out);
  }
  return out;
}

function countErrors(items: OutputItem[]): number {
  let n = 0;
  for (const it of items) {
    if (it.kind === 'message' && it.severity === 'error') n++;
    if (it.kind === 'group') n += countErrors(it.children);
  }
  return n;
}

let entryCounter = 0;

export interface RunOptions {
  /** syntax tab that produced the syntax (for diagnostics) */
  tabId?: string;
  /** line offset when running a selection (1-based line of the first syntax line) */
  lineOffset?: number;
  /** switch to the output view after running */
  showOutput?: boolean;
  /** suppress the syntax echo item */
  quiet?: boolean;
}

/** Runs PSPP syntax on the active dataset. Returns true when there were no errors. */
export async function runSyntax(syntax: string, opts: RunOptions = {}): Promise<boolean> {
  const text = syntax.trim();
  if (!text) return true;
  const ui = useUi.getState();
  ui.setEngine({ engineStatus: 'running' });
  try {
    const { api } = await getEngineHandle();
    const data = useData.getState();
    const result = await api.run(text.endsWith('.') ? text : `${text}.`, data.dataset);
    const offset = (opts.lineOffset ?? 1) - 1;
    const shift = (items: OutputItem[]): OutputItem[] =>
      items.map((it) => {
        if (it.kind === 'message' && it.line) return { ...it, line: it.line + offset };
        if (it.kind === 'group') return { ...it, children: shift(it.children) };
        return it;
      });
    const items = shift(result.items);
    if (result.dataset) {
      const cur = useData.getState();
      cur.load(result.dataset, { keepHistory: true, dirty: true, title: cur.title, fileName: cur.fileName });
    }
    const cmds = splitCommands(text).map((c) => commandName(c.text)).filter((c): c is string => !!c && c !== 'COMMENT');
    const groups = items.filter((i) => i.kind === 'group');
    const base = groups.length === 1 && groups[0].kind === 'group' ? groups[0].title : cmds[0];
    const title = !base ? i18n.t('output.log') : cmds.length <= 1 ? base : `${base} +${cmds.length - 1}`;
    if (items.length || !opts.quiet) {
      useOutput.getState().add({ id: `e${Date.now().toString(36)}${entryCounter++}`, title, syntax: text, time: Date.now(), items });
    }
    if (opts.tabId) useSyntax.getState().setDiagnostics(opts.tabId, collectMessages(items));
    const errs = countErrors(items);
    if (errs) useUi.getState().toast(i18n.t('run.errors', { count: errs }), { kind: 'error' });
    const hasVisible = items.some((i) => i.kind !== 'message' || i.severity !== 'note');
    if (opts.showOutput !== false && hasVisible && (errs === 0 || !opts.tabId)) useUi.getState().setView('output');
    return result.ok && errs === 0;
  } catch (e) {
    console.error(e);
    useUi.getState().toast(i18n.t('run.failed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error' });
    return false;
  } finally {
    useUi.getState().setEngine({ engineStatus: 'ready' });
  }
}

/** Appends syntax to the active syntax tab and shows the syntax view. */
export function pasteSyntax(syntax: string) {
  useSyntax.getState().append(syntax);
  useUi.getState().setView('syntax');
}
