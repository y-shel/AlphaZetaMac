// Lives beside the worker because it times the worker's job, and src/engine may not read the clock.
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import { simulateTrials, typicalUser } from '../engine/__sim__/simUser';
import { simSessions } from '../engine/__sim__/simSessions';
import { analyse } from '../engine/analyse';

describe('analysis speed (spec 17.5)', () => {
  it('analyses a 30k-trial log in under 2 seconds', () => {
    const params = defaultParams();
    const { trials } = simulateTrials(typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.15 } }), { params, sessions: 300, trialsPerSession: 100, seed: 1 });
    const sessions = simSessions(trials, params);
    const start = performance.now();
    analyse({ trials, sessions });
    const ms = performance.now() - start;
    console.log(`analysed ${trials.length} trials in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
