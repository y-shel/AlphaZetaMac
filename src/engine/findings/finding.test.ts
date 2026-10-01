import { describe, expect, it } from 'vitest';
import { findingId, scorePoints } from './finding';

describe('scorePoints', () => {
  it('is roundSeconds × prevalence × (1 − e^−effect) / seconds per problem (spec 12.3)', () => {
    expect(scorePoints(0.2, 0.11, 120, 2.5)).toBeCloseTo((120 * 0.11 * (1 - Math.exp(-0.2))) / 2.5, 12);
    expect(scorePoints(0, 0.5, 120, 2)).toBe(0);
  });
});

describe('findingId', () => {
  it('depends on the set of terms, not their order', () => {
    expect(findingId(['b', 'a'])).toBe(findingId(['a', 'b']));
    expect(findingId(['a'])).not.toBe(findingId(['b']));
    expect(findingId(['a'])).toMatch(/^f-[0-9a-f]{14}$/);
  });
});
