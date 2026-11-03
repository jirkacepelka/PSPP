/*
 * Helpers for generating PSPP syntax from dialog values.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Values } from './types';

export const vars = (v: Values, id: string): string[] => ((v[id] as string[] | undefined) ?? []).filter(Boolean);
export const bool = (v: Values, id: string): boolean => Boolean(v[id]);
export const str = (v: Values, id: string): string => String(v[id] ?? '').trim();
export const num = (v: Values, id: string): number | null => {
  const x = v[id];
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
export const rows = (v: Values, id: string): Record<string, string>[] =>
  ((v[id] as Record<string, string>[] | undefined) ?? []).filter((r) => Object.values(r).some((x) => String(x ?? '').trim() !== ''));

/** Wraps a list of words into lines at most `width` characters, indenting continuation lines. */
export function wrap(words: string[], indent = '    ', width = 72): string {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = indent + w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

/**
 * Builds a command: `NAME head\n  /SUB ...\n  /SUB ... .`
 * Empty subcommands are skipped.
 */
export function command(name: string, head: string, subs: (string | null | undefined | false)[] = []): string {
  const parts = [head ? `${name} ${head}` : name];
  for (const s of subs) if (s) parts.push(`  /${s}`);
  return `${parts.join('\n')}.`;
}

/** Formats a value typed by the user as a PSPP literal: numbers stay as-is, other text is quoted. */
export function lit(s: string, forceString = false): string {
  const t = s.trim();
  if (!forceString && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return t;
  if (/^'.*'$|^".*"$/.test(t)) return t;
  return `'${t.replace(/'/g, "''")}'`;
}
