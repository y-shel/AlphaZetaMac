import { describe, expect, it } from 'vitest';
import { createRng } from '../../domain/rng';
import { normal } from '../__sim__/simUser';
import { suffStats, susie } from './susie';

/**
 * Correlated binary columns like real terms: each column copies a shared parent 60% of the
 * time, so neighbours overlap the way A, A∧B and A∧C do (spec 10.2).
 */
function data(effects: Record<number, number>, seed: number, n = 1000, p = 40) {
  const rng = createRng(seed);
  const parents = Array.from({ length: 8 }, () => Int8Array.from({ length: n }, () => (rng.next() < 0.4 ? 1 : 0)));
  const columns = Array.from({ length: p }, (_, j) => {
    const parent = parents[j % parents.length]!;
    return Int8Array.from({ length: n }, (_, i) => (rng.next() < 0.6 ? parent[i]! : rng.next() < 0.4 ? 1 : 0));
  });
  const y = Float64Array.from({ length: n }, (_, i) => {
    let v = 0.25 * normal(rng);
    for (const [j, b] of Object.entries(effects)) v += b * columns[Number(j)]![i]!;
    return v;
  });
  const fit = susie(suffStats(columns, y, new Float64Array(n).fill(1), Array.from({ length: n }, (_, i) => i)));
  return fit;
}

describe('SuSiE: recovery', () => {
  it('credible sets contain a true effect at least 95% of the time, and most true effects are found', () => {
    let sets = 0;
    let covering = 0;
    let found = 0;
    for (let seed = 0; seed < 200; seed++) {
      const truth = [3 + (seed % 5), 20 + (seed % 7)];
      const fit = data({ [truth[0]!]: 0.12, [truth[1]!]: 0.1 }, 100 + seed);
      for (const cs of fit.sets) {
        sets++;
        if (cs.columns.some((j) => truth.includes(j))) covering++;
      }
      for (const t of truth) if (fit.sets.some((cs) => cs.columns.includes(t))) found++;
    }
    expect(covering / sets).toBeGreaterThanOrEqual(0.95);
    expect(found / 400).toBeGreaterThan(0.8);
  });
});

describe('SuSiE: calibration', () => {
  it('with no effect across 200 datasets, at most 5% report any credible set', () => {
    let any = 0;
    for (let seed = 0; seed < 200; seed++) if (data({}, 500 + seed).sets.length > 0) any++;
    expect(any).toBeLessThanOrEqual(10);
  });
});
