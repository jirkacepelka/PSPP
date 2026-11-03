/*
 * PSPP syntax mode for CodeMirror 6 (StreamLanguage) with completion.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { PSPP_COMMANDS, matchCommand } from '../../lib/commands';

let knownVars = new Set<string>();
let varList: { name: string; label: string }[] = [];

export function setKnownVariables(vars: { name: string; label: string }[]) {
  varList = vars;
  knownVars = new Set(vars.map((v) => v.name.toUpperCase()));
}

const KEYWORDS = new Set(['BY', 'TO', 'WITH', 'ALL', 'AND', 'OR', 'NOT', 'EQ', 'NE', 'LT', 'GT', 'LE', 'GE', 'THRU', 'LO', 'LOWEST', 'HI', 'HIGHEST', 'ELSE', 'INTO', 'COPY', 'SYSMIS', 'MISSING', 'OFF', 'ON', 'YES', 'NO', 'NONE', 'DEFAULT']);

export const FUNCTIONS = [
  'ABS', 'ACOS', 'ARSIN', 'ARTAN', 'COS', 'EXP', 'LG10', 'LN', 'LNGAMMA', 'MOD', 'MOD10', 'RND', 'SIN', 'SQRT', 'TAN', 'TRUNC',
  'ANY', 'RANGE', 'CFVAR', 'MAX', 'MEAN', 'MEDIAN', 'MIN', 'SD', 'SUM', 'VARIANCE', 'MISSING', 'NMISS', 'NVALID', 'SYSMIS', 'VALUE',
  'CONCAT', 'INDEX', 'LENGTH', 'LOWER', 'LPAD', 'LTRIM', 'NUMBER', 'REPLACE', 'RINDEX', 'RPAD', 'RTRIM', 'STRING', 'STRUNC', 'SUBSTR', 'UPCASE',
  'CTIME.DAYS', 'CTIME.HOURS', 'CTIME.MINUTES', 'CTIME.SECONDS', 'DATE.DMY', 'DATE.MDY', 'DATE.MOYR', 'DATE.QYR', 'DATE.WKYR', 'DATE.YRDAY',
  'TIME.DAYS', 'TIME.HMS', 'XDATE.DATE', 'XDATE.HOUR', 'XDATE.JDAY', 'XDATE.MDAY', 'XDATE.MINUTE', 'XDATE.MONTH', 'XDATE.QUARTER', 'XDATE.SECOND',
  'XDATE.TDAY', 'XDATE.TIME', 'XDATE.WEEK', 'XDATE.WKDAY', 'XDATE.YEAR', 'DATEDIFF', 'DATESUM', 'LAG', 'UNIFORM', 'NORMAL', 'RV.NORMAL', 'RV.UNIFORM',
  'CDF.NORMAL', 'IDF.NORMAL', 'CDF.T', 'IDF.T', 'CDF.CHISQ', 'SIG.CHISQ', 'CDF.F', 'SIG.F',
];
const FUNC_SET = new Set(FUNCTIONS);

/** Common subcommands per command, used for completion after '/'. */
export const SUBCOMMANDS: Record<string, string[]> = {
  FREQUENCIES: ['VARIABLES', 'FORMAT', 'MISSING', 'STATISTICS', 'NTILES', 'PERCENTILES', 'HISTOGRAM', 'PIECHART', 'BARCHART', 'ORDER'],
  DESCRIPTIVES: ['VARIABLES', 'MISSING', 'FORMAT', 'SAVE', 'STATISTICS', 'SORT'],
  EXAMINE: ['VARIABLES', 'STATISTICS', 'PLOT', 'CINTERVAL', 'COMPARE', 'ID', 'TOTAL', 'NOTOTAL', 'PERCENTILES', 'MISSING'],
  CROSSTABS: ['TABLES', 'MISSING', 'FORMAT', 'CELLS', 'COUNT', 'STATISTICS', 'BARCHART', 'VARIABLES'],
  MEANS: ['TABLES', 'CELLS', 'MISSING'],
  'T-TEST': ['TESTVAL', 'GROUPS', 'PAIRS', 'VARIABLES', 'MISSING', 'CRITERIA'],
  ONEWAY: ['VARIABLES', 'MISSING', 'CONTRAST', 'STATISTICS', 'POSTHOC'],
  CORRELATIONS: ['VARIABLES', 'PRINT', 'STATISTICS', 'MISSING'],
  REGRESSION: ['VARIABLES', 'DEPENDENT', 'METHOD', 'STATISTICS', 'ORIGIN', 'NOORIGIN', 'SAVE'],
  RANK: ['VARIABLES', 'TIES', 'FRACTION', 'PRINT', 'MISSING', 'RANK', 'NTILES', 'NORMAL', 'PERCENT', 'RFRACTION', 'PROPORTION', 'N', 'SAVAGE'],
  AGGREGATE: ['OUTFILE', 'MISSING', 'PRESORTED', 'DOCUMENT', 'BREAK'],
  AUTORECODE: ['VARIABLES', 'DESCENDING', 'PRINT', 'GROUP', 'BLANK'],
  FLIP: ['VARIABLES', 'NEWNAMES'],
  GRAPH: ['HISTOGRAM', 'SCATTERPLOT', 'BAR', 'MISSING'],
  'NPAR TESTS': ['CHISQUARE', 'BINOMIAL', 'RUNS', 'K-S', 'M-W', 'K-W', 'WILCOXON', 'SIGN', 'FRIEDMAN', 'KENDALL', 'COCHRAN', 'MCNEMAR', 'MEDIAN', 'J-T', 'EXPECTED', 'STATISTICS', 'MISSING', 'METHOD'],
  'GET DATA': ['TYPE', 'FILE', 'SHEET', 'CELLRANGE', 'READNAMES', 'ARRANGEMENT', 'DELIMITERS', 'QUALIFIER', 'FIRSTCASE', 'VARIABLES'],
  SET: ['DECIMAL', 'FORMAT', 'SEED', 'EPOCH', 'PRINTBACK', 'MXWARNS', 'MXERRS', 'TNUMBERS', 'TVARS', 'SMALL'],
  LIST: ['VARIABLES', 'CASES', 'FORMAT'],
  SAVE: ['OUTFILE', 'UNSELECTED', 'COMPRESSED', 'UNCOMPRESSED', 'ZCOMPRESSED', 'PERMISSIONS', 'DROP', 'KEEP', 'RENAME', 'VERSION'],
  GET: ['FILE', 'DROP', 'KEEP', 'RENAME'],
  FACTOR: ['VARIABLES', 'MATRIX', 'METHOD', 'ANALYSIS', 'EXTRACTION', 'FORMAT', 'MISSING', 'PRINT', 'PLOT', 'ROTATION', 'CRITERIA'],
  RELIABILITY: ['VARIABLES', 'SCALE', 'MODEL', 'SUMMARY', 'STATISTICS', 'MISSING'],
  GLM: ['MISSING', 'INTERCEPT', 'CRITERIA', 'DESIGN'],
  'LOGISTIC REGRESSION': ['VARIABLES', 'CATEGORICAL', 'CONTRAST', 'METHOD', 'PRINT', 'CRITERIA', 'MISSING', 'ORIGIN', 'NOORIGIN', 'NOCONST'],
};

interface State {
  start: boolean;
  comment: boolean;
  data: boolean;
  command: string | null;
}

function endsCommand(stream: StringStream): boolean {
  return /^\.\s*$/.test(stream.string.slice(stream.pos));
}

const psppStream = StreamLanguage.define<State>({
  name: 'pspp',
  startState: () => ({ start: true, comment: false, data: false, command: null }),
  copyState: (s) => ({ ...s }),
  blankLine: (s) => {
    if (!s.data) {
      s.start = true;
      s.comment = false;
      s.command = null;
    }
  },
  token(stream, state) {
    if (state.data) {
      if (stream.sol() && stream.match(/^\s*END\s+DATA\b/i)) {
        state.data = false;
        state.start = false;
        return 'keyword';
      }
      stream.skipToEnd();
      return 'meta';
    }
    if (state.comment) {
      if (stream.match(/^.*\.\s*$/)) {
        state.comment = false;
        state.start = true;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (state.start) {
      if (stream.peek() === '*' || stream.match(/^COMMENT\b/i, false)) {
        if (stream.match(/^.*\.\s*$/)) state.start = true;
        else {
          stream.skipToEnd();
          state.comment = true;
          state.start = false;
        }
        return 'comment';
      }
      if (stream.peek() === '+' || stream.peek() === '-') {
        stream.next();
        return 'operator';
      }
      const m = stream.match(/^[A-Za-z][\w.$#@-]*(\s+[A-Za-z][\w.$#@-]*){0,3}/, false) as RegExpMatchArray | null;
      if (m) {
        const words = m[0].split(/\s+/).map((w) => w.replace(/\.$/, ''));
        const cmd = matchCommand(words);
        state.start = false;
        if (cmd) {
          let re = '^';
          for (let i = 0; i < cmd.words; i++) re += `${i ? '\\s+' : ''}[A-Za-z][\\w$#@-]*`;
          stream.match(new RegExp(re));
          state.command = cmd.name;
          if (cmd.name === 'BEGIN DATA') {
            stream.skipToEnd();
            state.data = true;
          }
          return 'keyword';
        }
        stream.match(/^[A-Za-z][\w.$#@-]*/);
        if (stream.current().endsWith('.')) stream.backUp(1);
        return 'invalid';
      }
      state.start = false;
    }
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === ch) {
          if (stream.peek() === ch) stream.next();
          else break;
        }
      }
      return 'string';
    }
    if (ch === '.' && endsCommand(stream)) {
      stream.skipToEnd();
      state.start = true;
      state.command = null;
      return 'punctuation';
    }
    if (ch === '/') {
      stream.next();
      if (stream.match(/^\s*[A-Za-z][\w-]*/)) return 'propertyName';
      return 'operator';
    }
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z$#@][\w.$#@]*/)) {
      let word = stream.current();
      if (word.endsWith('.') && endsCommand({ string: stream.string, pos: stream.pos - 1 } as StringStream)) {
        stream.backUp(1);
        word = word.slice(0, -1);
      }
      const up = word.toUpperCase();
      if (stream.peek() === '(' && FUNC_SET.has(up)) return 'variableName.function';
      if (knownVars.has(up)) return 'variableName';
      if (KEYWORDS.has(up)) return 'atom';
      return 'name';
    }
    if (stream.match(/^(\*\*|<=|>=|<>|~=|[-+*/=<>&|~])/)) return 'operator';
    stream.next();
    return 'punctuation';
  },
  languageData: {
    commentTokens: { line: '*' },
  },
});

export const psppHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.propertyName, color: 'var(--syn-sub)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.variableName, color: 'var(--syn-var)' },
  { tag: tags.atom, color: 'var(--syn-atom)', fontWeight: '500' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-func)' },
  { tag: tags.operator, color: 'var(--syn-op)' },
  { tag: tags.invalid, color: 'var(--error)', textDecoration: 'underline wavy' },
  { tag: tags.meta, color: 'var(--syn-data)' },
]);

export function pspp() {
  return [psppStream, syntaxHighlighting(psppHighlight)];
}

const commandCompletions: Completion[] = PSPP_COMMANDS.map((c) => ({ label: c, type: 'keyword', boost: ['FREQUENCIES', 'DESCRIPTIVES', 'COMPUTE', 'RECODE', 'CROSSTABS', 'T-TEST', 'MEANS', 'REGRESSION', 'EXAMINE', 'CORRELATIONS', 'SORT CASES', 'SELECT IF'].includes(c) ? 2 : 0 }));

/** Finds the command of the statement that contains the position. */
function currentCommand(text: string): string | null {
  const before = text.split(/\.\s*\n|\n\s*\n/).pop() ?? '';
  const words = before.trimStart().split(/[\s/=]+/).slice(0, 4);
  return matchCommand(words)?.name ?? null;
}

export function psppCompletion(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[\w.$#@-]*/);
  if (!word) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const lineBefore = line.text.slice(0, word.from - line.from);
  const textBefore = ctx.state.sliceDoc(Math.max(0, ctx.pos - 4000), word.from);
  const prevNonBlank = textBefore.replace(/\s+$/, '');
  const atCommandStart = lineBefore.trim() === '' && (prevNonBlank === '' || prevNonBlank.endsWith('.') || /\n\s*\n\s*$/.test(textBefore));
  if (word.from === word.to && !ctx.explicit) return null;
  if (atCommandStart) {
    return { from: word.from, options: commandCompletions, validFor: /^[\w -]*$/ };
  }
  if (/\/\s*$/.test(lineBefore)) {
    const cmd = currentCommand(textBefore);
    const subs = (cmd && SUBCOMMANDS[cmd]) || [];
    return { from: word.from, options: subs.map((s) => ({ label: s, type: 'property', apply: `${s}=` })), validFor: /^[\w-]*$/ };
  }
  const options: Completion[] = [
    ...varList.map((v) => ({ label: v.name, type: 'variable', detail: v.label || undefined, boost: 3 })),
    ...FUNCTIONS.map((f) => ({ label: f, type: 'function', apply: `${f}(`, boost: -1 })),
    ...[...KEYWORDS].map((k) => ({ label: k, type: 'keyword', boost: -2 })),
  ];
  return { from: word.from, options, validFor: /^[\w.$#@]*$/ };
}
