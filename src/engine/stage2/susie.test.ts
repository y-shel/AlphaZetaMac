import { describe, expect, it } from 'vitest';
import { createRng } from '../../domain/rng';
import { normal } from '../__sim__/simUser';
import { suffStats, susie } from './susie';

/** n rows, p random binary columns, y = effect × column `at` + noise. */
function data(n: number, p: number, effects: Record<number, number>, seed: number, noise = 0.25) {
  const rng = createRng(seed);
  const columns = Array.from({ length: p }, () => new Int8Array(n));
  for (const col of columns) for (let i = 0; i < n; i++) col[i] = rng.next() < 0.4 ? 1 : 0;
  const y = Float64Array.from({ length: n }, (_, i) => {
    let v = noise * normal(rng);
    for (const [j, b] of Object.entries(effects)) v += b * columns[Number(j)]![i]!;
    return v;
  });
  return { columns, y, w: new Float64Array(n).fill(1), rows: Array.from({ length: n }, (_, i) => i) };
}

describe('suffStats', () => {
  it('centres each column on its applicable rows and leaves the rest out', () => {
    const col = Int8Array.from([1, 0, -1, 1]);
    const st = suffStats([col], [1, 0, 9, 1], [1, 1, 1, 1], [0, 1, 2, 3]);
    // Applicable mean 2/3; centred values 1/3, −2/3, 0, 1/3.
    expect(st.xtx[0]).toBeCloseTo(1 / 9 + 4 / 9 + 1 / 9, 12);
    // y is centred on all rows (mean 11/4); the not-applicable row contributes nothing.
    expect(st.xty[0]).toBeCloseTo((1 / 3) * (1 - 11 / 4) + (-2 / 3) * (0 - 11 / 4) + (1 / 3) * (1 - 11 / 4), 12);
    expect(st.n).toBe(4);
  });
});

describe('susie', () => {
  it('finds a single real effect in a pure credible set with its size', () => {
    const d = data(800, 30, { 7: 0.2 }, 1);
    const fit = susie(suffStats(d.columns, d.y, d.w, d.rows));
    expect(fit.converged).toBe(true);
    expect(fit.sets).toHaveLength(1);
    expect(fit.sets[0]!.columns).toEqual([7]);
    expect(Math.abs(fit.sets[0]!.mean - 0.2)).toBeLessThan(3 * fit.sets[0]!.sd);
    expect(fit.pip[7]).toBeGreaterThan(0.95);
    expect(Math.sqrt(fit.sigma2)).toBeCloseTo(0.25, 1);
  });

  it('finds two separate effects as two sets', () => {
    const d = data(1500, 30, { 3: 0.2, 11: -0.15 }, 2);
    const fit = susie(suffStats(d.columns, d.y, d.w, d.rows));
    const found = fit.sets.map((s) => s.columns[0]).sort((a, b) => a! - b!);
    expect(found).toEqual([3, 11]);
  });

  it('puts two identical columns in one set, since the data cannot tell them apart', () => {
    const d = data(800, 20, { 5: 0.25 }, 3);
    d.columns[6] = Int8Array.from(d.columns[5]!);
    const fit = susie(suffStats(d.columns, d.y, d.w, d.rows));
    expect(fit.sets).toHaveLength(1);
    expect([...fit.sets[0]!.columns].sort()).toEqual([5, 6]);
    expect(fit.sets[0]!.alpha[0]).toBeCloseTo(0.5, 1);
  });

  it('reports nothing when there is nothing', () => {
    const d = data(800, 30, {}, 4);
    expect(susie(suffStats(d.columns, d.y, d.w, d.rows)).sets).toEqual([]);
  });

  it('is deterministic', () => {
    const d = data(500, 20, { 2: 0.2 }, 5);
    const st = suffStats(d.columns, d.y, d.w, d.rows);
    expect(susie(st)).toEqual(susie(st));
  });
});
