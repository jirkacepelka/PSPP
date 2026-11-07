/*
 * Runs syntax that may contain extension commands: consecutive PSPP commands go to the engine
 * as one chunk; each extension command runs in the browser on the dataset the engine left.
 * Line numbers of engine messages stay those of the full syntax (chunks are padded).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, EngineApi, OutputItem, RunResult } from '../engine/types';
import { splitCommands } from '../lib/syntax';
import { commandName } from '../lib/commands';
import { EXT_COMMAND_NAMES, EXT_CONDITIONAL } from './names';
import { parseCommand } from './parse';
import { messageItem } from './table';
import { ExtError, type ExtCommand, type ExtContext } from './types';

const modules = import.meta.glob<{ commands: ExtCommand[] }>(['./commands/*.ts', '!./commands/*.test.ts'], { eager: true });
export const EXT_COMMANDS: Record<string, ExtCommand> = Object.fromEntries(
  Object.values(modules)
    .flatMap((m) => m.commands ?? [])
    .map((c) => [c.name, c]),
);

/** True when the command NAME (text TEXT) runs as an extension: always, or when a conditional extension claims it. */
export function isExtCommand(name: string | null, text: string): name is string {
  if (!name) return false;
  return EXT_COMMAND_NAMES.includes(name) || EXT_CONDITIONAL.some((c) => c.name === name && c.claims(text));
}

export function hasExtCommand(syntax: string): boolean {
  return splitCommands(syntax).some((c) => isExtCommand(commandName(c.text), c.text));
}

/** Runs one extension command; errors become messages, never exceptions. */
export function runExtCommand(name: string, text: string, ctx: ExtContext): OutputItem[] {
  return runExtCommandFull(name, text, ctx).items;
}

/** Like runExtCommand, but also returns the dataset the command produced (null = unchanged). */
export function runExtCommandFull(name: string, text: string, ctx: ExtContext): { items: OutputItem[]; dataset: Dataset | null } {
  const cmd = EXT_COMMANDS[name];
  if (!cmd) return { items: [messageItem('error', `${name} is not available.`, ctx.line)], dataset: null };
  try {
    const r = cmd.run(parseCommand(text, name), ctx);
    return Array.isArray(r) ? { items: r, dataset: null } : { items: r.items, dataset: r.dataset ?? null };
  } catch (e) {
    if (e instanceof ExtError) return { items: [messageItem('error', `${name}: ${e.message}`, ctx.line)], dataset: null };
    console.error(e);
    return { items: [messageItem('error', `${name}: ${e instanceof Error ? e.message : String(e)}`, ctx.line)], dataset: null };
  }
}

export async function runWithExtensions(
  api: EngineApi,
  syntax: string,
  dataset: Dataset | null,
  env: Omit<ExtContext, 'dataset' | 'line'>,
): Promise<RunResult & { engineStale?: boolean }> {
  const spans = splitCommands(syntax);
  const lines = syntax.split('\n');
  const items: OutputItem[] = [];
  let ok = true;
  let ds = dataset;
  // true while the dataset was last changed by an extension command (the engine worker still
  // holds the older copy, so the app must send the new one with the next run)
  let engineStale = false;
  let chunkStart = -1; // index of first span in the pending PSPP chunk
  const flush = async (endIdx: number) => {
    if (chunkStart < 0) return;
    const first = spans[chunkStart];
    const last = spans[endIdx - 1];
    // pad with blank lines so the engine reports lines of the full syntax
    const text = '\n'.repeat(first.startLine - 1) + lines.slice(first.startLine - 1, last.endLine).join('\n');
    const r = await api.run(text, ds);
    items.push(...r.items);
    ok &&= r.ok;
    if (r.dataset) ds = r.dataset;
    engineStale = false;
    chunkStart = -1;
  };
  for (let i = 0; i < spans.length; i++) {
    const name = commandName(spans[i].text);
    if (isExtCommand(name, spans[i].text)) {
      await flush(i);
      if (!ds) {
        items.push(messageItem('error', `${name}: no active dataset.`, spans[i].startLine));
        ok = false;
        continue;
      }
      const { items: out, dataset: changed } = runExtCommandFull(name, spans[i].text, { ...env, dataset: ds, line: spans[i].startLine });
      if (changed) {
        ds = changed;
        engineStale = true;
      }
      if (out.some((o) => o.kind === 'message' && o.severity === 'error')) ok = false;
      items.push(...out);
    } else if (chunkStart < 0) chunkStart = i;
  }
  await flush(spans.length);
  return { items, ok, dataset: ds, engineStale };
}
