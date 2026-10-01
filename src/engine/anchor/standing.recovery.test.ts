import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { simulateRoundScore } from '../__sim__/simRound';
import { trueModel, typicalUser } from '../__sim__/simUser';
import { predictStanding } from './standing';

const USERS = 120;
const ROUNDS = 200;
const GAP_MS = 120;

describe('predictStanding: recovery', () => {
  it('predicts the score a user with a known level actually gets, within 3 percent on average', () => {
    const base = typicalUser();
    const draw = createRng(31000);
    let ratioSum = 0;
    for (let u = 0; u < USERS; u++) {
      // Users from much slower to much faster than typical, with more or less scatter.
      const shift = -0.4 + 0.8 * draw.next();
      const user = typicalUser({
        alpha: Object.fromEntries(Object.entries(base.alpha).map(([id, a]) => [id, a + shift])),
        sigma: 0.2 + 0.15 * draw.next(),
        sessionSd: 0,
      });
      const rng = createRng(32000 + u);
      let total = 0;
      for (let r = 0; r < ROUNDS; r++) total += simulateRoundScore(user, { params: defaultParams(), gapMs: GAP_MS }, rng);
      const actual = total / ROUNDS;
      const predicted = predictStanding(trueModel(user), GAP_MS)!.overall!.score;
      ratioSum += predicted / actual;
    }
    const ratio = ratioSum / USERS;
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });
});
