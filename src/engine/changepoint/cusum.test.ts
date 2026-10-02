import { describe, expect, it } from 'vitest';
import type { Trial } from '../../domain/types';
import { CUSUM_BURN_IN, CUSUM_H, CUSUM_MIN_OTHER_ROWS, CUSUM_MIN_TERM_ROWS } from '../constants';
import type { Stage2Matrix } from '../stage2/matrix';
import { detectShifts, sessionContrasts } from './cusum';

/** Contrasts with the given d values and one shared variance. */
function equalVariance(ds: readonly number[], v = 1): { d: number; v: number }[] {
  return ds.map((d) => ({ d, v }));
}

function repeat(d: number, times: number): number[] {
  return new Array<number>(times).fill(d);
}

describe('the constants this file was written against', () => {
  it('are a burn-in of 3 sessions and a threshold of 5', () => {
    // The hand-worked examples below use these values.
    expect(CUSUM_BURN_IN).toBe(3);
    expect(CUSUM_H).toBe(5);
  });
});

describe('detectShifts', () => {
  it('finds nothing in an empty list', () => {
    expect(detectShifts([])).toEqual([]);
  });

  it('finds nothing before the burn-in, however wild the contrasts', () => {
    expect(detectShifts(equalVariance([0, 100, -100]))).toEqual([]);
  });

  it('can fire on the first contrast after the burn-in and no earlier', () => {
    expect(detectShifts(equalVariance([0, 0, 0, 100]))).toEqual([{ at: 3, changeAt: 3, direction: 1 }]);
  });

  it('finds nothing in equal contrasts', () => {
    expect(detectShifts(equalVariance(repeat(0.3, 200), 0.01))).toEqual([]);
  });

  it('detects a clear step up with equal variances', () => {
    const shifts = detectShifts(equalVariance([...repeat(0, 10), ...repeat(3, 10)]));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.direction).toBe(1);
    expect(shifts[0]!.changeAt).toBe(10);
    expect(shifts[0]!.at).toBeGreaterThanOrEqual(10);
    expect(shifts[0]!.at).toBeLessThanOrEqual(12);
  });

  it('detects a clear step down with direction -1', () => {
    const shifts = detectShifts(equalVariance([...repeat(0, 10), ...repeat(-3, 10)]));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.direction).toBe(-1);
    expect(shifts[0]!.changeAt).toBe(10);
    expect(shifts[0]!.at).toBeLessThanOrEqual(12);
  });

  it('standardises with sqrt(v + 1 / W) against the weighted mean: three values by hand', () => {
    // Burn-in: three contrasts of 0 with variance 1, so W = 3 and S = 0.
    // Then three contrasts of d with variance 1. With K = 0.5:
    //   d = 3.2: z = 3.2 / sqrt(1 + 1/3) = 2.771, up = 2.271
    //            z = (3.2 - 0.8) / sqrt(1 + 1/4) = 2.147, up = 3.918
    //            z = (3.2 - 1.28) / sqrt(1 + 1/5) = 1.753, up = 5.171, above 5: alarm.
    //   d = 3.0: up = 2.098, then 3.611, then 4.754: no alarm.
    expect(detectShifts(equalVariance([0, 0, 0, 3.2, 3.2, 3.2]))).toEqual([{ at: 5, changeAt: 3, direction: 1 }]);
    expect(detectShifts(equalVariance([0, 0, 0, 3.0, 3.0, 3.0]))).toEqual([]);
  });

  it('is moved less by a contrast with a large variance than by one with a small variance', () => {
    const burnIn = equalVariance([0, 0, 0]);
    // Small variance: the hand-worked alarm above.
    expect(detectShifts([...burnIn, { d: 3.2, v: 1 }, { d: 3.2, v: 1 }, { d: 3.2, v: 1 }])).toHaveLength(1);
    // The same values with a variance of 16: z is 0.784, 0.768 and 0.753, so up ends at 0.805.
    expect(detectShifts([...burnIn, { d: 3.2, v: 16 }, { d: 3.2, v: 16 }, { d: 3.2, v: 16 }])).toEqual([]);
    // Only the first of the three is noisy. Its z is 0.319, so the sum stays at 0. It also
    // hardly moves the mean: the next two give z = 2.763 and 2.142, and up ends at 3.905.
    expect(detectShifts([...burnIn, { d: 3.2, v: 100 }, { d: 3.2, v: 1 }, { d: 3.2, v: 1 }])).toEqual([]);
  });

  it('weights the mean by precision', () => {
    // Burn-in of 0, 0 and one noisy 10. The weighted mean is 10 / 100 / 2.01 = 0.05, so a
    // contrast of 0 is nothing. An unweighted mean of 3.33 would make it look like a fall.
    const burnIn = [{ d: 0, v: 1 }, { d: 0, v: 1 }, { d: 10, v: 100 }];
    expect(detectShifts([...burnIn, ...equalVariance(repeat(0, 30))])).toEqual([]);
    // With the 10 as sure as the others, the same contrasts are a fall.
    const sure = detectShifts([...equalVariance([0, 0, 10]), ...equalVariance(repeat(0, 30))]);
    expect(sure).toHaveLength(1);
    expect(sure[0]!.direction).toBe(-1);
  });

  it('restarts after an alarm and needs the burn-in again', () => {
    // Alarm at 3. Positions 4, 5 and 6 are the new burn-in and cannot alarm. 7 can.
    const shifts = detectShifts(equalVariance([0, 0, 0, 10, 10, -10, 10, 100]));
    expect(shifts).toEqual([
      { at: 3, changeAt: 3, direction: 1 },
      { at: 7, changeAt: 7, direction: 1 },
    ]);
  });

  it('does not use the contrasts before a restart', () => {
    // After the alarm the new level is the baseline, so staying on it is no shift.
    const shifts = detectShifts(equalVariance([...repeat(0, 10), ...repeat(3, 40)]));
    expect(shifts).toHaveLength(1);
  });

  it('detects a step and then a step back', () => {
    const shifts = detectShifts(equalVariance([...repeat(0, 10), ...repeat(3, 10), ...repeat(0, 10)]));
    expect(shifts.map((s) => s.direction)).toEqual([1, -1]);
    expect(shifts[1]!.changeAt).toBe(20);
  });

  describe('bad contrasts', () => {
    const bad: [string, { d: number; v: number }][] = [
      ['a NaN d', { d: Number.NaN, v: 1 }],
      ['an infinite d', { d: Number.POSITIVE_INFINITY, v: 1 }],
      ['a negative infinite d', { d: Number.NEGATIVE_INFINITY, v: 1 }],
      ['a v of 0', { d: 100, v: 0 }],
      ['a negative v', { d: 100, v: -1 }],
      ['a NaN v', { d: 100, v: Number.NaN }],
      ['an infinite v', { d: 100, v: Number.POSITIVE_INFINITY }],
    ];

    for (const [name, contrast] of bad) {
      it(`${name} raises no alarm and leaves the rest as it was`, () => {
        const good = equalVariance([...repeat(0, 10), ...repeat(3, 10)]);
        const clean = detectShifts(good);
        // After the burn-in, where a contrast of 100 would alarm at once.
        const withBad = [...good.slice(0, 5), contrast, ...good.slice(5)];
        expect(detectShifts(withBad)).toEqual(clean.map((s) => ({ ...s, at: s.at + 1, changeAt: s.changeAt + 1 })));
        expect(detectShifts([...equalVariance(repeat(0, 10)), contrast])).toEqual([]);
      });

      it(`${name} does not count toward the burn-in`, () => {
        // Two good contrasts and a bad one are not a burn-in, so the 100 cannot alarm.
        expect(detectShifts([{ d: 0, v: 1 }, { d: 0, v: 1 }, contrast, { d: 100, v: 1 }])).toEqual([]);
        // The first 100 is the third good one, and the next can.
        expect(detectShifts([{ d: 0, v: 1 }, { d: 0, v: 1 }, contrast, { d: 100, v: 1 }, { d: 100, v: 1 }])).toEqual([
          { at: 4, changeAt: 4, direction: 1 },
        ]);
      });
    }

    it('only bad contrasts give nothing', () => {
      expect(detectShifts(bad.map(([, c]) => c))).toEqual([]);
    });
  });
});

/** A session's rows for the hand-made matrix: residuals on the term's rows and on the others. */
interface HandSession {
  sessionId: string;
  startMs: number;
  term: readonly number[];
  other: readonly number[];
}

/** A matrix with one term, 'x', whose rows alternate with the others inside each session. */
function handMatrix(sessions: readonly HandSession[]): Stage2Matrix {
  const trials: Trial[] = [];
  const residual: number[] = [];
  const values: number[] = [];
  for (const s of sessions) {
    const n = Math.max(s.term.length, s.other.length);
    let i = 0;
    const push = (r: number, holds: boolean) => {
      trials.push({ id: `${s.sessionId}-${i}`, sessionId: s.sessionId, completedAt: s.startMs + i * 1000 } as Trial);
      residual.push(r);
      values.push(holds ? 1 : 0);
      i++;
    };
    for (let j = 0; j < n; j++) {
      if (j < s.other.length) push(s.other[j]!, false);
      if (j < s.term.length) push(s.term[j]!, true);
    }
  }
  const all = trials.map((_, r) => r);
  return {
    rows: { trials, residual: Float64Array.from(residual), weight: new Float64Array(trials.length).fill(1), logT: new Float64Array(trials.length), all },
    terms: [{ id: 'x', atomIds: ['x'], values: Int8Array.from(values), nApplicable: values.length, nPositive: values.filter((v) => v === 1).length, prevalence: 0.5 }],
    blindSpots: [],
  };
}

describe('sessionContrasts', () => {
  const others = (n: number, value: number) => repeat(value, n);

  it('gives the mean on the term rows minus the mean on the other rows, with its variance', () => {
    const m = handMatrix([{ sessionId: 'a', startMs: 5000, term: [0.1, 0.2, 0.3, 0.4, 0.5], other: [...others(5, 0.1), ...others(5, -0.1)] }]);
    const out = sessionContrasts(m, 'x', 0.5);
    expect(out).toHaveLength(1);
    expect(out[0]!.sessionId).toBe('a');
    expect(out[0]!.at).toBe(5000);
    expect(out[0]!.d).toBeCloseTo(0.3, 12);
    expect(out[0]!.v).toBeCloseTo(0.25 * (1 / 5 + 1 / 10), 12);
  });

  it('subtracts the mean of the other rows, so a whole-session shift cancels', () => {
    const base = { sessionId: 'a', startMs: 0, term: [0.3, 0.3, 0.3, 0.3, 0.3], other: others(10, 0) };
    const shifted = { ...base, term: base.term.map((r) => r + 0.7), other: base.other.map((r) => r + 0.7) };
    expect(sessionContrasts(handMatrix([shifted]), 'x', 1)[0]!.d).toBeCloseTo(sessionContrasts(handMatrix([base]), 'x', 1)[0]!.d, 12);
  });

  it('keeps sessions in order of first appearance and dates each by its first row', () => {
    const m = handMatrix([
      { sessionId: 'z', startMs: 1000, term: repeat(1, 6), other: others(12, 0) },
      { sessionId: 'a', startMs: 900_000, term: repeat(2, 8), other: others(20, 1) },
      { sessionId: 'm', startMs: 2_000_000, term: repeat(-1, 5), other: others(10, 0) },
    ]);
    const out = sessionContrasts(m, 'x', 2);
    expect(out.map((c) => c.sessionId)).toEqual(['z', 'a', 'm']);
    expect(out.map((c) => c.at)).toEqual([1000, 900_000, 2_000_000]);
    expect(out.map((c) => c.d)).toEqual([1, 1, -1]);
    expect(out[0]!.v).toBeCloseTo(4 * (1 / 6 + 1 / 12), 12);
    expect(out[1]!.v).toBeCloseTo(4 * (1 / 8 + 1 / 20), 12);
    expect(out[2]!.v).toBeCloseTo(4 * (1 / 5 + 1 / 10), 12);
  });

  it('leaves out a session short of term rows and one short of other rows', () => {
    const m = handMatrix([
      { sessionId: 'ok1', startMs: 0, term: repeat(1, CUSUM_MIN_TERM_ROWS), other: others(CUSUM_MIN_OTHER_ROWS, 0) },
      { sessionId: 'few-term', startMs: 100_000, term: repeat(1, CUSUM_MIN_TERM_ROWS - 1), other: others(40, 0) },
      { sessionId: 'few-other', startMs: 200_000, term: repeat(1, 40), other: others(CUSUM_MIN_OTHER_ROWS - 1, 0) },
      { sessionId: 'no-term', startMs: 300_000, term: [], other: others(40, 0) },
      { sessionId: 'ok2', startMs: 400_000, term: repeat(1, 9), other: others(11, 0) },
    ]);
    expect(sessionContrasts(m, 'x', 1).map((c) => c.sessionId)).toEqual(['ok1', 'ok2']);
  });

  it('gives nothing for a term the matrix does not have', () => {
    const m = handMatrix([{ sessionId: 'a', startMs: 0, term: repeat(1, 10), other: others(20, 0) }]);
    expect(sessionContrasts(m, 'nope', 1)).toEqual([]);
  });

  it('feeds detectShifts', () => {
    const level = (s: number) => (s < 8 ? 0.3 : 0);
    const m = handMatrix(Array.from({ length: 16 }, (_, s) => ({ sessionId: `s${s}`, startMs: s * 86_400_000, term: repeat(level(s), 30), other: others(70, 0) })));
    const contrasts = sessionContrasts(m, 'x', 0.25);
    const shifts = detectShifts(contrasts);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.direction).toBe(-1);
    expect(contrasts[shifts[0]!.changeAt]!.sessionId).toBe('s8');
  });
});
