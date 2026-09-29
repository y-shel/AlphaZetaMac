/**
 * Small dense linear algebra for symmetric positive definite systems. Matrices are
 * row-major Float64Arrays of k × k.
 */

/**
 * Lower Cholesky factor of `a`, or null when a pivot is not positive or is below
 * minPivotRatio times the largest diagonal entry. The null is how callers learn a system
 * is numerically singular.
 */
export function cholesky(a: Float64Array, k: number, minPivotRatio: number): Float64Array | null {
  let maxDiag = 0;
  for (let i = 0; i < k; i++) maxDiag = Math.max(maxDiag, a[i * k + i]!);
  const l = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * k + j]!;
      for (let m = 0; m < j; m++) s -= l[i * k + m]! * l[j * k + m]!;
      if (i === j) {
        if (!(s > minPivotRatio * maxDiag)) return null;
        l[i * k + i] = Math.sqrt(s);
      } else {
        l[i * k + j] = s / l[j * k + j]!;
      }
    }
  }
  return l;
}

/** Solves L Lᵀ x = b. */
export function cholSolve(l: Float64Array, k: number, b: ArrayLike<number>): Float64Array {
  const z = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let s = b[i]!;
    for (let m = 0; m < i; m++) s -= l[i * k + m]! * z[m]!;
    z[i] = s / l[i * k + i]!;
  }
  const x = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let m = i + 1; m < k; m++) s -= l[m * k + i]! * x[m]!;
    x[i] = s / l[i * k + i]!;
  }
  return x;
}

/** (L Lᵀ)⁻¹. */
export function cholInverse(l: Float64Array, k: number): Float64Array {
  const inv = new Float64Array(k * k);
  const e = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    e.fill(0);
    e[j] = 1;
    const col = cholSolve(l, k, e);
    for (let i = 0; i < k; i++) inv[i * k + j] = col[i]!;
  }
  return inv;
}
