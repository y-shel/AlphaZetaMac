import { describe, expect, it } from 'vitest';
import { defaultParams, operations } from '../../domain/operations/registry';
import type { GeneratorParams } from '../../domain/types';
import { trueModel, typicalUser } from '../__sim__/simUser';
import type { LevelModel } from '../stage1/levelModel';
import { deriveParams, predictedLogTimes, quantile } from './derive';

/** Median predicted log time of one operation and the operations derived from it. */
function groupMedian(model: LevelModel, params: GeneratorParams, ownerId: string): number {
  const enabled = Object.fromEntries(operations.map((o) => [o.id, (o.derivesFrom ?? o.id) === ownerId]));
  return quantile(predictedLogTimes(model, { enabled, ranges: params.ranges }, 99), 0.5);
}

describe('parameter derivation: recovery', () => {
  it('puts every operation group at the target, unless its bounds hit an end of the search', () => {
    const users = [
      typicalUser(),
      typicalUser({ alpha: { add: 6.0, sub: 6.2, mul: 5.5, div: 5.7 } }),
      typicalUser({ alpha: { add: 5.6, sub: 5.8, mul: 5.9, div: 6.1 } }),
      typicalUser({ beta: { add: 0.3, sub: 0.3, mul: 0.5, div: 0.5 } }),
    ];
    let hit = 0;
    for (const user of users) {
      const model = trueModel(user);
      const current = defaultParams();
      const { raw, target } = deriveParams(model, current);
      for (const owner of operations.filter((o) => o.paramShape.ranges.length > 0)) {
        const gap = groupMedian(model, raw, owner.id) - target;
        const bounds = owner.paramShape.ranges.map((spec) => ({ spec, hi: raw.ranges[spec.key]![1], lo: current.ranges[spec.key]![0] }));
        const atCap = bounds.every(({ spec, hi }) => hi === Math.max(current.ranges[spec.key]![1], spec.testMax));
        const atFloor = bounds.every(({ hi, lo }) => hi === lo);
        if (atCap) expect(gap).toBeLessThan(0.05);
        else if (atFloor) expect(gap).toBeGreaterThan(-0.05);
        else {
          expect(Math.abs(gap)).toBeLessThan(0.05);
          hit++;
        }
      }
    }
    // Most groups are reachable. If this falls, the users above no longer test the search.
    expect(hit).toBeGreaterThanOrEqual(6);
  });

  it('stops at testMax when a group cannot get hard enough', () => {
    const model = trueModel(typicalUser({ alpha: { add: 5.2, sub: 5.4, mul: 6.3, div: 6.5 } }));
    const { params } = deriveParams(model, defaultParams());
    expect(params.ranges.addA![1]).toBe(300);
    expect(params.ranges.addB![1]).toBe(300);
  });
});
