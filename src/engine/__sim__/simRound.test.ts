import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { simulateRoundScore } from './simRound';
import { typicalUser, type SimUser } from './simUser';

const meanScore = (user: SimUser, seed: number, rounds: number, durationMs?: number): number => {
  const rng = createRng(seed);
  let total = 0;
  for (let r = 0; r < rounds; r++) total += simulateRoundScore(user, { params: defaultParams(), gapMs: 120, durationMs }, rng);
  return total / rounds;
};

describe('simulateRoundScore', () => {
  it('is deterministic for a seed', () => {
    const opts = { params: defaultParams(), gapMs: 120 };
    const a = simulateRoundScore(typicalUser(), opts, createRng(11));
    expect(simulateRoundScore(typicalUser(), opts, createRng(11))).toBe(a);
    expect(a).toBeGreaterThan(10);
    expect(a).toBeLessThan(200);
  });

  it('scores a faster user higher', () => {
    const slow = typicalUser();
    const fast = typicalUser({ alpha: Object.fromEntries(Object.entries(slow.alpha).map(([id, a]) => [id, a - 0.3])) });
    expect(meanScore(fast, 12, 50)).toBeGreaterThan(meanScore(slow, 12, 50) * 1.15);
  });

  it('scores nothing in a round too short to finish a problem, and more in a longer round', () => {
    expect(simulateRoundScore(typicalUser({ lapseRate: 0 }), { params: defaultParams(), gapMs: 120, durationMs: 1 }, createRng(13))).toBe(0);
    expect(meanScore(typicalUser(), 14, 50, 240_000)).toBeGreaterThan(meanScore(typicalUser(), 14, 50) * 1.8);
  });
});
