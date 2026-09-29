import { describe, expect, it } from 'vitest';
import { cholInverse, cholesky, cholSolve } from './linalg';

const A = Float64Array.from([4, 2, 0.4, 2, 5, 1, 0.4, 1, 3]);

describe('cholesky', () => {
  it('factors a positive definite matrix so that L Lᵀ = A', () => {
    const l = cholesky(A, 3, 1e-12)!;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let m = 0; m < 3; m++) s += l[i * 3 + m]! * l[j * 3 + m]!;
        expect(s).toBeCloseTo(A[i * 3 + j]!, 12);
      }
  });

  it('returns null for a singular or indefinite matrix', () => {
    expect(cholesky(Float64Array.from([1, 1, 1, 1]), 2, 1e-12)).toBeNull();
    expect(cholesky(Float64Array.from([1, 2, 2, 1]), 2, 1e-12)).toBeNull();
  });

  it('returns null when a pivot is tiny next to the largest diagonal entry', () => {
    expect(cholesky(Float64Array.from([1e6, 0, 0, 1e-6]), 2, 1e-10)).toBeNull();
    expect(cholesky(Float64Array.from([1e6, 0, 0, 1e-3]), 2, 1e-10)).not.toBeNull();
  });
});

describe('cholSolve and cholInverse', () => {
  it('solve A x = b and invert A', () => {
    const l = cholesky(A, 3, 1e-12)!;
    const x = cholSolve(l, 3, [1, 2, 3]);
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let j = 0; j < 3; j++) s += A[i * 3 + j]! * x[j]!;
      expect(s).toBeCloseTo([1, 2, 3][i]!, 12);
    }
    const inv = cholInverse(l, 3);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let m = 0; m < 3; m++) s += A[i * 3 + m]! * inv[m * 3 + j]!;
        expect(s).toBeCloseTo(i === j ? 1 : 0, 12);
      }
  });
});
