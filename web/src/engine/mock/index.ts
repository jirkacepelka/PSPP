/*
 * Mock engine: a small JavaScript stand-in for the PSPP WebAssembly engine.
 * Implements CSV import/export and a handful of commands so the UI is fully demo-able.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Dataset, EngineApi, OutputItem, RunResult, Variable } from '../types';
import { splitCommands, tokenize, isCommentCommand, type Token } from '../../lib/syntax';
import { matchCommand, PSPP_COMMANDS, PSPP_UNIMPLEMENTED } from '../../lib/commands';
import { datasetToDelimited, delimitedToDataset } from '../../lib/csv';
import { formatCell, isMissingValue, valueLabelFor } from '../../lib/format';
import { makeVariable } from '../../lib/variables';
import { buildTable, type TCell } from './html';
import { moments, mode, percentile, type WV } from './stats';
import { evaluate, parseExpression, referencedVars } from './expr';

let idCounter = 0;
export const uid = (p = 'i') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class CmdError extends Error {}

interface Ctx {
  ds: Dataset;
  changed: boolean;
  items: OutputItem[];
  line: number;
}

function clone(ds: Dataset): Dataset {
  return { ...ds, variables: ds.variables.map((v) => ({ ...v })), columns: ds.columns.map((c) => c.slice()), split: [...(ds.split ?? [])] };
}

function nCases(ds: Dataset) {
  return Math.max(0, ...ds.columns.map((c) => c.length));
}

function varIndex(ds: Dataset, name: string): number {
  const up = name.toUpperCase();
  return ds.variables.findIndex((v) => v.name.toUpperCase() === up);
}

function requireVar(ds: Dataset, name: string): number {
  const i = varIndex(ds, name);
  if (i < 0) throw new CmdError(`${name} is not a variable name.`);
  return i;
}

/** Splits tokens into the head and `/SUBCOMMAND` chunks. */
function subcommands(toks: Token[]): { name: string; toks: Token[] }[] {
  const out: { name: string; toks: Token[] }[] = [{ name: '', toks: [] }];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'punct' && t.v === '/') {
      const n = toks[i + 1];
      const name = n && n.t === 'id' ? n.v.toUpperCase() : '';
      out.push({ name, toks: [] });
      if (n && n.t === 'id') i++;
      if (toks[i + 1]?.t === 'punct' && toks[i + 1].v === '=') i++;
      continue;
    }
    out[out.length - 1].toks.push(t);
  }
  return out;
}

/** Expands a variable list (supports TO and ALL). Stops at a non-identifier token or keyword in `stop`. */
function varList(ds: Dataset, toks: Token[], start = 0, stop: string[] = []): { names: string[]; next: number } {
  const names: string[] = [];
  let i = start;
  while (i < toks.length) {
    const t = toks[i];
    if (t.t !== 'id' || stop.includes(t.v.toUpperCase())) break;
    if (t.v.toUpperCase() === 'ALL') {
      names.push(...ds.variables.map((v) => v.name));
      i++;
      continue;
    }
    const n2 = toks[i + 1];
    if (n2 && n2.t === 'id' && n2.v.toUpperCase() === 'TO' && toks[i + 2]?.t === 'id') {
      const a = requireVar(ds, t.v);
      const b = requireVar(ds, String(toks[i + 2].v));
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) names.push(ds.variables[k].name);
      i += 3;
      continue;
    }
    requireVar(ds, t.v);
    names.push(ds.variables[varIndex(ds, t.v)].name);
    i++;
    if (toks[i]?.t === 'punct' && toks[i].v === ',') i++;
  }
  return { names, next: i };
}

function includedCases(ds: Dataset): { row: number; w: number }[] {
  const n = nCases(ds);
  const fi = ds.filter ? varIndex(ds, ds.filter) : -1;
  const wi = ds.weight ? varIndex(ds, ds.weight) : -1;
  const out: { row: number; w: number }[] = [];
  for (let r = 0; r < n; r++) {
    if (fi >= 0) {
      const f = ds.columns[fi][r];
      if (f === null || f === 0 || f === undefined) continue;
    }
    let w = 1;
    if (wi >= 0) {
      const wv = ds.columns[wi][r];
      if (typeof wv !== 'number' || wv <= 0) continue;
      w = wv;
    }
    out.push({ row: r, w });
  }
  return out;
}

function fmtStat(x: number, d = 2): number | string {
  return Number.isFinite(x) ? Number(x.toFixed(d)) : '.';
}

function cellValue(v: Variable, c: Cell): string {
  if (c === null) return 'System missing';
  return formatCell(c, v);
}

// ---------------------------------------------------------------- procedures

function frequencies(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  const subs = subcommands(toks);
  let vars: string[] = [];
  let stats = new Set<string>(['MEAN', 'STDDEV', 'MINIMUM', 'MAXIMUM']);
  let showTable = true;
  let order: 'AVALUE' | 'DVALUE' | 'AFREQ' | 'DFREQ' = 'AVALUE';
  const pct: number[] = [];
  const charts: string[] = [];
  for (const s of subs) {
    if (s.name === '' || s.name === 'VARIABLES') {
      let tk = s.toks;
      if (tk[0]?.t === 'id' && tk[0].v.toUpperCase() === 'VARIABLES') tk = tk.slice(tk[1]?.v === '=' ? 2 : 1);
      if (tk.length) vars = vars.concat(varList(ds, tk).names);
    } else if (s.name === 'STATISTICS') {
      const words = s.toks.filter((t) => t.t === 'id').map((t) => String(t.v).toUpperCase());
      stats = new Set();
      for (const w of words.length ? words : ['DEFAULT']) {
        if (w === 'ALL') ['MEAN', 'SEMEAN', 'MEDIAN', 'MODE', 'STDDEV', 'VARIANCE', 'SKEWNESS', 'SESKEW', 'KURTOSIS', 'SEKURT', 'RANGE', 'MINIMUM', 'MAXIMUM', 'SUM'].forEach((x) => stats.add(x));
        else if (w === 'DEFAULT') ['MEAN', 'STDDEV', 'MINIMUM', 'MAXIMUM'].forEach((x) => stats.add(x));
        else if (w !== 'NONE') stats.add(w);
      }
    } else if (s.name === 'FORMAT') {
      for (const t of s.toks) {
        const w = String(t.v).toUpperCase();
        if (w === 'NOTABLE') showTable = false;
        if (w === 'TABLE') showTable = true;
        if (['AVALUE', 'DVALUE', 'AFREQ', 'DFREQ'].includes(w)) order = w as typeof order;
      }
    } else if (s.name === 'PERCENTILES') {
      s.toks.filter((t) => t.t === 'num').forEach((t) => pct.push(Number(t.v)));
    } else if (s.name === 'NTILES') {
      const n = Number(s.toks.find((t) => t.t === 'num')?.v ?? 0);
      for (let k = 1; k < n; k++) pct.push((100 * k) / n);
    } else if (['BARCHART', 'HISTOGRAM', 'PIECHART'].includes(s.name)) charts.push(s.name);
    else if (s.name === 'MISSING' || s.name === 'ORDER' || s.name === 'GROUPED') {
      /* accepted */
    } else throw new CmdError(`FREQUENCIES: Unknown subcommand ${s.name}.`);
  }
  if (!vars.length) throw new CmdError('FREQUENCIES: Syntax error expecting variable name.');
  const cases = includedCases(ds);
  const children: OutputItem[] = [];
  const statNames: [string, string][] = [
    ['MEAN', 'Mean'], ['SEMEAN', 'S.E. Mean'], ['MEDIAN', 'Median'], ['MODE', 'Mode'], ['STDDEV', 'Std Dev'], ['VARIANCE', 'Variance'],
    ['SKEWNESS', 'Skewness'], ['SESKEW', 'S.E. Skew'], ['KURTOSIS', 'Kurtosis'], ['SEKURT', 'S.E. Kurt'], ['RANGE', 'Range'],
    ['MINIMUM', 'Minimum'], ['MAXIMUM', 'Maximum'], ['SUM', 'Sum'],
  ];
  const perVar = vars.map((name) => {
    const vi = varIndex(ds, name);
    const v = ds.variables[vi];
    const data: WV[] = [];
    let missingW = 0;
    for (const { row, w } of cases) {
      const c = ds.columns[vi][row] ?? null;
      if (isMissingValue(c, v) || typeof c !== 'number') {
        if (v.type === 'string' && c !== null && !isMissingValue(c, v)) continue;
        missingW += w;
      } else data.push({ x: c, w });
    }
    return { v, vi, data, missingW, m: moments(data) };
  });
  // Statistics table
  const statRows: TCell[][] = [
    [{ v: 'N', th: true, rowspan: 2 }, { v: 'Valid', th: true }, ...perVar.map((p) => p.m.n)],
    [{ v: 'Missing', th: true }, ...perVar.map((p) => p.missingW)],
  ];
  for (const [k, label] of statNames) {
    if (!stats.has(k)) continue;
    statRows.push([
      { v: label, th: true, colspan: 2 },
      ...perVar.map((p) => {
        const m = p.m;
        if (p.v.type === 'string') return null;
        const val: Record<string, number> = {
          MEAN: m.mean, SEMEAN: m.se, MEDIAN: percentile(p.data, 50), MODE: mode(p.data), STDDEV: m.sd, VARIANCE: m.variance,
          SKEWNESS: m.skewness, SESKEW: m.seSkew, KURTOSIS: m.kurtosis, SEKURT: m.seKurt, RANGE: m.max - m.min, MINIMUM: m.min, MAXIMUM: m.max, SUM: m.sum,
        };
        return fmtStat(val[k]);
      }),
    ]);
  }
  pct.forEach((p, idx) => {
    statRows.push([
      ...(idx === 0 ? [{ v: 'Percentiles', th: true, rowspan: pct.length } as TCell] : []),
      { v: String(Number(p.toFixed(2))), th: true },
      ...perVar.map((pv) => (pv.v.type === 'string' ? null : fmtStat(percentile(pv.data, p)))),
    ]);
  });
  children.push({
    id: uid('t'),
    kind: 'table',
    title: 'Statistics',
    command: 'FREQUENCIES',
    html: buildTable({ title: 'Statistics', head: [[{ v: '', colspan: 2 }, ...perVar.map((p) => p.v.label || p.v.name)]], body: statRows }),
  });
  for (const p of perVar) {
    const { v, vi } = p;
    const counts = new Map<string, { c: Cell; w: number; missing: boolean }>();
    let total = 0;
    let validTotal = 0;
    for (const { row, w } of cases) {
      const c = ds.columns[vi][row] ?? null;
      const key = c === null ? '\u0000sys' : String(c);
      const missing = isMissingValue(c, v);
      const e = counts.get(key) ?? { c, w: 0, missing };
      e.w += w;
      counts.set(key, e);
      total += w;
      if (!missing) validTotal += w;
    }
    const entries = [...counts.values()];
    const cmp = (a: (typeof entries)[0], b: (typeof entries)[0]) => {
      if (order === 'AFREQ') return a.w - b.w;
      if (order === 'DFREQ') return b.w - a.w;
      const r = typeof a.c === 'number' && typeof b.c === 'number' ? a.c - b.c : String(a.c).localeCompare(String(b.c));
      return order === 'DVALUE' ? -r : r;
    };
    const valid = entries.filter((e) => !e.missing).sort(cmp);
    const miss = entries.filter((e) => e.missing).sort(cmp);
    if (showTable) {
      const body: TCell[][] = [];
      let cum = 0;
      valid.forEach((e, i) => {
        cum += e.w;
        body.push([
          ...(i === 0 ? [{ v: 'Valid', th: true, rowspan: valid.length + 1 } as TCell] : []),
          { v: e.c === null ? '' : valueLabelFor(e.c, v) ?? cellValue(v, e.c), th: true },
          e.w,
          fmtStat((100 * e.w) / total, 1),
          fmtStat((100 * e.w) / validTotal, 1),
          fmtStat((100 * cum) / validTotal, 1),
        ]);
      });
      body.push([{ v: 'Total', th: true, cls: 'total' }, validTotal, fmtStat((100 * validTotal) / (total || 1), 1), 100, null]);
      if (miss.length) {
        miss.forEach((e, i) => {
          body.push([
            ...(i === 0 ? [{ v: 'Missing', th: true, rowspan: miss.length } as TCell] : []),
            { v: e.c === null ? 'System' : valueLabelFor(e.c, v) ?? cellValue(v, e.c), th: true },
            e.w,
            fmtStat((100 * e.w) / total, 1),
            null,
            null,
          ]);
        });
      }
      body.push([{ v: 'Total', th: true, colspan: 2, cls: 'total' }, total, 100, null, null]);
      const title = v.label ? `${v.label}` : v.name;
      children.push({
        id: uid('t'),
        kind: 'table',
        title,
        command: 'FREQUENCIES',
        html: buildTable({
          title,
          decimals: 1,
          head: [[{ v: '', colspan: 2 }, 'Frequency', 'Percent', 'Valid Percent', 'Cumulative Percent']],
          body,
        }),
      });
    }
    for (const ch of charts) {
      if (ch === 'HISTOGRAM' && v.type === 'numeric' && p.data.length) {
        const bins = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(p.m.n))));
        const lo = p.m.min;
        const hi = p.m.max === lo ? lo + 1 : p.m.max;
        const width = (hi - lo) / bins;
        const values = new Array(bins).fill(0);
        for (const d of p.data) values[Math.min(bins - 1, Math.floor((d.x - lo) / width))] += d.w;
        children.push({
          id: uid('c'),
          kind: 'chart',
          title: v.label || v.name,
          chart: { type: 'histogram', categories: values.map((_, i) => (lo + i * width).toFixed(1)), values, xLabel: v.label || v.name, yLabel: 'Frequency', mean: p.m.mean, sd: p.m.sd, n: p.m.n },
        });
      } else if (ch === 'BARCHART' || ch === 'PIECHART') {
        children.push({
          id: uid('c'),
          kind: 'chart',
          title: v.label || v.name,
          chart: {
            type: ch === 'PIECHART' ? 'pie' : 'bar',
            categories: valid.map((e) => (e.c === null ? '' : valueLabelFor(e.c, v) ?? cellValue(v, e.c))),
            values: valid.map((e) => e.w),
            xLabel: v.label || v.name,
            yLabel: 'Frequency',
          },
        });
      }
    }
  }
  ctx.items.push({ id: uid('g'), kind: 'group', title: 'Frequencies', command: 'FREQUENCIES', children });
}

function descriptives(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  const subs = subcommands(toks);
  let vars: string[] = [];
  let stats = ['MEAN', 'STDDEV', 'MIN', 'MAX'];
  let save = false;
  const zNames = new Map<string, string>();
  for (const s of subs) {
    if (s.name === '' || s.name === 'VARIABLES') {
      let tk = s.toks;
      if (tk[0]?.t === 'id' && tk[0].v.toUpperCase() === 'VARIABLES') tk = tk.slice(tk[1]?.v === '=' ? 2 : 1);
      let i = 0;
      while (i < tk.length) {
        const r = varList(ds, tk, i);
        vars = vars.concat(r.names);
        i = r.next;
        if (tk[i]?.t === 'punct' && tk[i].v === '(' && tk[i + 1]?.t === 'id') {
          zNames.set(r.names[r.names.length - 1], String(tk[i + 1].v));
          i += 3;
        } else if (i < tk.length && r.next === i) i++;
      }
    } else if (s.name === 'STATISTICS') {
      const w = s.toks.filter((t) => t.t === 'id').map((t) => String(t.v).toUpperCase());
      stats = w.includes('ALL') ? ['MEAN', 'SEMEAN', 'STDDEV', 'VARIANCE', 'KURTOSIS', 'SKEWNESS', 'RANGE', 'MIN', 'MAX', 'SUM'] : w.flatMap((x) => (x === 'DEFAULT' ? ['MEAN', 'STDDEV', 'MIN', 'MAX'] : [x]));
    } else if (s.name === 'SAVE') save = true;
    else if (['MISSING', 'FORMAT', 'SORT'].includes(s.name)) {
      /* accepted */
    } else throw new CmdError(`DESCRIPTIVES: Unknown subcommand ${s.name}.`);
  }
  if (!vars.length) throw new CmdError('DESCRIPTIVES: Syntax error expecting variable name.');
  const cases = includedCases(ds);
  const labels: Record<string, string> = {
    MEAN: 'Mean', SEMEAN: 'S.E. Mean', STDDEV: 'Std Dev', VARIANCE: 'Variance', KURTOSIS: 'Kurtosis', SKEWNESS: 'Skewness', RANGE: 'Range', MIN: 'Minimum', MAX: 'Maximum', SUM: 'Sum',
  };
  const body: TCell[][] = [];
  let listwise = 0;
  for (const { row, w } of cases) {
    if (vars.every((n) => { const vi = varIndex(ds, n); const c = ds.columns[vi][row] ?? null; return typeof c === 'number' && !isMissingValue(c, ds.variables[vi]); })) listwise += w;
  }
  for (const name of vars) {
    const vi = varIndex(ds, name);
    const v = ds.variables[vi];
    if (v.type !== 'numeric') continue;
    const data: WV[] = [];
    for (const { row, w } of cases) {
      const c = ds.columns[vi][row] ?? null;
      if (typeof c === 'number' && !isMissingValue(c, v)) data.push({ x: c, w });
    }
    const m = moments(data);
    const val: Record<string, number> = { MEAN: m.mean, SEMEAN: m.se, STDDEV: m.sd, VARIANCE: m.variance, KURTOSIS: m.kurtosis, SKEWNESS: m.skewness, RANGE: m.max - m.min, MIN: m.min, MAX: m.max, SUM: m.sum };
    body.push([v.label ? `${v.name} – ${v.label}` : v.name, m.n, ...stats.filter((s) => labels[s]).map((s) => fmtStat(val[s]))]);
    if (save || zNames.has(v.name)) {
      let zn = zNames.get(v.name) ?? `Z${v.name}`.slice(0, 64);
      if (varIndex(ds, zn) >= 0) zn = `ZSC${String(ds.variables.length).padStart(3, '0')}`;
      const col: Cell[] = new Array(nCases(ds)).fill(null);
      for (let r = 0; r < col.length; r++) {
        const c = ds.columns[vi][r];
        col[r] = typeof c === 'number' && !isMissingValue(c, v) && m.sd > 0 ? (c - m.mean) / m.sd : null;
      }
      ds.variables.push(makeVariable(zn, { label: `Zscore(${v.name})`, print: { type: 'F', w: 11, d: 5 }, write: { type: 'F', w: 11, d: 5 } }));
      ds.columns.push(col);
      ctx.changed = true;
    }
  }
  body.push(['Valid N (listwise)', listwise, ...stats.filter((s) => labels[s]).map(() => null)]);
  body.push(['Missing N (listwise)', cases.reduce((s, c) => s + c.w, 0) - listwise, ...stats.filter((s) => labels[s]).map(() => null)]);
  ctx.items.push({
    id: uid('g'),
    kind: 'group',
    title: 'Descriptives',
    command: 'DESCRIPTIVES',
    children: [
      {
        id: uid('t'),
        kind: 'table',
        title: 'Descriptive Statistics',
        command: 'DESCRIPTIVES',
        html: buildTable({ title: 'Descriptive Statistics', head: [['', 'N', ...stats.filter((s) => labels[s]).map((s) => labels[s])]], body }),
      },
    ],
  });
}

function list(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  const subs = subcommands(toks);
  let vars = ds.variables.map((v) => v.name);
  for (const s of subs) {
    let tk = s.toks;
    if (tk[0]?.t === 'id' && tk[0].v.toUpperCase() === 'VARIABLES') tk = tk.slice(tk[1]?.v === '=' ? 2 : 1);
    if ((s.name === '' || s.name === 'VARIABLES') && tk.length) vars = varList(ds, tk).names;
  }
  const idx = vars.map((n) => varIndex(ds, n));
  const n = Math.min(nCases(ds), 500);
  const body: TCell[][] = [];
  for (let r = 0; r < n; r++) body.push([String(r + 1), ...idx.map((i) => { const c = ds.columns[i][r] ?? null; return c === null ? '.' : formatCell(c, ds.variables[i]); })]);
  ctx.items.push({
    id: uid('g'), kind: 'group', title: 'List', command: 'LIST',
    children: [{ id: uid('t'), kind: 'table', title: 'Data List', command: 'LIST', html: buildTable({ title: 'Data List', head: [['', ...vars]], body, footnotes: nCases(ds) > n ? [`Showing first ${n} of ${nCases(ds)} cases.`] : undefined }) }],
  });
}

function display(ctx: Ctx) {
  const { ds } = ctx;
  const body: TCell[][] = ds.variables.map((v, i) => [v.name, i + 1, v.label || null, v.measure, v.role, v.columns, v.align, `${v.print.type}${v.print.w}${v.type === 'numeric' ? '.' + v.print.d : ''}`]);
  ctx.items.push({
    id: uid('g'), kind: 'group', title: 'Display', command: 'DISPLAY',
    children: [{ id: uid('t'), kind: 'table', title: 'Variables', command: 'DISPLAY', html: buildTable({ title: 'Variables', head: [['Name', 'Position', 'Label', 'Measurement Level', 'Role', 'Width', 'Alignment', 'Print Format']], body }) }],
  });
}

// ---------------------------------------------------------------- transformations

function sortCases(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  let i = 0;
  if (toks[0]?.t === 'id' && toks[0].v.toUpperCase() === 'BY') i = 1;
  const keys: { vi: number; dir: number }[] = [];
  while (i < toks.length) {
    const r = varList(ds, toks, i);
    if (r.next === i) { i++; continue; }
    i = r.next;
    let dir = 1;
    if (toks[i]?.v === '(') {
      dir = String(toks[i + 1]?.v).toUpperCase().startsWith('D') ? -1 : 1;
      i += 3;
    }
    r.names.forEach((n) => keys.push({ vi: varIndex(ds, n), dir }));
  }
  if (!keys.length) throw new CmdError('SORT CASES: Syntax error expecting variable name.');
  const n = nCases(ds);
  const order = Array.from({ length: n }, (_, k) => k);
  order.sort((a, b) => {
    for (const k of keys) {
      const x = ds.columns[k.vi][a] ?? null;
      const y = ds.columns[k.vi][b] ?? null;
      if (x === y) continue;
      if (x === null) return -k.dir;
      if (y === null) return k.dir;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c) return c * k.dir;
    }
    return a - b;
  });
  ds.columns = ds.columns.map((col) => order.map((r) => col[r] ?? null));
  ctx.changed = true;
}

function compute(ctx: Ctx, toks: Token[], text: string, condition?: Token[]) {
  const { ds } = ctx;
  const eq = toks.findIndex((t) => t.t === 'punct' && t.v === '=');
  if (eq < 1 || toks[0].t !== 'id') throw new CmdError('COMPUTE: Syntax error expecting `='.');
  const target = String(toks[0].v);
  const expr = parseExpression(toks.slice(eq + 1));
  const cond = condition ? parseExpression(condition) : null;
  for (const r of referencedVars(expr)) if (varIndex(ds, r) < 0 && !/^\$/.test(r)) throw new CmdError(`${r} is not a variable name.`);
  let ti = varIndex(ds, target);
  const n = nCases(ds);
  if (ti < 0) {
    ds.variables.push(makeVariable(target));
    ds.columns.push(new Array(n).fill(null));
    ti = ds.variables.length - 1;
  }
  const col = ds.columns[ti].slice();
  const getter = (r: number) => (name: string) => {
    if (name.toUpperCase() === '$CASENUM') return r + 1;
    const vi = varIndex(ds, name);
    const c = ds.columns[vi][r] ?? null;
    return isMissingValue(c, ds.variables[vi]) && ds.variables[vi].type === 'numeric' ? null : c;
  };
  for (let r = 0; r < n; r++) {
    if (cond && evaluate(cond, getter(r)) !== 1) continue;
    const v = evaluate(expr, getter(r));
    col[r] = ds.variables[ti].type === 'string' ? (v === null ? '' : String(v)) : typeof v === 'number' ? v : null;
  }
  ds.columns[ti] = col;
  ctx.changed = true;
  void text;
}

function selectIf(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  const expr = parseExpression(toks);
  const n = nCases(ds);
  const keep: number[] = [];
  for (let r = 0; r < n; r++) {
    const v = evaluate(expr, (name) => {
      if (name.toUpperCase() === '$CASENUM') return r + 1;
      const vi = requireVar(ds, name);
      return ds.columns[vi][r] ?? null;
    });
    if (v === 1) keep.push(r);
  }
  ds.columns = ds.columns.map((c) => keep.map((r) => c[r] ?? null));
  ctx.changed = true;
}

function recode(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  let i = 0;
  // RECODE varlist (spec)... [/varlist (spec)...] [INTO targets]
  const groups: { vars: string[]; specs: { from: Token[][]; to: Token[] }[]; into: string[] }[] = [];
  while (i < toks.length) {
    if (toks[i].v === '/') { i++; continue; }
    const r = varList(ds, toks, i, ['INTO']);
    i = r.next;
    const specs: { from: Token[][]; to: Token[] }[] = [];
    while (toks[i]?.v === '(') {
      const close = toks.findIndex((t, k) => k > i && t.v === ')');
      const inner = toks.slice(i + 1, close);
      const eq = inner.findIndex((t) => t.v === '=');
      const fromToks = inner.slice(0, eq);
      const from: Token[][] = [[]];
      for (const t of fromToks) {
        if (t.v === ',') from.push([]);
        else from[from.length - 1].push(t);
      }
      specs.push({ from, to: inner.slice(eq + 1) });
      i = close + 1;
    }
    let into: string[] = [];
    if (toks[i]?.t === 'id' && String(toks[i].v).toUpperCase() === 'INTO') {
      i++;
      while (toks[i]?.t === 'id') into.push(String(toks[i++].v));
    }
    if (!r.names.length || !specs.length) throw new CmdError('RECODE: Syntax error.');
    groups.push({ vars: r.names, specs, into });
    if (i < toks.length && toks[i].v !== '/') throw new CmdError(`RECODE: Syntax error at ${String(toks[i].v)}.`);
  }
  const n = nCases(ds);
  for (const g of groups) {
    g.vars.forEach((name, k) => {
      const si = varIndex(ds, name);
      const sv = ds.variables[si];
      let ti = si;
      if (g.into.length) {
        ti = varIndex(ds, g.into[k]);
        if (ti < 0) {
          const isStr = g.specs.some((s) => s.to[0]?.t === 'str');
          ds.variables.push(makeVariable(g.into[k], isStr ? { type: 'string', width: 8 } : {}));
          ds.columns.push(new Array(n).fill(isStr ? '' : null));
          ti = ds.variables.length - 1;
        }
      }
      const src = ds.columns[si];
      const out = ds.columns[ti].slice();
      for (let r = 0; r < n; r++) {
        const c = src[r] ?? null;
        for (const s of g.specs) {
          const matches = s.from.some((f) => {
            const w = f.map((t) => (t.t === 'id' ? String(t.v).toUpperCase() : t.v));
            if (w[0] === 'ELSE') return true;
            if (w[0] === 'SYSMIS') return c === null;
            if (w[0] === 'MISSING') return isMissingValue(c, sv);
            const thru = w.indexOf('THRU');
            if (thru >= 0 && typeof c === 'number') {
              const lo = w[0] === 'LOWEST' || w[0] === 'LO' ? -Infinity : Number(w[0]);
              const hi = w[thru + 1] === 'HIGHEST' || w[thru + 1] === 'HI' ? Infinity : Number(w[thru + 1]);
              return c >= lo && c <= hi;
            }
            return w.length === 1 && (typeof c === 'string' ? c.trimEnd() === String(w[0]) : c === w[0]);
          });
          if (matches) {
            const tw = s.to.map((t) => (t.t === 'id' ? String(t.v).toUpperCase() : t.v));
            if (tw[0] === 'COPY') out[r] = c;
            else if (tw[0] === 'SYSMIS') out[r] = null;
            else out[r] = s.to[0]?.t === 'str' ? String(s.to[0].v) : typeof tw[0] === 'number' ? tw[0] : tw[0] === '-' && typeof tw[1] === 'number' ? -tw[1] : null;
            break;
          }
        }
      }
      ds.columns[ti] = out;
    });
  }
  ctx.changed = true;
}

function variableLabels(ctx: Ctx, toks: Token[]) {
  const { ds } = ctx;
  let i = 0;
  while (i < toks.length) {
    if (toks[i].v === '/') { i++; continue; }
    const r = varList(ds, toks, i);
    i = r.next;
    const s = toks[i];
    if (!s || s.t !== 'str') throw new CmdError('VARIABLE LABELS: Syntax error expecting string.');
    r.names.forEach((n) => (ds.variables[varIndex(ds, n)] = { ...ds.variables[varIndex(ds, n)], label: s.v }));
    i++;
  }
  ctx.changed = true;
}

function valueLabels(ctx: Ctx, toks: Token[], add: boolean) {
  const { ds } = ctx;
  let i = 0;
  while (i < toks.length) {
    if (toks[i].v === '/') { i++; continue; }
    const r = varList(ds, toks, i);
    if (r.next === i) throw new CmdError('VALUE LABELS: Syntax error expecting variable name.');
    i = r.next;
    const labels: { value: number | string; label: string }[] = [];
    while (i < toks.length && toks[i].v !== '/') {
      let val: number | string;
      if (toks[i].v === '-' && toks[i + 1]?.t === 'num') { val = -Number(toks[i + 1].v); i += 2; }
      else { val = toks[i].v as number | string; i++; }
      const l = toks[i];
      if (!l || l.t !== 'str') throw new CmdError('VALUE LABELS: Syntax error expecting string.');
      labels.push({ value: val, label: l.v });
      i++;
    }
    for (const n of r.names) {
      const vi = varIndex(ds, n);
      const old = add ? ds.variables[vi].valueLabels.filter((x) => !labels.some((l) => l.value === x.value)) : [];
      ds.variables[vi] = { ...ds.variables[vi], valueLabels: [...old, ...labels].sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value)))) };
    }
  }
  ctx.changed = true;
}

// ---------------------------------------------------------------- driver

const SUPPORTED = new Set([
  'FREQUENCIES', 'DESCRIPTIVES', 'LIST', 'DISPLAY', 'SORT CASES', 'WEIGHT', 'FILTER', 'SPLIT FILE', 'COMPUTE', 'IF', 'SELECT IF', 'RECODE',
  'VARIABLE LABELS', 'VALUE LABELS', 'ADD VALUE LABELS', 'EXECUTE', 'TITLE', 'SUBTITLE', 'ECHO', 'COMMENT', 'DELETE VARIABLES', 'N OF CASES', 'FILE LABEL', 'DOCUMENT', 'SET', 'SHOW', 'FINISH', 'EXIT', 'NEW FILE',
]);

function runOne(ctx: Ctx, text: string) {
  const toks = tokenize(text);
  const words: string[] = [];
  for (const t of toks) {
    if (t.t !== 'id') break;
    words.push(String(t.v));
    if (words.length >= 4) break;
  }
  if (words.length === 0) throw new CmdError(`Syntax error at \`${String(toks[0]?.v ?? '')}': expecting command name.`);
  const m = matchCommand(words);
  if (!m) {
    if (PSPP_UNIMPLEMENTED.some((u) => u.split(' ')[0] === words[0].toUpperCase())) throw new CmdError(`${words[0].toUpperCase()} is not yet implemented.`);
    throw new CmdError(`Unknown command \`${words.slice(0, 2).join(' ')}'.`);
  }
  const rest = toks.slice(m.words);
  const { ds } = ctx;
  if (!SUPPORTED.has(m.name)) {
    ctx.items.push({ id: uid('m'), kind: 'message', severity: 'warning', line: ctx.line, text: `${m.name}: the demo engine cannot run this command. It will run once the PSPP WebAssembly engine is available.` });
    return;
  }
  const ids = rest.filter((t) => t.t === 'id').map((t) => String(t.v).toUpperCase());
  switch (m.name) {
    case 'FREQUENCIES': return frequencies(ctx, rest);
    case 'DESCRIPTIVES': return descriptives(ctx, rest);
    case 'LIST': return list(ctx, rest);
    case 'DISPLAY': return display(ctx);
    case 'SORT CASES': return sortCases(ctx, rest);
    case 'WEIGHT':
      if (ids[0] === 'OFF') ds.weight = null;
      else {
        const v = ds.variables[requireVar(ds, ids[1] ?? '')];
        if (v.type !== 'numeric') throw new CmdError('WEIGHT: The weighting variable must be numeric.');
        ds.weight = v.name;
      }
      ctx.changed = true;
      return;
    case 'FILTER':
      if (ids[0] === 'OFF') ds.filter = null;
      else ds.filter = ds.variables[requireVar(ds, ids[1] ?? '')].name;
      ctx.changed = true;
      return;
    case 'SPLIT FILE':
      if (ids[0] === 'OFF') ds.split = [];
      else ds.split = varList(ds, rest.filter((t) => !(t.t === 'id' && ['BY', 'LAYERED', 'SEPARATE'].includes(String(t.v).toUpperCase())))).names;
      ctx.changed = true;
      if (ds.split.length) ctx.items.push({ id: uid('m'), kind: 'message', severity: 'note', line: ctx.line, text: 'SPLIT FILE: the demo engine records the split but does not split procedure output.' });
      return;
    case 'COMPUTE': return compute(ctx, rest, text);
    case 'IF': {
      const close = (() => { let depth = 0; for (let k = 0; k < rest.length; k++) { if (rest[k].v === '(') depth++; if (rest[k].v === ')') { depth--; if (depth === 0) return k; } } return -1; })();
      if (rest[0]?.v !== '(' || close < 0) throw new CmdError('IF: Syntax error expecting `(\'.');
      return compute(ctx, rest.slice(close + 1), text, rest.slice(1, close));
    }
    case 'SELECT IF': return selectIf(ctx, rest);
    case 'RECODE': return recode(ctx, rest);
    case 'VARIABLE LABELS': return variableLabels(ctx, rest);
    case 'VALUE LABELS': return valueLabels(ctx, rest, false);
    case 'ADD VALUE LABELS': return valueLabels(ctx, rest, true);
    case 'DELETE VARIABLES': {
      const names = varList(ds, rest).names.map((n) => n.toUpperCase());
      const keep = ds.variables.map((v, k) => (names.includes(v.name.toUpperCase()) ? -1 : k)).filter((k) => k >= 0);
      ds.variables = keep.map((k) => ds.variables[k]);
      ds.columns = keep.map((k) => ds.columns[k]);
      ctx.changed = true;
      return;
    }
    case 'N OF CASES': {
      const n = Number(rest.find((t) => t.t === 'num')?.v ?? NaN);
      if (!Number.isFinite(n)) throw new CmdError('N OF CASES: Syntax error expecting positive integer.');
      ds.columns = ds.columns.map((c) => c.slice(0, n));
      ctx.changed = true;
      return;
    }
    case 'TITLE': case 'SUBTITLE': {
      const s = rest.find((t) => t.t === 'str')?.v ?? text.replace(/^\s*\S+\s*/, '').replace(/\.\s*$/, '');
      ctx.items.push({ id: uid('x'), kind: 'text', subtype: m.name === 'TITLE' ? 'title' : 'subtitle', text: String(s) });
      return;
    }
    case 'ECHO':
      ctx.items.push({ id: uid('x'), kind: 'text', subtype: 'log', text: String(rest.find((t) => t.t === 'str')?.v ?? '') });
      return;
    case 'FILE LABEL':
      ds.fileLabel = String(rest.find((t) => t.t === 'str')?.v ?? text.replace(/^\s*FILE\s+LABEL\s*/i, '').replace(/\.\s*$/, ''));
      ctx.changed = true;
      return;
    case 'DOCUMENT':
      ds.documents = [...(ds.documents ?? []), text.replace(/^\s*DOCUMENT\s*/i, '').replace(/\.\s*$/, '')];
      ctx.changed = true;
      return;
    case 'NEW FILE':
      ctx.ds = { name: ds.name, variables: [], columns: [], weight: null, filter: null, split: [], documents: [] };
      ctx.changed = true;
      return;
    case 'SHOW':
      ctx.items.push({ id: uid('t'), kind: 'table', title: 'Settings', command: 'SHOW', html: buildTable({ title: 'Settings', head: [['Setting', 'Value']], body: [['ENGINE', 'PSPP Studio demo engine (JavaScript)'], ['DECIMAL', 'DOT'], ['WEIGHT', ds.weight ?? 'Off'], ['FILTER', ds.filter ?? 'Off'], ['SPLIT', ds.split?.join(', ') || 'Off']] }) });
      return;
    default:
      return; // EXECUTE, COMMENT, SET, FINISH...
  }
}

export function createMockEngine(): EngineApi {
  return {
    async init() {
      return { version: 'PSPP Studio demo engine 0.1 (JavaScript mock)' };
    },
    async open(file) {
      const lower = file.name.toLowerCase();
      const text = () => new TextDecoder('utf-8').decode(file.bytes);
      const base = file.name.replace(/\.[^.]+$/, '');
      if (lower.endsWith('.sps') || lower.endsWith('.pspp')) return { syntax: text() };
      if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv') || lower.endsWith('.dat')) {
        return { dataset: delimitedToDataset(text(), base, lower.endsWith('.tsv') ? { delimiter: '\t' } : {}) };
      }
      if (lower.endsWith('.json')) {
        const ds = JSON.parse(text()) as Dataset;
        if (!Array.isArray(ds.variables) || !Array.isArray(ds.columns)) throw new Error('Invalid dataset JSON');
        return { dataset: ds };
      }
      throw new Error(`MOCK_UNSUPPORTED:${file.name}`);
    },
    async save(dataset, format) {
      if (format === 'csv') return new TextEncoder().encode(datasetToDelimited(dataset));
      throw new Error(`MOCK_UNSUPPORTED:${format}`);
    },
    async run(syntax, dataset): Promise<RunResult> {
      const ctx: Ctx = { ds: dataset ? clone(dataset) : { name: 'Untitled', variables: [], columns: [], weight: null, filter: null, split: [] }, changed: false, items: [], line: 1 };
      let ok = true;
      for (const cmd of splitCommands(syntax)) {
        if (isCommentCommand(cmd.text)) continue;
        ctx.line = cmd.startLine;
        try {
          runOne(ctx, cmd.text);
        } catch (e) {
          ok = false;
          const msg = e instanceof Error ? e.message : String(e);
          ctx.items.push({ id: uid('m'), kind: 'message', severity: 'error', line: cmd.startLine, text: msg });
        }
      }
      // keep columns aligned in length
      const n = Math.max(0, ...ctx.ds.columns.map((c) => c.length));
      ctx.ds.columns = ctx.ds.columns.map((c, i) => (c.length < n ? [...c, ...new Array(n - c.length).fill(ctx.ds.variables[i]?.type === 'string' ? '' : null)] : c));
      return { items: ctx.items, dataset: ctx.changed ? ctx.ds : null, ok };
    },
  };
}

export const KNOWN_COMMANDS = PSPP_COMMANDS;
