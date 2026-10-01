import { describe, expect, it } from 'vitest';
import { TRIAL_SCHEMA_VERSION, type Trial } from '../../domain/types';
import { trueModel, typicalUser } from '../__sim__/simUser';
import { LAPSE_MAX_MS } from '../constants';
import { predictStanding, typingGapMs } from './standing';

/** A trial whose keys land at the given times. */
function typed(times: readonly number[]): Trial {
  return {
    id: 't',
    schemaVersion: TRIAL_SCHEMA_VERSION,
    sessionId: 's',
    mode: 'normal',
    opId: 'add',
    operands: [1, 1],
    answer: 2,
    displayedAt: 0,
    keystrokes: times.map((t) => ({ k: '1', t })),
    completedAt: times.at(-1) ?? 0,
    indexInSession: 0,
    prevTrialId: null,
    paramsSnapshotId: 'p',
  };
}

describe('typingGapMs', () => {
  it('is 0 with no gaps', () => {
    expect(typingGapMs([])).toBe(0);
    expect(typingGapMs([typed([900]), typed([])])).toBe(0);
  });

  it('takes the upper middle for an even count', () => {
    // Gaps of 100, 300, 200 and 400.
    expect(typingGapMs([typed([1000, 1100, 1400]), typed([500, 700, 1100])])).toBe(300);
  });

  it('takes the middle for an odd count', () => {
    expect(typingGapMs([typed([1000, 1100, 1400, 1600])])).toBe(200);
  });
});

describe('predictStanding', () => {
  it('returns null when no default operation is fitted', () => {
    expect(predictStanding(trueModel(typicalUser({ alpha: {}, beta: {} })), 120)).toBeNull();
  });

  it('uses the mean time per problem: a user who always lapses averages half the lapse range', () => {
    const standing = predictStanding(trueModel(typicalUser({ lapseRate: 1 })), 0)!;
    expect(standing.overall.score).toBeCloseTo(120 / (LAPSE_MAX_MS / 2 / 1000), 9);
    for (const o of standing.operations) expect(o.score).toBeCloseTo(120 / (LAPSE_MAX_MS / 2 / 1000), 9);
  });

  it('scores lower than the median time alone would, because the mean of a skewed time is above its median', () => {
    const tight = predictStanding(trueModel(typicalUser({ lapseRate: 0, sigma: 0.01 })), 120)!;
    const loose = predictStanding(trueModel(typicalUser({ lapseRate: 0, sigma: 0.4 })), 120)!;
    expect(loose.overall.score).toBeLessThan(tight.overall.score * 0.97);
  });
});
