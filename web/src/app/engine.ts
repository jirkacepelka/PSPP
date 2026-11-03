/*
 * Engine orchestration: initialisation and running syntax against the active dataset.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import i18n from '../i18n';
import { getEngineHandle, markSynced } from '../engine/client';
import type { OutputItem } from '../engine/types';
import { useData } from '../store/data';
import { useOutput } from '../store/output';
import { useSyntax, type SyntaxDiagnostic } from '../store/syntax';
import { useUi } from '../store/ui';
import { useJournal, type JournalSource } from '../store/journal';
import { useSettings } from '../store/settings';
import { commandName } from '../lib/commands';
import { splitCommands } from '../lib/syntax';

export async function initEngine() {
  const ui = useUi.getState();
  ui.setEngine({ engineStatus: 'loading' });
  try {
    const h = await getEngineHandle();
    useUi.getState().setEngine({ engineStatus: 'ready', engineKind: h.kind, engineVersion: h.version });
    await applyEngineSettings();
    // Keep PSPP's output language and decimal separator in step with the settings.
    useSettings.subscribe((s, prev) => {
      if (s.language !== prev.language || s.decimalSeparator !== prev.decimalSeparator) void applyEngineSettings();
    });
  } catch (e) {
    console.error(e);
    useUi.getState().setEngine({ engineStatus: 'error' });
  }
}

/** Applies UI settings that affect PSPP's own output: language and decimal separator. */
async function applyEngineSettings() {
  try {
    const { api } = await getEngineHandle();
    const { language, decimalSeparator } = useSettings.getState();
    await api.setLanguage?.(language);
    // Runs against the engine's current dataset (null = unchanged); the result is not shown.
    await api.run(`SET DECIMAL=${decimalSeparator === ',' ? 'COMMA' : 'DOT'}.`, null);
  } catch (e) {
    console.warn('[PSPP Studio] could not apply engine settings', e);
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
  /** Keep the editor's data unchanged if the run reports errors. */
  rollbackOnError?: boolean;
  /** Dialog that generated the syntax, recorded for Edit / Re-run. */
  source?: { specId: string; values: Record<string, unknown> };
  /** Where the syntax came from, for the journal (default: 'dialog' if source, else 'syntax'). */
  origin?: JournalSource;
  /** Replace this output entry instead of appending a new one (re-run). */
  replaceEntryId?: string;
}

export interface RunOutcome {
  ok: boolean;
  /** Id of the output entry created or replaced, if any. */
  entryId: string | null;
}

/** Runs PSPP syntax on the active dataset. Returns true when there were no errors. */
export async function runSyntax(syntax: string, opts: RunOptions = {}): Promise<boolean> {
  return (await runSyntaxDetailed(syntax, opts)).ok;
}

/** Like runSyntax, but also returns the id of the output entry it produced. */
export async function runSyntaxDetailed(syntax: string, opts: RunOptions = {}): Promise<RunOutcome> {
  const text = syntax.trim();
  if (!text) return { ok: true, entryId: null };
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
    const errs = countErrors(items);
    const cmds = splitCommands(text).map((c) => commandName(c.text)).filter((c): c is string => !!c && c !== 'COMMENT');
    if (result.dataset && !(opts.rollbackOnError && errs)) {
      const cur = useData.getState();
      cur.load(result.dataset, { keepHistory: true, dirty: true, title: cur.title, fileName: cur.fileName, label: cmds.slice(0, 3).join(', ') });
      markSynced(useData.getState().dataset);
    }
    useJournal.getState().add({
      time: Date.now(),
      source: opts.origin ?? (opts.source ? 'dialog' : 'syntax'),
      specId: opts.source?.specId,
      values: opts.source?.values,
      syntax: text,
      ok: errs === 0,
    });
    const groups = items.filter((i) => i.kind === 'group');
    const base = groups.length === 1 && groups[0].kind === 'group' ? groups[0].title : cmds[0];
    const title = !base ? i18n.t('output.log') : cmds.length <= 1 ? base : `${base} +${cmds.length - 1}`;
    let entryId: string | null = null;
    if (items.length || !opts.quiet) {
      entryId = `e${Date.now().toString(36)}${entryCounter++}`;
      const entry = { id: entryId, title, syntax: text, time: Date.now(), items, source: opts.source, tabId: opts.tabId, status: errs ? ('error' as const) : ('ok' as const) };
      const out = useOutput.getState();
      if (opts.replaceEntryId && out.entries.some((e) => e.id === opts.replaceEntryId)) out.replace(opts.replaceEntryId, entry);
      else out.add(entry);
    }
    if (opts.tabId) useSyntax.getState().setDiagnostics(opts.tabId, collectMessages(items));
    if (errs) useUi.getState().toast(i18n.t('run.errors', { count: errs }), { kind: 'error' });
    const hasVisible = items.some((i) => i.kind !== 'message' || i.severity !== 'note');
    if (opts.showOutput !== false && hasVisible && (errs === 0 || !opts.tabId)) useUi.getState().setView('output');
    return { ok: result.ok && errs === 0, entryId };
  } catch (e) {
    console.error(e);
    useUi.getState().toast(i18n.t('run.failed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error' });
    return { ok: false, entryId: null };
  } finally {
    useUi.getState().setEngine({ engineStatus: 'ready' });
  }
}

/** Appends syntax to the active syntax tab and shows the syntax view. */
export function pasteSyntax(syntax: string) {
  useSyntax.getState().append(syntax);
  useUi.getState().setView('syntax');
}
