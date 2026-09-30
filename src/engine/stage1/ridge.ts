import { MIN_PIVOT_RATIO, RIDGE_RETRY_FACTOR } from '../constants';
import { cholInverse, cholesky, cholSolve } from './linalg';

export interface RidgeFit {
  coef: Float64Array;
  /** (XᵀWX + λI)⁻¹, row-major k × k. */
  inv: Float64Array;
  lambda: number;
}

/**
 * Weighted ridge regression: minimises Σ wᵢ (yᵢ − xᵢβ)² + λ|β|². Rows of x have length k.
 * If the system is numerically singular it retries once with λ × RIDGE_RETRY_FACTOR, and
 * returns null if that fails too (spec 19).
 */
export function weightedRidge(
  x: readonly Float64Array[],
  y: ArrayLike<number>,
  w: ArrayLike<number>,
  k: number,
  lambda: number,
): RidgeFit | null {
  const a = new Float64Array(k * k);
  const b = new Float64Array(k);
  for (let i = 0; i < x.length; i++) {
    const wi = w[i]!;
    if (wi === 0) continue;
    const row = x[i]!;
    const wy = wi * y[i]!;
    for (let r = 0; r < k; r++) {
      const wr = wi * row[r]!;
      if (wr === 0) continue;
      b[r] = b[r]! + row[r]! * wy;
      for (let c = 0; c <= r; c++) a[r * k + c] = a[r * k + c]! + wr * row[c]!;
    }
  }
  for (let r = 0; r < k; r++) for (let c = 0; c < r; c++) a[c * k + r] = a[r * k + c]!;
  for (const lam of [lambda, lambda * RIDGE_RETRY_FACTOR]) {
    const reg = Float64Array.from(a);
    for (let r = 0; r < k; r++) reg[r * k + r] = reg[r * k + r]! + lam;
    const l = cholesky(reg, k, MIN_PIVOT_RATIO);
    if (l !== null) return { coef: cholSolve(l, k, b), inv: cholInverse(l, k), lambda: lam };
  }
  return null;
}

/**
 * Heteroscedasticity-robust covariance of a weighted fit, HC3 form:
 * inv · (Σ wᵢ² eᵢ² / (1 − hᵢ)² · xᵢxᵢᵀ) · inv, with leverage hᵢ = wᵢ xᵢᵀ inv xᵢ.
 * It stays honest when the weights are not inverse variances, which EWMA weights are not,
 * and HC3 holds its coverage at the small samples the Test tab fits.
 * bread defaults to inv. A caller whose weights depend on the residuals (an M-estimator)
 * passes its own bread; leverage still uses inv.
 */
export function sandwichCov(
  x: readonly Float64Array[],
  w: ArrayLike<number>,
  resid: ArrayLike<number>,
  inv: Float64Array,
  k: number,
  bread: Float64Array = inv,
): Float64Array {
  const meat = new Float64Array(k * k);
  for (let i = 0; i < x.length; i++) {
    const wi = w[i]!;
    if (wi <= 0) continue;
    const row = x[i]!;
    let h = 0;
    for (let r = 0; r < k; r++) {
      let t = 0;
      for (let c = 0; c < k; c++) t += inv[r * k + c]! * row[c]!;
      h += row[r]! * t;
    }
    h *= wi;
    const d = 1 - Math.min(h, 0.99);
    const s = (wi * wi * resid[i]! * resid[i]!) / (d * d);
    for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) meat[r * k + c] = meat[r * k + c]! + s * row[r]! * row[c]!;
  }
  return matMul(matMul(bread, meat, k), bread, k);
}

function matMul(a: Float64Array, b: Float64Array, k: number): Float64Array {
  const out = new Float64Array(k * k);
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let m = 0; m < k; m++) s += a[i * k + m]! * b[m * k + j]!;
      out[i * k + j] = s;
    }
  return out;
}
