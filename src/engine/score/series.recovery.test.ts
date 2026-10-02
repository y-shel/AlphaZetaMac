import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { Session } from '../../domain/types';
import { simulateRoundScore } from '../__sim__/simRound';
import { normal, typicalUser, type SimUser } from '../__sim__/simUser';
import { scoreSeries } from './series';

const USERS = 1000;
const GAP_MS = 120;
const DAY = 86_400_000;
/** The chance that a round of the cut-short user is abandoned part way. */
const CUT_SHORT_RATE = 0.05;
/** Added to every alpha of the slow user. They finish about 4 problems in a 120 s round. */
const SLOW_SHIFT = 2.2;

interface Cell {
  sessionSd: number;
  rounds: number;
  lapseRate?: number;
  /** About 9 times slower than the typical user, so scores are small. */
  slow?: boolean;
  /** Round length in seconds. 120 unless given. */
  durationS?: number;
  /** Some of the first n rounds are abandoned early. The next round never is. */
  cutShort?: boolean;
}

function userOf(cell: Cell): SimUser {
  const base = typicalUser({ sessionSd: cell.sessionSd, ...(cell.lapseRate === undefined ? {} : { lapseRate: cell.lapseRate }) });
  if (cell.slow !== true) return base;
  return { ...base, alpha: Object.fromEntries(Object.entries(base.alpha).map(([id, a]) => [id, a + SLOW_SHIFT])) };
}

interface Coverage {
  /** Share of users whose round n + 1 lands inside `next` after n rounds. The band claims about 19 in 20. */
  share: number;
  /** Users with at least one round left out. */
  withLeftOut: number;
  /** Share of all rounds that were left out. */
  leftOutShare: number;
}

function coverage(cell: Cell): Coverage {
  const params = defaultParams();
  const user = userOf(cell);
  const durationS = cell.durationS ?? 120;
  let inside = 0;
  let withLeftOut = 0;
  let leftOut = 0;
  for (let u = 0; u < USERS; u++) {
    const rng = createRng(70000 + u);
    const round = () =>
      simulateRoundScore(user, { params, gapMs: GAP_MS, durationMs: durationS * 1000, sessionShift: cell.sessionSd * normal(rng) }, rng);
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
      durationS,
      startedAt: i * DAY,
      endedAt: i * DAY + durationS * 1000,
      score,
    }));
    const series = scoreSeries(sessions)!;
    if (series.leftOut > 0) withLeftOut++;
    leftOut += series.leftOut;
    // A series with no band makes no claim, so it cannot count as covering.
    if (series.next !== null && next >= series.next.low && next <= series.next.high) inside++;
  }
  return { share: inside / USERS, withLeftOut, leftOutShare: leftOut / (USERS * cell.rounds) };
}

function expectCovered(share: number): void {
  expect(share).toBeGreaterThanOrEqual(0.93);
  expect(share).toBeLessThanOrEqual(0.99);
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
    it(`covers a slow user's next round and keeps their rounds (${rounds} rounds)`, () => {
      const { share, leftOutShare } = coverage({ sessionSd: 0.1, rounds, slow: true });
      // Small scores vary a lot in proportion. That is not a round cut short.
      expect(leftOutShare).toBeLessThan(0.005);
      expectCovered(share);
    });

    it(`covers the next 30 second round (${rounds} rounds)`, () => {
      expectCovered(coverage({ sessionSd: 0.1, rounds, durationS: 30 }).share);
    });

    it(`covers the next round when some rounds were cut short (session sd 0.1, ${rounds} rounds)`, () => {
      const { share, withLeftOut } = coverage({ sessionSd: 0.1, rounds, cutShort: true });
      // The case is only a test of the rule if rounds were in fact left out.
      expect(withLeftOut).toBeGreaterThan(0);
      expectCovered(share);
    });

    it(`covers a slow user's next round when some rounds were cut short (${rounds} rounds)`, () => {
      expectCovered(coverage({ sessionSd: 0.1, rounds, slow: true, cutShort: true }).share);
    });
  }
});
