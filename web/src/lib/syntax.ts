/*
 * Lightweight PSPP syntax utilities: command splitting and tokenizing.
 * Used by the editor (run current command) and by the mock engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CommandSpan {
  /** Full text of the command, including the terminating period. */
  text: string;
  /** 1-based first line. */
  startLine: number;
  /** 1-based last line. */
  endLine: number;
  /** Offsets in the source. */
  from: number;
  to: number;
}

/** True if the line terminates a command: it ends with a '.' outside of quotes (ignoring trailing spaces). */
function lineTerminates(line: string): boolean {
  let q: string | null = null;
  let last = '';
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    if (!/\s/.test(ch)) last = q ? '' : ch;
  }
  return !q && last === '.';
}

/**
 * Splits PSPP syntax into commands. A command ends with a period at the end of a line or with a blank line.
 * BEGIN DATA ... END DATA blocks are kept with their command.
 */
export function splitCommands(src: string): CommandSpan[] {
  const out: CommandSpan[] = [];
  const lines = src.split('\n');
  let cur: string[] = [];
  let start = -1;
  let startOff = 0;
  let off = 0;
  let inData = false;
  const flush = (endLine: number, endOff: number) => {
    const text = cur.join('\n');
    if (text.trim() !== '') out.push({ text, startLine: start + 1, endLine: endLine + 1, from: startOff, to: endOff });
    cur = [];
    start = -1;
  };
  lines.forEach((line, i) => {
    const lineEnd = off + line.length;
    const trimmed = line.trim();
    if (inData) {
      cur.push(line);
      if (/^END\s+DATA\s*\.?\s*$/i.test(trimmed)) {
        inData = false;
        flush(i, lineEnd);
      }
    } else if (trimmed === '') {
      if (cur.length) flush(i - 1, off - 1);
    } else {
      if (start < 0) {
        start = i;
        startOff = off;
      }
      cur.push(line);
      if (/^BEGIN\s+DATA\b/i.test(trimmed)) {
        inData = true;
      } else if (lineTerminates(line)) flush(i, lineEnd);
    }
    off = lineEnd + 1;
  });
  if (cur.length) flush(lines.length - 1, src.length);
  return out;
}

/** Returns the command containing the given 1-based line, or the nearest one before it. */
export function commandAtLine(src: string, line: number): CommandSpan | null {
  const cmds = splitCommands(src);
  let best: CommandSpan | null = null;
  for (const c of cmds) {
    if (c.startLine <= line && c.endLine >= line) return c;
    if (c.endLine < line) best = c;
  }
  return best ?? cmds[0] ?? null;
}

export type Token =
  | { t: 'id'; v: string }
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'punct'; v: string };

export function tokenize(text: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let s = '';
      i++;
      while (i < text.length) {
        if (text[i] === ch) {
          if (text[i + 1] === ch) {
            s += ch;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += text[i++];
      }
      toks.push({ t: 'str', v: s });
      continue;
    }
    const num = text.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
    if (num && !(ch === '.' && toks.length === 0)) {
      toks.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = text.slice(i).match(/^[\p{L}@#$][\p{L}\p{N}_.@#$]*/u);
    if (id) {
      let w = id[0];
      // a trailing period is the command terminator, not part of the identifier
      while (w.endsWith('.')) w = w.slice(0, -1);
      toks.push({ t: 'id', v: w });
      i += w.length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['**', '<=', '>=', '~=', '<>'].includes(two)) {
      toks.push({ t: 'punct', v: two });
      i += 2;
      continue;
    }
    toks.push({ t: 'punct', v: ch });
    i++;
  }
  // drop terminating period
  const last = toks[toks.length - 1];
  if (last && last.t === 'punct' && last.v === '.') toks.pop();
  return toks;
}

/** Strips comments (lines starting with '*' or COMMENT commands) – returns true if the command is a comment. */
export function isCommentCommand(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('*') || /^COMMENT\b/i.test(t);
}
