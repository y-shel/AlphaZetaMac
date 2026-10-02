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

/** The EWMA trend after each score, written out on its own. */
function ewma(scores: readonly number[]): number[] {
  const d = Math.pow(0.5, 1 / SCORE_TREND_HALF_LIFE);
  let num = 0;
  let den = 0;
  return scores.map((s) => {
    num = num * d + s;
    den = den * d + 1;
    return num / den;
  });
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
    expect(series.leftOut).toBe(0);
    expect(series.next).toBeNull();
    expect(series.points.map((p) => p.score)).toEqual([40, 44, 38, 42]);
    for (const p of series.points) {
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    }
  });

  it('gives a band for 5 rounds: none on the first point, and each later one centred on the trend before it', () => {
    const series = scoreSeries(rounds([40, 44, 38, 42, 46]))!;
    expect(series.points).toHaveLength(5);
    expect(series.points[0]!.low).toBeNull();
    expect(series.points[0]!.high).toBeNull();
    for (let i = 1; i < 5; i++) {
      const p = series.points[i]!;
      const before = series.points[i - 1]!.trend;
      expect(p.low!).toBeLessThan(before);
      expect(p.high!).toBeGreaterThan(before);
      // Centred on the log scale: low × high is the previous trend squared.
      expect(Math.sqrt(p.low! * p.high!)).toBeCloseTo(before, 10);
    }
    expect(series.next).not.toBeNull();
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
      if (i === 0) return;
      expect(p.low!).toBeCloseTo(trends[i - 1]! * Math.exp(-half), 10);
      expect(p.high!).toBeCloseTo(trends[i - 1]! * Math.exp(half), 10);
    });
    expect(series.next!.low).toBeCloseTo(trends[4]! * Math.exp(-half), 10);
    expect(series.next!.high).toBeCloseTo(trends[4]! * Math.exp(half), 10);
    // Pinned numbers, so a change to the rule cannot hide behind the formula above.
    expect(half).toBeCloseTo(0.25675, 4);
    expect(series.next!.low).toBeCloseTo(32.718, 2);
    expect(series.next!.high).toBeCloseTo(54.676, 2);
    expect(series.points[4]!.low!).toBeCloseTo(31.716, 2);
    expect(series.points[4]!.high!).toBeCloseTo(53.003, 2);
  });

  it('leaves out rounds below half the median, a 0 and a 1 alike', () => {
    // Sorted: 0, 1, 40, 41, 42, 43, 44. The upper middle is 41, so below 20.5 is cut short.
    const series = scoreSeries(rounds([40, 0, 42, 1, 44, 41, 43]))!;
    expect(series.leftOut).toBe(2);
    expect(series.points.map((p) => p.score)).toEqual([40, 42, 44, 41, 43]);
    expect(series.points.map((p) => p.sessionId)).toEqual(['s0', 's2', 's4', 's5', 's6']);
    // The trend and the band are those of the counted rounds alone.
    const alone = scoreSeries(rounds([40, 42, 44, 41, 43]))!;
    expect(series.points.map((p) => p.trend)).toEqual(alone.points.map((p) => p.trend));
    expect(series.next).toEqual(alone.next);
    const trends = ewma([40, 42, 44, 41, 43]);
    expect(trends[4]!).toBeCloseTo(42.1285, 3);
    expect(series.next!.low).toBeCloseTo(37.01, 2);
    expect(series.next!.high).toBeCloseTo(47.956, 2);
  });

  it('takes the upper middle score as the median of an even number of rounds', () => {
    // Sorted: 10, 19, 40, 44. The upper middle is 40, so 19 is cut short and 20 would not be.
    expect(scoreSeries(rounds([40, 19, 44, 10]))!.leftOut).toBe(2);
    expect(scoreSeries(rounds([40, 20, 44, 10]))!.leftOut).toBe(1);
  });

  it('leaves no round out and gives no band when the median is 0', () => {
    const series = scoreSeries(rounds([0, 0, 0, 40, 42]))!;
    expect(series.leftOut).toBe(0);
    expect(series.next).toBeNull();
    expect(series.points.map((p) => p.score)).toEqual([0, 0, 0, 40, 42]);
    const trends = ewma([0, 0, 0, 40, 42]);
    series.points.forEach((p, i) => {
      expect(p.trend).toBeCloseTo(trends[i]!, 10);
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    });
  });

  it('gives no band with fewer than 5 counted rounds, however many sessions there are', () => {
    // 7 sessions, 3 cut short (median 40, half 20), 4 counted.
    const series = scoreSeries(rounds([40, 3, 42, 0, 41, 5, 43]))!;
    expect(series.leftOut).toBe(3);
    expect(series.points).toHaveLength(4);
    expect(series.next).toBeNull();
    for (const p of series.points) {
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    }
  });

  it('gives no band when every score is the same', () => {
    // 40 leaves a trend of 39.99999999999999 by rounding, and 37 and 64 behave the same way.
    for (const v of [1, 7, 37, 64, 113]) expect(scoreSeries(rounds(Array.from({ length: 12 }, () => v)))!.next).toBeNull();
    // One round that differs is spread, and gives a band.
    expect(scoreSeries(rounds([40, 40, 40, 40, 41]))!.next).not.toBeNull();
    const series = scoreSeries(rounds([40, 40, 40, 40, 40, 40]))!;
    expect(series.leftOut).toBe(0);
    expect(series.next).toBeNull();
    for (const p of series.points) {
      expect(p.trend).toBeCloseTo(40, 10);
      expect(p.low).toBeNull();
      expect(p.high).toBeNull();
    }
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
    // Sessions of another series are not cut-short rounds of this one.
    expect(series.leftOut).toBe(0);
  });

  it('puts the rounds oldest first whatever order they arrive in', () => {
    const sessions = rounds([40, 44, 38, 42, 46]);
    expect(scoreSeries([...sessions].reverse())).toEqual(scoreSeries(sessions));
  });

  it('never gives NaN or an infinite value for a series containing zeros', () => {
    const cases = [
      [0, 40, 0, 42, 44, 41],
      [0, 40, 0, 42, 44, 41, 43, 39],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 40, 42],
      [0, 0, 1, 1, 1, 0],
      [1, 1, 1, 2, 1, 1],
      [0],
    ];
    for (const scores of cases) {
      const series = scoreSeries(rounds(scores))!;
      expect(series.points.length + series.leftOut).toBe(scores.length);
      for (const p of series.points) {
        expect(Number.isFinite(p.trend)).toBe(true);
        for (const v of [p.low, p.high]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
      if (series.next !== null) {
        expect(Number.isFinite(series.next.low)).toBe(true);
        expect(Number.isFinite(series.next.high)).toBe(true);
        expect(series.next.low).toBeGreaterThan(0);
      }
    }
    // Two zeros among 8 rounds are cut short, and the band is that of the other 6.
    const series = scoreSeries(rounds([0, 40, 0, 42, 44, 41, 43, 39]))!;
    expect(series.leftOut).toBe(2);
    expect(series.next).toEqual(scoreSeries(rounds([40, 42, 44, 41, 43, 39]))!.next);
  });
});
