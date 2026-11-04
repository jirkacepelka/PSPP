/*
 * Runs syntax that may contain extension commands: consecutive PSPP commands go to the engine
 * as one chunk; each extension command runs in the browser on the dataset the engine left.
 * Line numbers of engine messages stay those of the full syntax (chunks are padded).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Dataset, EngineApi, OutputItem, RunResult } from '../engine/types';
import { splitCommands } from '../lib/syntax';
import { commandName } from '../lib/commands';
import { EXT_COMMAND_NAMES } from './names';
import { parseCommand } from './parse';
import { messageItem } from './table';
import { ExtError, type ExtCommand, type ExtContext } from './types';

const modules = import.meta.glob<{ commands: ExtCommand[] }>('./commands/*.ts', { eager: true });
export const EXT_COMMANDS: Record<string, ExtCommand> = Object.fromEntries(
  Object.values(modules)
    .flatMap((m) => m.commands ?? [])
    .map((c) => [c.name, c]),
);

export function hasExtCommand(syntax: string): boolean {
  return splitCommands(syntax).some((c) => {
    const n = commandName(c.text);
    return !!n && EXT_COMMAND_NAMES.includes(n);
  });
}

/** Runs one extension command; errors become messages, never exceptions. */
export function runExtCommand(name: string, text: string, ctx: ExtContext): OutputItem[] {
  const cmd = EXT_COMMANDS[name];
  if (!cmd) return [messageItem('error', `${name} is not available.`, ctx.line)];
  try {
    return cmd.run(parseCommand(text, name), ctx);
  } catch (e) {
    if (e instanceof ExtError) return [messageItem('error', `${name}: ${e.message}`, ctx.line)];
    console.error(e);
    return [messageItem('error', `${name}: ${e instanceof Error ? e.message : String(e)}`, ctx.line)];
  }
}

export async function runWithExtensions(
  api: EngineApi,
  syntax: string,
  dataset: Dataset | null,
  env: Omit<ExtContext, 'dataset' | 'line'>,
): Promise<RunResult> {
  const spans = splitCommands(syntax);
  const lines = syntax.split('\n');
  const items: OutputItem[] = [];
  let ok = true;
  let ds = dataset;
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
    chunkStart = -1;
  };
  for (let i = 0; i < spans.length; i++) {
    const name = commandName(spans[i].text);
    if (name && EXT_COMMAND_NAMES.includes(name)) {
      await flush(i);
      if (!ds) {
        items.push(messageItem('error', `${name}: no active dataset.`, spans[i].startLine));
        ok = false;
        continue;
      }
      const out = runExtCommand(name, spans[i].text, { ...env, dataset: ds, line: spans[i].startLine });
      if (out.some((o) => o.kind === 'message' && o.severity === 'error')) ok = false;
      items.push(...out);
    } else if (chunkStart < 0) chunkStart = i;
  }
  await flush(spans.length);
  return { items, ok, dataset: ds };
}
