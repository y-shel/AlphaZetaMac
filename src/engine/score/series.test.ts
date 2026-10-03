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
      // Centred on the square-root scale.
      expect((Math.sqrt(p.low!) + Math.sqrt(p.high!)) / 2).toBeCloseTo(Math.sqrt(before), 10);
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
    // Each round against the trend before it, in square roots. 4 gaps, so the t quantile is the one for 4.
    const gaps = [
      Math.sqrt(44) - Math.sqrt(trends[0]!),
      Math.sqrt(38) - Math.sqrt(trends[1]!),
      Math.sqrt(42) - Math.sqrt(trends[2]!),
      Math.sqrt(46) - Math.sqrt(trends[3]!),
    ];
    const half = 2.776 * Math.sqrt(gaps.reduce((a, g) => a + g * g, 0) / 4);

    const series = scoreSeries(rounds(scores))!;
    series.points.forEach((p, i) => {
      expect(p.trend).toBeCloseTo(trends[i]!, 10);
      if (i === 0) return;
      expect(p.low!).toBeCloseTo((Math.sqrt(trends[i - 1]!) - half) ** 2, 10);
      expect(p.high!).toBeCloseTo((Math.sqrt(trends[i - 1]!) + half) ** 2, 10);
    });
    expect(series.next!.low).toBeCloseTo((Math.sqrt(trends[4]!) - half) ** 2, 10);
    expect(series.next!.high).toBeCloseTo((Math.sqrt(trends[4]!) + half) ** 2, 10);
    // Pinned numbers, so a change to the rule cannot hide behind the formula above.
    expect(half).toBeCloseTo(0.83102, 4);
    expect(series.next!.low).toBeCloseTo(32.177, 2);
    expect(series.next!.high).toBeCloseTo(53.795, 2);
    expect(series.points[4]!.low!).toBeCloseTo(31.049, 2);
    expect(series.points[4]!.high!).toBeCloseTo(52.334, 2);
  });

  it('leaves out a 0 and a 1 alike from a series near 40', () => {
    // Sorted: 0, 1, 40, 41, 42, 43, 44. The upper middle is 41. Half of it is 20.5 and
    // 41 - 3 sqrt(41) is 21.8, and 0 and 1 are under both.
    const series = scoreSeries(rounds([40, 0, 42, 1, 44, 41, 43]))!;
    expect(series.leftOut).toBe(2);
    expect(series.points.map((p) => p.score)).toEqual([40, 42, 44, 41, 43]);
    expect(series.points.map((p) => p.sessionId)).toEqual(['s0', 's2', 's4', 's5', 's6']);
    // The trend and the band are those of the counted rounds alone.
    const alone = scoreSeries(rounds([40, 42, 44, 41, 43]))!;
    expect(series.points.map((p) => p.trend)).toEqual(alone.points.map((p) => p.trend));
    expect(series.next).toEqual(alone.next);
    expect(ewma([40, 42, 44, 41, 43])[4]!).toBeCloseTo(42.1285, 3);
    expect(series.next!.low).toBeCloseTo(36.855, 2);
    expect(series.next!.high).toBeCloseTo(47.754, 2);
  });

  it('keeps every round of a low scorer', () => {
    // Median 8. The 3 is under half of it, but 8 - 3 sqrt(8) is below 0, so nothing is under that.
    const series = scoreSeries(rounds([4, 9, 3, 8, 10]))!;
    expect(series.leftOut).toBe(0);
    expect(series.points.map((p) => p.score)).toEqual([4, 9, 3, 8, 10]);
    expect(series.next!.low).toBeCloseTo(0.2292, 3);
    expect(series.next!.high).toBeCloseTo(23.573, 2);
  });

  it('leaves a round out only when it is under half the median and under the median less 3 square roots', () => {
    // Median 16: half is 8, and 16 - 3 sqrt(16) is 4. Here the square-root half of the rule binds.
    const ids = (scores: number[]) => scoreSeries(rounds(scores))!.points.map((p) => p.score);
    // 6 is under half the median but within 3 square roots: kept.
    expect(ids([16, 17, 6, 15, 16, 18, 16])).toEqual([16, 17, 6, 15, 16, 18, 16]);
    // 4 is not under 4: kept. 3 is under both: left out.
    expect(ids([16, 17, 4, 15, 16, 18, 16])).toEqual([16, 17, 4, 15, 16, 18, 16]);
    expect(ids([16, 17, 3, 15, 16, 18, 16])).toEqual([16, 17, 15, 16, 18, 16]);
    // Median 100: half is 50, and 100 - 3 sqrt(100) is 70. Here the half-median half binds.
    // 60 is under 70 but not under half: kept. 50 is not under 50: kept. 49 is under both: left out.
    expect(ids([100, 104, 60, 98, 100, 101, 97])).toEqual([100, 104, 60, 98, 100, 101, 97]);
    expect(ids([100, 104, 50, 98, 100, 101, 97])).toEqual([100, 104, 50, 98, 100, 101, 97]);
    expect(ids([100, 104, 49, 98, 100, 101, 97])).toEqual([100, 104, 98, 100, 101, 97]);
    // Median 40: half is 20, and 40 - 3 sqrt(40) is 21.03. 20 is kept and 19 is left out.
    expect(ids([40, 41, 20, 39, 40, 42, 40])).toEqual([40, 41, 20, 39, 40, 42, 40]);
    expect(ids([40, 41, 19, 39, 40, 42, 40])).toEqual([40, 41, 39, 40, 42, 40]);
  });

  it('keeps every round of a series of small scores with zeros, with bounds at or above 0', () => {
    // Median 2 (sorted 0, 0, 1, 2, 2, 3). Nothing is under 2 - 3 sqrt(2).
    const series = scoreSeries(rounds([0, 2, 1, 3, 0, 2]))!;
    expect(series.leftOut).toBe(0);
    expect(series.points).toHaveLength(6);
    for (const p of series.points.slice(1)) {
      expect(Number.isFinite(p.low!)).toBe(true);
      expect(Number.isFinite(p.high!)).toBe(true);
      expect(p.low!).toBeGreaterThanOrEqual(0);
      expect(p.high!).toBeGreaterThan(p.low!);
    }
    // The band reaches below 0 on the square-root scale, so its low end is 0.
    expect(series.next!.low).toBe(0);
    expect(series.next!.high).toBeCloseTo(12.595, 2);
  });

  it('takes the upper middle score as the median of an even number of rounds', () => {
    // Sorted: 10, 19, 40, 44. The upper middle is 40, so 19 is cut short and 20 would not be.
    expect(scoreSeries(rounds([40, 19, 44, 10]))!.leftOut).toBe(2);
    expect(scoreSeries(rounds([40, 20, 44, 10]))!.leftOut).toBe(1);
  });

  it('leaves no round out when the median is 0', () => {
    // No score is under 0, so the rule needs no special case. The spread is real, and wide.
    const series = scoreSeries(rounds([0, 0, 0, 40, 42]))!;
    expect(series.leftOut).toBe(0);
    expect(series.points.map((p) => p.score)).toEqual([0, 0, 0, 40, 42]);
    const trends = ewma([0, 0, 0, 40, 42]);
    series.points.forEach((p, i) => expect(p.trend).toBeCloseTo(trends[i]!, 10));
    expect(series.points[0]!.low).toBeNull();
    // Around a trend of 0 the band is 0 to the half-width squared.
    expect(series.points[1]!.low).toBe(0);
    expect(series.points[1]!.high!).toBeCloseTo(94.319, 2);
    expect(series.next!.low).toBe(0);
    expect(series.next!.high).toBeCloseTo(200.83, 1);
    // Every score 0: no spread, so no band.
    const zeros = scoreSeries(rounds([0, 0, 0, 0, 0, 0]))!;
    expect(zeros.leftOut).toBe(0);
    expect(zeros.next).toBeNull();
    for (const p of zeros.points) expect(p.low).toBeNull();
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
        for (const v of [p.low, p.high]) if (v !== null) expect(Number.isFinite(v) && v >= 0).toBe(true);
      }
      if (series.next !== null) {
        expect(Number.isFinite(series.next.low)).toBe(true);
        expect(Number.isFinite(series.next.high)).toBe(true);
        expect(series.next.low).toBeGreaterThanOrEqual(0);
      }
    }
    // Two zeros among 8 rounds are cut short, and the band is that of the other 6.
    const series = scoreSeries(rounds([0, 40, 0, 42, 44, 41, 43, 39]))!;
    expect(series.leftOut).toBe(2);
    expect(series.next).toEqual(scoreSeries(rounds([40, 42, 44, 41, 43, 39]))!.next);
  });
});
