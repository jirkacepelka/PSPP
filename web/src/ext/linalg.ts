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

/** Cholesky factor L (lower triangular, A = L Lᵀ) of a symmetric positive definite matrix; null if not PD. */
export function cholesky(a: Matrix): Matrix | null {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        l[i][i] = Math.sqrt(s);
      } else l[i][j] = s / l[j][j];
    }
  return l;
}

/** Eigenvalues (descending) and eigenvectors (columns of VECTORS) of a symmetric matrix, cyclic Jacobi. */
export function symEigen(a: Matrix): { values: number[]; vectors: Matrix } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    let diag = 0;
    for (let i = 0; i < n; i++) {
      diag += m[i][i] * m[i][i];
      for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    }
    if (off <= 1e-30 * Math.max(diag, 1e-300)) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = m.map((_, i) => i).sort((i, j) => m[j][j] - m[i][i]);
  return { values: order.map((i) => m[i][i]), vectors: v.map((r) => order.map((i) => r[i])) };
}

/**
 * Eigenvalues (descending) of E⁻¹H for symmetric H and symmetric positive definite E (the
 * generalized problem H x = λ E x, reduced to L⁻¹ H L⁻ᵀ with E = L Lᵀ); null if E is not PD.
 */
export function genEigenvalues(h: Matrix, e: Matrix): number[] | null {
  const l = cholesky(e);
  if (!l) return null;
  const n = l.length;
  // solve L Y = H, then L Z = Yᵀ  →  Z = L⁻¹ H L⁻ᵀ
  const fwd = (b: Matrix): Matrix => {
    const y = zeros(n, b[0]?.length ?? 0);
    for (let c = 0; c < (b[0]?.length ?? 0); c++)
      for (let i = 0; i < n; i++) {
        let s = b[i][c];
        for (let k = 0; k < i; k++) s -= l[i][k] * y[k][c];
        y[i][c] = s / l[i][i];
      }
    return y;
  };
  const z = fwd(transpose(fwd(h)));
  const sym = z.map((r, i) => r.map((x, j) => (x + z[j][i]) / 2));
  return symEigen(sym).values;
}
