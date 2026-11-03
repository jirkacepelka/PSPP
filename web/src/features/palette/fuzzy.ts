/*
 * Fuzzy matching for the command palette: diacritics- and case-insensitive, word-based,
 * tolerant of one typo in longer words and of abbreviations ("korel" → Korelace,
 * "frekvence" → Četnosti via synonyms, "ttest" → T-test).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Lowercase, strip diacritics, unify punctuation. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―-]/g, '');
}

export function tokens(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Levenshtein distance with an early exit above MAX. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How well one query word matches one candidate token (0 = no match). */
function wordScore(w: string, tok: string): number {
  if (tok === w) return 10;
  if (tok.startsWith(w)) return 8 - Math.min(3, (tok.length - w.length) / 4);
  if (w.length >= 3 && tok.includes(w)) return 5;
  if (w.length >= 4) {
    // one typo, or the query word is a misspelt prefix of a long token
    const d = editDistance(w, tok.slice(0, Math.max(w.length, Math.min(tok.length, w.length + 1))), 1);
    if (d <= 1) return 4;
  }
  return 0;
}

export interface Candidate {
  /** main text (weighted higher) */
  label: string;
  /** extra searchable text: path, command, synonyms, id */
  keywords: string;
}

/**
 * Scores CANDIDATE for QUERY: every query word must match some token; the label counts double
 * and a label that starts with the query gets a bonus. Returns 0 when it does not match.
 */
export function score(query: string, c: Candidate): number {
  const words = tokens(query);
  if (!words.length) return 1;
  const label = tokens(c.label);
  const all = [...label, ...tokens(c.keywords)];
  // "ttest" style: compare with the label squashed together as well
  const squashed = label.join('');
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const tok of label) best = Math.max(best, wordScore(w, tok) * 2);
    if (squashed.startsWith(w) || (w.length >= 4 && squashed.includes(w))) best = Math.max(best, 14);
    if (!best) for (const tok of all) best = Math.max(best, wordScore(w, tok));
    if (!best) return 0;
    total += best;
  }
  const nq = norm(query).trim();
  const nl = norm(c.label);
  if (nl.startsWith(nq)) total += 12;
  else if (nl.includes(nq)) total += 5;
  return total;
}
