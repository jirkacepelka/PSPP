/*
 * PSPP command name matching.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { PSPP_COMMANDS as ENGINE_COMMANDS, PSPP_UNIMPLEMENTED as ENGINE_UNIMPLEMENTED } from './commandList';
import { EXT_COMMAND_NAMES, EXT_CONDITIONAL } from '../ext/names';

/** Commands that run: the engine's plus the extension analyses computed in the browser (src/ext). */
export const PSPP_COMMANDS: readonly string[] = [...new Set([...ENGINE_COMMANDS, ...EXT_COMMAND_NAMES, ...EXT_CONDITIONAL.map((c) => c.name)])];
export const PSPP_UNIMPLEMENTED: readonly string[] = ENGINE_UNIMPLEMENTED.filter((c) => !EXT_COMMAND_NAMES.includes(c));

const SORTED = [...PSPP_COMMANDS].sort((a, b) => b.split(' ').length - a.split(' ').length);

function wordMatches(token: string, word: string): boolean {
  const t = token.toUpperCase();
  if (t === word) return true;
  return t.length >= 3 && word.startsWith(t);
}

/** Identifies the PSPP command at the start of the given words. Returns the canonical name and number of words consumed. */
export function matchCommand(words: string[]): { name: string; words: number } | null {
  for (const cmd of SORTED) {
    const cw = cmd.split(' ');
    if (cw.length > words.length) continue;
    if (cw.every((w, i) => wordMatches(words[i], w))) return { name: cmd, words: cw.length };
  }
  return null;
}

/** Extracts the command name from the text of a command. */
export function commandName(text: string): string | null {
  const t = text.trimStart();
  if (t.startsWith('*')) return 'COMMENT';
  const words = t.split(/[\s/.=(]+/).slice(0, 4).filter(Boolean);
  if (words[0] === '-' || words[0] === '+') words.shift();
  return matchCommand(words)?.name ?? null;
}
