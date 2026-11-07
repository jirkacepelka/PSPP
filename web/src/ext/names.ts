/*
 * Names of the commands implemented as extension analyses (kept import-free so the syntax
 * highlighter and command matcher can use it).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const EXT_COMMAND_NAMES: readonly string[] = ['NONPAR CORR', 'PARTIAL CORR', 'KM', 'PLUM', 'NOMREG', 'CLUSTER'];

/**
 * Engine commands that an extension takes over only for some forms: `claims(commandText)` decides
 * per command (e.g. GLM with several dependent variables or /WSFACTOR – PSPP's GLM is univariate).
 * Unclaimed forms go to the engine; the names stay engine commands for matching and highlighting.
 */
export const EXT_CONDITIONAL: readonly { name: string; claims: (commandText: string) => boolean }[] = [
  { name: 'GLM', claims: (text) => glmClaims(text) },
];

/** GLM is multivariate / repeated measures: /WSFACTOR, or more than one dependent (TO counts as several). */
function glmClaims(text: string): boolean {
  const body = text.replace(/^\s*\S+/, ''); // drop the command word
  if (/\/\s*WSF[A-Z]*/i.test(body)) return true;
  const head = body.split('/')[0].replace(/\.\s*$/, '');
  const words: string[] = [];
  for (const w of head.split(/[\s,]+/).filter(Boolean)) {
    if (/^(BY|WITH)$/i.test(w)) break;
    words.push(w);
  }
  return words.length > 1 || words.some((w) => /^TO$/i.test(w));
}
