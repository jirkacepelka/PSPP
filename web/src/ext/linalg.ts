/*
 * Dense linear algebra for extension analyses (small matrices: parameters, variables).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export type Matrix = number[][];

export const zeros = (r: number, c: number): Matrix => Array.from({ length: r }, () => new Array(c).fill(0));
export const identity = (n: number): Matrix => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const transpose = (a: Matrix): Matrix => (a.length ? a[0].map((_, j) => a.map((r) => r[j])) : []);

export function matmul(a: Matrix, b: Matrix): Matrix {
  const out = zeros(a.length, b[0]?.length ?? 0);
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < b.length; k++) {
      const x = a[i][k];
      if (x === 0) continue;
      for (let j = 0; j < b[0].length; j++) out[i][j] += x * b[k][j];
    }
  return out;
}
export const matvec = (a: Matrix, v: number[]): number[] => a.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));

/** Inverse by Gauss–Jordan with partial pivoting; null when singular (pivot < TOL). */
export function inverse(a: Matrix, tol = 1e-12): Matrix | null {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...identity(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < tol) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}

/** Solves A x = b; null when singular. */
export function solve(a: Matrix, b: number[]): number[] | null {
  const inv = inverse(a);
  return inv ? matvec(inv, b) : null;
}

/** Log-determinant of a symmetric positive definite matrix via Cholesky; null if not PD. */
export function logDetSpd(a: Matrix): number | null {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
      if (i === j) {
        if (s <= 0) return null;
        l[i][i] = Math.sqrt(s);
      } else l[i][j] = s / l[j][j];
    }
  return 2 * l.reduce((s, r, i) => s + Math.log(r[i]), 0);
}
