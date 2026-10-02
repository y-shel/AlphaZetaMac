import { describe, expect, it } from 'vitest';
import type { Session } from '../../domain/types';
import { SCORE_TREND_HALF_LIFE } from '../constants';
import { scoreSeries } from './series';

const DAY = 86_400_000;

/** Finished normal rounds with these scores, one a day, oldest first. */
function rounds(scores: readonly number[], over: Partial<Session> = {}): Session[] {
  return scores.map((score, i) => ({
    id: `s${i}`,
    mode: 'normal',
    paramsSnapshotId: 'ps-a',
    durationS: 120,
    startedAt: 1_000_000 + i * DAY,
    endedAt: 1_000_000 + i * DAY + 120_000,
    score,
    ...over,
  }));
}

describe('scoreSeries', () => {
  it('is null with no normal session', () => {
    expect(scoreSeries([])).toBeNull();
    expect(scoreSeries(rounds([40, 41], { mode: 'train' }))).toBeNull();
    // A round that never ended has no score to plot.
    expect(scoreSeries(rounds([40], { endedAt: null }))).toBeNull();
  });

  it('gives the scores and the trend with no band for 4 rounds', () => {
    const series = scoreSeries(rounds([40, 44, 38, 42]))!;
    expect(series.durationS).toBe(120);
    expect(series.points.map((p) => p.score)).toEqual([40, 44, 38, 42]);
    for (const p of series.points) {
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    }
  });

  it('gives a band for 5 rounds', () => {
    const series = scoreSeries(rounds([40, 44, 38, 42, 46]))!;
    expect(series.points).toHaveLength(5);
    for (const p of series.points) {
      expect(p.low!).toBeLessThan(p.trend);
      expect(p.high!).toBeGreaterThan(p.trend);
    }
  });

  it('matches a hand computation on 5 fixed scores', () => {
    const scores = [40, 44, 38, 42, 46];
    const d = Math.pow(0.5, 1 / SCORE_TREND_HALF_LIFE);
    const trends = [
      40,
      (40 * d + 44) / (d + 1),
      (40 * d ** 2 + 44 * d + 38) / (d ** 2 + d + 1),
      (40 * d ** 3 + 44 * d ** 2 + 38 * d + 42) / (d ** 3 + d ** 2 + d + 1),
      (40 * d ** 4 + 44 * d ** 3 + 38 * d ** 2 + 42 * d + 46) / (d ** 4 + d ** 3 + d ** 2 + d + 1),
    ];
    // Each round against the trend before it. 4 gaps, so the t quantile is the one for 4.
    const gaps = [Math.log(44 / trends[0]!), Math.log(38 / trends[1]!), Math.log(42 / trends[2]!), Math.log(46 / trends[3]!)];
    const s = Math.sqrt(gaps.reduce((a, g) => a + g * g, 0) / 4);
    const half = 2.776 * s;

    const series = scoreSeries(rounds(scores))!;
    series.points.forEach((p, i) => {
      expect(p.trend).toBeCloseTo(trends[i]!, 10);
      expect(p.low!).toBeCloseTo(trends[i]! * Math.exp(-half), 10);
      expect(p.high!).toBeCloseTo(trends[i]! * Math.exp(half), 10);
    });
    // Pinned numbers, so a change to the rule cannot hide behind the formula above.
    expect(half).toBeCloseTo(0.25675, 4);
    expect(series.points[4]!.low!).toBeCloseTo(32.718, 2);
    expect(series.points[4]!.high!).toBeCloseTo(54.676, 2);
  });

  it('leaves out a session with another duration or snapshot', () => {
    const sessions = [
      ...rounds([40, 44, 38]),
      { ...rounds([90])[0]!, id: 'short', durationS: 60, startedAt: 1_000_000 + 3 * DAY },
      { ...rounds([20])[0]!, id: 'other', paramsSnapshotId: 'ps-b', startedAt: 1_000_000 + 4 * DAY },
      { ...rounds([42])[0]!, id: 'last', startedAt: 1_000_000 + 5 * DAY },
    ];
    const series = scoreSeries(sessions)!;
    expect(series.points.map((p) => p.sessionId)).toEqual(['s0', 's1', 's2', 'last']);
    expect(series.durationS).toBe(120);
  });

  it('puts the rounds oldest first whatever order they arrive in', () => {
    const sessions = rounds([40, 44, 38, 42, 46]);
    expect(scoreSeries([...sessions].reverse())).toEqual(scoreSeries(sessions));
  });

  it('does not produce NaN for a round with a score of 0', () => {
    const series = scoreSeries(rounds([0, 40, 0, 42, 44, 41]))!;
    for (const p of series.points) {
      expect(Number.isFinite(p.trend)).toBe(true);
      expect(Number.isFinite(p.low!)).toBe(true);
      expect(Number.isFinite(p.high!)).toBe(true);
    }
    // Every score 0: no round has a log, so there is no spread and no band.
    for (const p of scoreSeries(rounds([0, 0, 0, 0, 0]))!.points) {
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    }
  });
});
