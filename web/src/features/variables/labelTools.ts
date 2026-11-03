/*
 * Pure helpers for the variable dialogs and the inspector.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Variable } from '../../engine/types';
import { changeVariableType } from '../../lib/variables';

/** How a type change affects existing values: unchanged, becoming missing, truncated. */
export function conversionPreview(v: Variable, col: readonly Cell[], type: 'numeric' | 'string', fmt: Variable['print']): { kept: number; lost: number; truncated: number; example?: string } {
  const r = changeVariableType(v, col as Cell[], type, fmt);
  let kept = 0;
  let lost = 0;
  let truncated = 0;
  let example: string | undefined;
  col.forEach((c, i) => {
    if (c === null || c === '') return;
    const n = r.column[i];
    if (n === null || n === '') {
      lost++;
      example ??= String(c);
    } else if (typeof c === 'string' && typeof n === 'string' && n.length < c.trimEnd().length) truncated++;
    else kept++;
  });
  return { kept, lost, truncated, example };
}

/** Parses a pasted two-column block (tab, semicolon or "code label" lines). */
export function parseLabelPaste(text: string): { value: string; label: string }[] | null {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2 && !text.includes('\t')) return null;
  const out: { value: string; label: string }[] = [];
  for (const l of lines) {
    const parts = l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.match(/^\s*(\S+)\s+(.+)$/)?.slice(1) ?? [l];
    const value = (parts[0] ?? '').trim().replace(/^"(.*)"$/, '$1');
    const label = parts.slice(1).join(' ').trim().replace(/^"(.*)"$/, '$1');
    if (value !== '') out.push({ value, label });
  }
  return out.length ? out : null;
}
