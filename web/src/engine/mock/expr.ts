/*
 * Tiny PSPP expression evaluator used by the mock engine (COMPUTE, IF, SELECT IF).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Token } from '../../lib/syntax';

export type Value = number | string | null;
export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'fn'; name: string; args: Node[] };

const BIN_PREC: Record<string, number> = {
  OR: 1, AND: 2, '=': 4, EQ: 4, '<>': 4, '~=': 4, NE: 4, '<': 4, LT: 4, '>': 4, GT: 4, '<=': 4, LE: 4, '>=': 4, GE: 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '**': 8,
};

export class ExprError extends Error {}

export function parseExpression(tokens: Token[]): Node {
  let i = 0;
  const peek = () => tokens[i];
  const opOf = (t: Token | undefined): string | null => {
    if (!t) return null;
    if (t.t === 'punct' && t.v in BIN_PREC) return t.v;
    if (t.t === 'id' && t.v.toUpperCase() in BIN_PREC) return t.v.toUpperCase();
    return null;
  };
  const primary = (): Node => {
    const t = tokens[i++];
    if (!t) throw new ExprError('Unexpected end of expression');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'punct' && t.v === '(') {
      const e = expr(0);
      const c = tokens[i++];
      if (!c || c.v !== ')') throw new ExprError('Missing )');
      return e;
    }
    if (t.t === 'punct' && t.v === '-') return { k: 'un', op: '-', a: expr(7) };
    if (t.t === 'punct' && t.v === '+') return expr(7);
    if (t.t === 'punct' && t.v === '~') return { k: 'un', op: 'NOT', a: expr(3) };
    if (t.t === 'id') {
      const up = t.v.toUpperCase();
      if (up === 'NOT') return { k: 'un', op: 'NOT', a: expr(3) };
      const n = peek();
      if (n && n.t === 'punct' && n.v === '(') {
        i++;
        const args: Node[] = [];
        if (!(peek()?.t === 'punct' && peek()?.v === ')')) {
          for (;;) {
            args.push(expr(0));
            const s = tokens[i++];
            if (!s) throw new ExprError('Missing )');
            if (s.v === ')') break;
            if (s.v !== ',') throw new ExprError(`Unexpected ${String(s.v)}`);
          }
        } else i++;
        return { k: 'fn', name: up.replace(/\.\d+$/, ''), args };
      }
      return { k: 'var', name: t.v };
    }
    throw new ExprError(`Unexpected ${String(t.v)}`);
  };
  const expr = (minPrec: number): Node => {
    let left = primary();
    for (;;) {
      const op = opOf(peek());
      if (!op) break;
      const p = BIN_PREC[op];
      if (p < minPrec || (p === minPrec && op !== '**')) break;
      i++;
      const right = expr(op === '**' ? p : p + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  };
  const e = expr(0);
  if (i < tokens.length) throw new ExprError(`Unexpected ${String(tokens[i].v)}`);
  return e;
}

const nums = (vals: Value[]) => vals.filter((v): v is number => typeof v === 'number');

export function evaluate(node: Node, get: (name: string) => Value): Value {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'var': return get(node.name);
    case 'un': {
      const a = evaluate(node.a, get);
      if (node.op === '-') return typeof a === 'number' ? -a : null;
      return a === null ? null : a ? 0 : 1;
    }
    case 'bin': {
      const a = evaluate(node.a, get);
      const b = evaluate(node.b, get);
      const op = node.op;
      if (op === 'AND') return a === 0 || b === 0 ? 0 : a === null || b === null ? null : 1;
      if (op === 'OR') return a === 1 || b === 1 || (typeof a === 'number' && a !== 0) || (typeof b === 'number' && b !== 0) ? 1 : a === null || b === null ? null : 0;
      if (a === null || b === null) return null;
      const cmp = (r: boolean) => (r ? 1 : 0);
      switch (op) {
        case '=': case 'EQ': return cmp(typeof a === 'string' ? a.trimEnd() === String(b).trimEnd() : a === b);
        case '<>': case '~=': case 'NE': return cmp(typeof a === 'string' ? a.trimEnd() !== String(b).trimEnd() : a !== b);
        case '<': case 'LT': return cmp(a < b);
        case '>': case 'GT': return cmp(a > b);
        case '<=': case 'LE': return cmp(a <= b);
        case '>=': case 'GE': return cmp(a >= b);
      }
      if (typeof a !== 'number' || typeof b !== 'number') return null;
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
        case '**': {
          const r = a ** b;
          return Number.isFinite(r) ? r : null;
        }
      }
      return null;
    }
    case 'fn': {
      const args = node.args.map((a) => evaluate(a, get));
      const n0 = args[0];
      const num1 = (f: (x: number) => number) => {
        if (typeof n0 !== 'number') return null;
        const r = f(n0);
        return Number.isFinite(r) ? r : null;
      };
      switch (node.name) {
        case 'ABS': return num1(Math.abs);
        case 'SQRT': return num1((x) => (x < 0 ? NaN : Math.sqrt(x)));
        case 'LN': return num1((x) => (x <= 0 ? NaN : Math.log(x)));
        case 'LG10': return num1((x) => (x <= 0 ? NaN : Math.log10(x)));
        case 'EXP': return num1(Math.exp);
        case 'TRUNC': return num1(Math.trunc);
        case 'RND': {
          const m = typeof args[1] === 'number' ? args[1] : 1;
          return num1((x) => Math.round(x / m) * m);
        }
        case 'MOD': return typeof n0 === 'number' && typeof args[1] === 'number' && args[1] !== 0 ? n0 % args[1] : null;
        case 'SUM': { const v = nums(args); return v.length ? v.reduce((s, x) => s + x, 0) : null; }
        case 'MEAN': { const v = nums(args); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
        case 'MIN': { const v = nums(args); return v.length ? Math.min(...v) : null; }
        case 'MAX': { const v = nums(args); return v.length ? Math.max(...v) : null; }
        case 'SD': case 'VARIANCE': {
          const v = nums(args);
          if (v.length < 2) return null;
          const m = v.reduce((s, x) => s + x, 0) / v.length;
          const vr = v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
          return node.name === 'SD' ? Math.sqrt(vr) : vr;
        }
        case 'NMISS': return args.filter((a) => a === null).length;
        case 'NVALID': return args.filter((a) => a !== null).length;
        case 'MISSING': case 'SYSMIS': return n0 === null ? 1 : 0;
        case 'VALUE': return n0;
        case 'CONCAT': return args.map((a) => (a === null ? '' : String(a))).join('');
        case 'UPCASE': return typeof n0 === 'string' ? n0.toUpperCase() : null;
        case 'LOWER': return typeof n0 === 'string' ? n0.toLowerCase() : null;
        case 'LENGTH': return typeof n0 === 'string' ? n0.trimEnd().length : null;
        case 'NUMBER': return typeof n0 === 'string' && n0.trim() !== '' && Number.isFinite(Number(n0)) ? Number(n0) : null;
        case 'STRING': return typeof n0 === 'number' ? String(n0) : null;
      }
      throw new ExprError(`Unknown function ${node.name}`);
    }
  }
}

/** Collects variable names referenced by an expression. */
export function referencedVars(node: Node, out = new Set<string>()): Set<string> {
  if (node.k === 'var') out.add(node.name.toUpperCase());
  else if (node.k === 'un') referencedVars(node.a, out);
  else if (node.k === 'bin') {
    referencedVars(node.a, out);
    referencedVars(node.b, out);
  } else if (node.k === 'fn') node.args.forEach((a) => referencedVars(a, out));
  return out;
}
