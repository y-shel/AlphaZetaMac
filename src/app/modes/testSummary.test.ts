import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../../engine/__sim__/simUser';
import { observations } from '../../engine/features';
import { summariseTest } from './testSummary';

describe('summariseTest', () => {
  it('gives a typical time per operation and suggested settings', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 100, seed: 1, mode: 'test' });
    const summary = summariseTest(observations(sim.trials), defaultParams());
    if (summary.kind !== 'ok') throw new Error('expected a summary');
    expect(summary.typicalMs.map((t) => t.opId)).toEqual(['add', 'sub', 'mul', 'div']);
    for (const { ms } of summary.typicalMs) {
      expect(ms).toBeGreaterThan(500);
      expect(ms).toBeLessThan(10_000);
    }
    expect(summary.suggested.enabled).toEqual(defaultParams().enabled);
  });

  it('reports insufficient data for too few answers', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 5, seed: 2, mode: 'test' });
    expect(summariseTest(observations(sim.trials), defaultParams()).kind).toBe('insufficient-data');
  });
});
