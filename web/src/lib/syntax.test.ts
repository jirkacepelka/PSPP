/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { commandAtLine, splitCommands, tokenize } from './syntax';
import { commandName } from './commands';

const SRC = `* comment.
FREQUENCIES /VARIABLES=a b
  /STATISTICS=MEAN.

DESCRIPTIVES a
DATA LIST LIST /x.
BEGIN DATA
1
2.
END DATA.
LIST.`;

describe('syntax utilities', () => {
  it('splits commands with line numbers', () => {
    const c = splitCommands(SRC);
    expect(c.map((x) => [x.startLine, x.endLine])).toEqual([[1, 1], [2, 3], [5, 6], [7, 10], [11, 11]]);
  });
  it('finds the command at a line', () => {
    expect(commandAtLine(SRC, 3)?.startLine).toBe(2);
  });
  it('recognises command names and abbreviations', () => {
    expect(commandName('FREQ /VAR=x.')).toBe('FREQUENCIES');
    expect(commandName('sort cases by x.')).toBe('SORT CASES');
    expect(commandName('T-TEST /GROUPS=g(1,2).')).toBe('T-TEST');
    expect(commandName('* x')).toBe('COMMENT');
  });
  it('tokenizes', () => {
    expect(tokenize("COMPUTE x = 'it''s' + 1.5.")).toEqual([
      { t: 'id', v: 'COMPUTE' }, { t: 'id', v: 'x' }, { t: 'punct', v: '=' }, { t: 'str', v: "it's" }, { t: 'punct', v: '+' }, { t: 'num', v: 1.5 },
    ]);
  });
});
