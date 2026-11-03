/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { RowsField } from '../types';
import { lit } from '../syntaxUtil';

export const recodeMapField: RowsField = {
  kind: 'rows',
  id: 'map',
  label: 'dlg.recode.map',
  hint: 'dlg.recode.mapHint',
  minRows: 1,
  default: [{ from: '', to: '' }],
  columns: [
    { id: 'from', label: 'dlg.recode.oldValue', type: 'text', placeholder: '1 THRU 5' },
    { id: 'to', label: 'dlg.recode.newValue', type: 'text', placeholder: '1' },
  ],
};

const KEYWORDS = ['ELSE', 'MISSING', 'SYSMIS', 'LO', 'LOWEST', 'HI', 'HIGHEST', 'THRU', 'COPY', 'CONVERT'];

function token(t: string, isString: boolean): string {
  const up = t.toUpperCase();
  if (KEYWORDS.includes(up)) return up;
  return lit(t, isString);
}

/** Formats an "old value" spec like `1 thru 5`, `lowest thru 3`, `1, 2, 3`, `else`, `'a'`. */
export function formatOld(from: string, isString: boolean): string {
  return from
    .split(/\s*[,;]\s*/)
    .filter((p) => p.trim() !== '')
    .map((part) => {
      const m = part.trim().match(/^(.+?)\s+(?:THRU|-|–)\s+(.+)$/i);
      if (m && !isString) return `${token(m[1], false)} THRU ${token(m[2], false)}`;
      return token(part.trim(), isString);
    })
    .join(' ');
}

export function formatNew(to: string, isString: boolean): string {
  const t = to.trim();
  const up = t.toUpperCase();
  if (up === 'COPY' || up === 'SYSMIS') return up;
  return lit(t, isString);
}

export function formatMap(rows: { from?: string; to?: string }[], srcString: boolean, dstString: boolean): string[] {
  return rows
    .filter((r) => (r.from ?? '').trim() !== '' && (r.to ?? '').trim() !== '')
    .map((r) => `(${formatOld(r.from!, srcString)}=${formatNew(r.to!, dstString)})`);
}
