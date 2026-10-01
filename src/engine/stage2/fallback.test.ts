import { describe, expect, it } from 'vitest';
import { fallbackRanking } from './fallback';
import type { Term } from './terms';

const term = (id: string, values: number[]): Term => ({
  id,
  atomIds: id.split('&'),
  values: Int8Array.from(values),
  nApplicable: values.filter((v) => v >= 0).length,
  nPositive: values.filter((v) => v === 1).length,
  prevalence: 0.5,
});

describe('fallbackRanking', () => {
  const y = [0.3, 0.1, 0.2, 0, -0.1, 0];
  const rows = [0, 1, 2, 3, 4, 5];
  const w = [1, 1, 1, 1, 1, 1];

  it('gives the mean residual where the atom holds minus where it does not, slowest first', () => {
    const out = fallbackRanking([term('a', [1, 1, 1, 0, 0, 0]), term('b', [1, 0, 0, 0, 0, 1])], y, w, rows);
    expect(out.map((o) => o.termId)).toEqual(['a', 'b']);
    expect(out[0]!.effectLogT).toBeCloseTo(0.2 - -1 / 30, 12);
    expect(out[0]!.se).toBeGreaterThan(0);
  });

  it('ignores conjunctions, fast-side differences and rows where the atom does not apply', () => {
    const out = fallbackRanking([term('a&b', [1, 1, 1, 0, 0, 0]), term('c', [0, 0, 0, 1, 1, 1]), term('d', [1, -1, -1, 0, -1, -1])], y, w, rows);
    expect(out.map((o) => o.termId)).toEqual(['d']);
    expect(out[0]!.effectLogT).toBeCloseTo(0.3, 12);
  });
});
