import { describe, expect, it } from 'vitest';
import { defaultParams, operations } from '../../domain/operations/registry';
import { trueModel, typicalUser } from '../__sim__/simUser';
import { deriveParams, quantile, roundBound } from './derive';

describe('roundBound', () => {
  it.each([
    [7, 5],
    [8, 10],
    [12, 10],
    [48, 50],
    [52, 50],
    [216, 220],
  ])('%i rounds to %i', (n, expected) => expect(roundBound(n)).toBe(expected));
});

describe('quantile', () => {
  it('interpolates', () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([0, 10], 0.6)).toBeCloseTo(6, 12);
  });
});

describe('deriveParams', () => {
  it('changes only upper bounds, and keeps them multiples of 5 or 10', () => {
    const current = defaultParams();
    const { params } = deriveParams(trueModel(typicalUser()), current);
    expect(params.enabled).toEqual(current.enabled);
    for (const op of operations)
      for (const spec of op.paramShape.ranges) {
        const [lo, hi] = params.ranges[spec.key]!;
        expect(lo).toBe(current.ranges[spec.key]![0]);
        expect(hi % (hi < 50 ? 5 : 10) === 0 || hi === lo).toBe(true);
        expect(hi).toBeLessThanOrEqual(spec.testMax);
      }
  });

  it('leaves the ranges of a disabled operation group alone', () => {
    const current = defaultParams();
    const off = { ...current, enabled: { ...current.enabled, mul: false, div: false } };
    const { params } = deriveParams(trueModel(typicalUser()), off);
    expect(params.ranges.mulA).toEqual(current.ranges.mulA);
    expect(params.ranges.mulB).toEqual(current.ranges.mulB);
  });

  it('keeps a group whose derived operation alone is on', () => {
    const current = defaultParams();
    const subOnly = { ...current, enabled: { add: false, sub: true, mul: true, div: false } };
    const { params } = deriveParams(trueModel(typicalUser()), subOnly);
    expect(params.ranges.addA).not.toEqual(current.ranges.addA);
  });

  it('is deterministic', () => {
    expect(deriveParams(trueModel(typicalUser()), defaultParams())).toEqual(deriveParams(trueModel(typicalUser()), defaultParams()));
  });
});
