/*
 * Type-ahead matching for the value-label picker.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { PickOption } from './dataCell';

/** Folds case and diacritics so "zena" finds "Žena". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Orders options matching Q: exact code, code prefix, label prefix, label substring. */
export function filterOptions(options: PickOption[], q: string): PickOption[] {
  const f = fold(q.trim());
  if (!f) return options;
  const scored: { o: PickOption; s: number; i: number }[] = [];
  options.forEach((o, i) => {
    const code = fold(o.code);
    const label = fold(o.label);
    let s = -1;
    if (code === f) s = 0;
    else if (label === f) s = 1;
    else if (code.startsWith(f)) s = 2;
    else if (label.startsWith(f)) s = 3;
    else if (label.split(/\s+/).some((w) => w.startsWith(f))) s = 4;
    else if (label.includes(f)) s = 5;
    if (s >= 0) scored.push({ o, s, i });
  });
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.o);
}
