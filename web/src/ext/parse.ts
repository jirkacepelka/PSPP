/*
 * A small SPSS-syntax reader for extension commands: tokens, subcommands, variable lists
 * (with TO), keywords and parenthesised arguments.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Variable } from '../engine/types';
import { ExtError } from './types';

export type Token = { kind: 'id' | 'num' | 'str' | 'punct'; text: string; value?: number };

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const s = src.replace(/\.\s*$/, ''); // command terminator
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = '';
      while (j < s.length) {
        if (s[j] === c) {
          if (s[j + 1] === c) {
            text += c;
            j += 2;
            continue;
          }
          break;
        }
        text += s[j++];
      }
      out.push({ kind: 'str', text });
      i = j + 1;
      continue;
    }
    const num = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num && (c !== '-' || !out.length || out[out.length - 1].kind === 'punct')) {
      out.push({ kind: 'num', text: num[0], value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z@#$_À-ɏ][A-Za-z0-9@#$_.À-ɏ]*/.exec(s.slice(i));
    if (id) {
      let text = id[0];
      while (text.endsWith('.')) text = text.slice(0, -1);
      out.push({ kind: 'id', text });
      i += text.length;
      continue;
    }
    out.push({ kind: 'punct', text: c });
    i++;
  }
  return out;
}

export interface ParsedCommand {
  /** canonical command name */
  name: string;
  /** tokens after the command name up to the first '/' */
  head: Token[];
  /** subcommands in order: name (upper case) → tokens after the optional '=' */
  subs: { name: string; tokens: Token[] }[];
  /** the raw text */
  text: string;
}

/** Splits a command into head and /SUBCOMMANDS. NAMEWORDS is the number of words in the name. */
export function parseCommand(text: string, name: string): ParsedCommand {
  const toks = tokenize(text).slice(name.split(' ').length);
  const head: Token[] = [];
  const subs: ParsedCommand['subs'] = [];
  let cur: Token[] = head;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'punct' && t.text === '/') {
      const n = toks[i + 1];
      if (!n || n.kind !== 'id') throw new ExtError(`Subcommand name expected after '/'.`);
      cur = [];
      subs.push({ name: n.text.toUpperCase(), tokens: cur });
      i++;
      if (toks[i + 1]?.kind === 'punct' && toks[i + 1].text === '=') i++;
      continue;
    }
    cur.push(t);
  }
  return { name, head, subs, text };
}

/** First subcommand whose name starts with any of NAMES (SPSS allows 3+ letter abbreviations). */
export function sub(cmd: ParsedCommand, ...names: string[]): Token[] | null {
  for (const s of cmd.subs) if (names.some((n) => n === s.name || (s.name.length >= 3 && n.startsWith(s.name)))) return s.tokens;
  return null;
}

export const isKw = (t: Token | undefined, ...kws: string[]) => !!t && t.kind === 'id' && kws.includes(t.text.toUpperCase());

/** Upper-case keywords among TOKENS (ignores parentheses and their contents' numbers). */
export function keywords(tokens: Token[] | null): Set<string> {
  return new Set((tokens ?? []).filter((t) => t.kind === 'id').map((t) => t.text.toUpperCase()));
}

/** Number inside KEYWORD(n) among TOKENS, e.g. CI(95). */
export function kwArg(tokens: Token[] | null, kw: string): Token[] | null {
  if (!tokens) return null;
  for (let i = 0; i < tokens.length; i++) {
    if (isKw(tokens[i], kw) && tokens[i + 1]?.text === '(') {
      const out: Token[] = [];
      for (let j = i + 2; j < tokens.length && tokens[j].text !== ')'; j++) out.push(tokens[j]);
      return out;
    }
  }
  return null;
}

/**
 * Reads a variable list from TOKENS starting at index I (stops at a keyword in STOP or punctuation
 * other than ','). Supports `a TO d` by dictionary order. Returns the names and the next index.
 */
export function varList(tokens: Token[], i: number, vars: Variable[], stop: string[] = []): { names: string[]; next: number } {
  const names: string[] = [];
  const idx = (n: string) => vars.findIndex((v) => v.name.toUpperCase() === n.toUpperCase());
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'punct' && t.text === ',') {
      i++;
      continue;
    }
    if (t.kind !== 'id' || stop.includes(t.text.toUpperCase())) break;
    if (isKw(t, 'ALL') && idx('ALL') < 0) {
      names.push(...vars.map((v) => v.name));
      i++;
      continue;
    }
    const a = idx(t.text);
    if (a < 0) throw new ExtError(`${t.text} is not a variable name.`);
    if (isKw(tokens[i + 1], 'TO') && tokens[i + 2]?.kind === 'id') {
      const b = idx(tokens[i + 2].text);
      if (b < 0) throw new ExtError(`${tokens[i + 2].text} is not a variable name.`);
      if (b < a) throw new ExtError(`${t.text} TO ${tokens[i + 2].text}: the second variable must come later in the dictionary.`);
      for (let k = a; k <= b; k++) names.push(vars[k].name);
      i += 3;
      continue;
    }
    names.push(vars[a].name);
    i++;
  }
  return { names, next: i };
}
