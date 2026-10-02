import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { Session } from '../../domain/types';
import { simulateRoundScore } from '../__sim__/simRound';
import { normal, typicalUser } from '../__sim__/simUser';
import { scoreSeries } from './series';

const USERS = 1000;
const GAP_MS = 120;
const DAY = 86_400_000;

/**
 * The share of steady users whose round n + 1 lands inside the band drawn at round n. The
 * band claims about 19 in 20.
 */
function coverage(sessionSd: number, n: number): number {
  const params = defaultParams();
  const user = typicalUser({ sessionSd });
  let inside = 0;
  for (let u = 0; u < USERS; u++) {
    const rng = createRng(70000 + u);
    const scores = Array.from({ length: n + 1 }, () =>
      simulateRoundScore(user, { params, gapMs: GAP_MS, sessionShift: sessionSd * normal(rng) }, rng),
    );
    const next = scores.pop()!;
    const sessions: Session[] = scores.map((score, i) => ({
      id: `s${i}`,
      mode: 'normal',
      paramsSnapshotId: 'ps-a',
      durationS: 120,
      startedAt: i * DAY,
      endedAt: i * DAY + 120_000,
      score,
    }));
    const last = scoreSeries(sessions)!.points.at(-1)!;
    if (last.low !== null && last.high !== null && next >= last.low && next <= last.high) inside++;
  }
  return inside / USERS;
}

describe('scoreSeries: calibration', () => {
  for (const sessionSd of [0, 0.1]) {
    for (const n of [5, 10, 30]) {
      it(`covers the next round about 19 times in 20 (session sd ${sessionSd}, ${n} rounds)`, () => {
        const share = coverage(sessionSd, n);
        expect(share).toBeGreaterThanOrEqual(0.93);
        expect(share).toBeLessThanOrEqual(0.985);
      });
    }
  }
});
