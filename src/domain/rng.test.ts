import { describe, expect, it } from 'vitest';
import { createRng, randInt } from './rng';

describe('createRng', () => {
  it('matches the reference mulberry32 sequence for seed 1', () => {
    const rng = createRng(1);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it('gives the same sequence for the same seed', () => {
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('randInt', () => {
  it('reaches both ends of the range and nothing outside it', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) seen.add(randInt(rng, [2, 5]));
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('returns the only value of a one-value range', () => {
    expect(randInt(createRng(1), [4, 4])).toBe(4);
  });
});
