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
/** The chance that a round of the cut-short user is abandoned part way. */
const CUT_SHORT_RATE = 0.05;

interface Cell {
  sessionSd: number;
  rounds: number;
  lapseRate?: number;
  /** Some of the first n rounds are abandoned early. The next round never is. */
  cutShort?: boolean;
}

/**
 * The share of steady users whose round n + 1 lands inside `next` after n rounds, and how
 * many of them had a round left out. The band claims about 19 in 20.
 */
function coverage(cell: Cell): { share: number; withLeftOut: number } {
  const params = defaultParams();
  const user = typicalUser({ sessionSd: cell.sessionSd, ...(cell.lapseRate === undefined ? {} : { lapseRate: cell.lapseRate }) });
  let inside = 0;
  let withLeftOut = 0;
  for (let u = 0; u < USERS; u++) {
    const rng = createRng(70000 + u);
    const round = () => simulateRoundScore(user, { params, gapMs: GAP_MS, sessionShift: cell.sessionSd * normal(rng) }, rng);
    const scores = Array.from({ length: cell.rounds }, () => {
      const score = round();
      if (cell.cutShort !== true || rng.next() >= CUT_SHORT_RATE) return score;
      return Math.floor(score * 0.3 * rng.next());
    });
    const next = round();
    const sessions: Session[] = scores.map((score, i) => ({
      id: `s${i}`,
      mode: 'normal',
      paramsSnapshotId: 'ps-a',
      durationS: 120,
      startedAt: i * DAY,
      endedAt: i * DAY + 120_000,
      score,
    }));
    const series = scoreSeries(sessions)!;
    if (series.leftOut > 0) withLeftOut++;
    // A series with no band makes no claim, so it cannot count as covering.
    if (series.next !== null && next >= series.next.low && next <= series.next.high) inside++;
  }
  return { share: inside / USERS, withLeftOut };
}

function expectCovered(share: number): void {
  expect(share).toBeGreaterThanOrEqual(0.93);
  expect(share).toBeLessThanOrEqual(0.985);
}

describe('scoreSeries: calibration', () => {
  for (const sessionSd of [0, 0.1]) {
    for (const rounds of [5, 10, 30]) {
      it(`covers the next round about 19 times in 20 (session sd ${sessionSd}, ${rounds} rounds)`, () => {
        expectCovered(coverage({ sessionSd, rounds }).share);
      });
    }
    it(`covers the next round at a lapse rate of 0.08 (session sd ${sessionSd}, 10 rounds)`, () => {
      expectCovered(coverage({ sessionSd, rounds: 10, lapseRate: 0.08 }).share);
    });
  }

  for (const rounds of [10, 30]) {
    it(`covers the next round when some rounds were cut short (session sd 0.1, ${rounds} rounds)`, () => {
      const { share, withLeftOut } = coverage({ sessionSd: 0.1, rounds, cutShort: true });
      // The case is only a test of the rule if rounds were in fact left out.
      expect(withLeftOut).toBeGreaterThan(0);
      expectCovered(share);
    });
  }
});
