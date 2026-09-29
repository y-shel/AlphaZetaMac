import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../domain/rng';
import { normal } from '../__sim__/simUser';
import { sandwichCov, weightedRidge } from './ridge';

const rows = (xs: number[][]) => xs.map((r) => Float64Array.from(r));

describe('weightedRidge', () => {
  it('recovers an exact line with a negligible penalty', () => {
    const x = rows([[1, 0], [1, 1], [1, 2], [1, 3]]);
    const fit = weightedRidge(x, [1, 3, 5, 7], [1, 1, 1, 1], 2, 1e-9)!;
    expect(fit.coef[0]).toBeCloseTo(1, 6);
    expect(fit.coef[1]).toBeCloseTo(2, 6);
  });

  it('ignores rows with weight 0', () => {
    const x = rows([[1, 0], [1, 1], [1, 2], [1, 3]]);
    const fit = weightedRidge(x, [1, 3, 5, 100], [1, 1, 1, 0], 2, 1e-9)!;
    expect(fit.coef[1]).toBeCloseTo(2, 6);
  });

  it('matches the weighted normal equations', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), (seed) => {
        const rng = createRng(seed);
        const n = 30;
        const x = Array.from({ length: n }, () => Float64Array.from([1, rng.next() * 5, rng.next()]));
        const y = x.map((r) => 2 + 0.5 * r[1]! - r[2]! + 0.1 * normal(rng));
        const w = x.map(() => 0.1 + rng.next());
        const lambda = 0.01;
        const fit = weightedRidge(x, y, w, 3, lambda)!;
        // Gradient of the objective is zero at the solution: Xᵀ W (y − Xβ) = λβ.
        for (let c = 0; c < 3; c++) {
          let g = 0;
          for (let i = 0; i < n; i++) {
            const pred = x[i]![0]! * fit.coef[0]! + x[i]![1]! * fit.coef[1]! + x[i]![2]! * fit.coef[2]!;
            g += w[i]! * x[i]![c]! * (y[i]! - pred);
          }
          expect(g).toBeCloseTo(lambda * fit.coef[c]!, 8);
        }
      }),
    );
  });

  it('retries with a larger penalty when the columns are collinear, and reports it', () => {
    const x = rows([[1, 2], [1, 2], [1, 2]]);
    const fit = weightedRidge(x, [1, 1, 1], [1, 1, 1], 2, 1e-12)!;
    expect(fit).not.toBeNull();
    expect(fit.lambda).toBeCloseTo(1e-9, 20);
  });

  it('returns null when even the retry is singular', () => {
    const x = rows([[1, 2], [1, 2]]);
    expect(weightedRidge(x, [1, 1], [1, 1], 2, 0)).toBeNull();
  });
});

describe('sandwichCov', () => {
  it('gives about the textbook slope variance for homoscedastic noise', () => {
    const rng = createRng(4);
    const n = 2000;
    const x = Array.from({ length: n }, () => Float64Array.from([1, rng.next() * 4]));
    const y = x.map((r) => 1 + 0.5 * r[1]! + 0.3 * normal(rng));
    const w = new Array<number>(n).fill(1);
    const fit = weightedRidge(x, y, w, 2, 1e-9)!;
    const resid = x.map((r, i) => y[i]! - fit.coef[0]! - fit.coef[1]! * r[1]!);
    const cov = sandwichCov(x, w, resid, fit.inv, 2);
    // Var(slope) = sigma² / Σ(x − x̄)². x is uniform on [0, 4], so Σ(x − x̄)² ≈ n · 16/12.
    const expected = 0.09 / (n * (16 / 12));
    expect(cov[3]! / expected).toBeGreaterThan(0.85);
    expect(cov[3]! / expected).toBeLessThan(1.15);
  });
});
