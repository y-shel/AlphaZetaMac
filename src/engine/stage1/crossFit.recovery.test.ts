import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { observations } from '../features';
import { crossFit } from './crossFit';
import { fitLevelModel, predict } from './levelModel';

describe('cross-fitting: recovery', () => {
  it('does not compress residual variance the way in-sample fitting does', () => {
    const SIGMA = 0.25;
    const USERS = 50;
    let inSample = 0;
    let outOfFold = 0;
    for (let seed = 0; seed < USERS; seed++) {
      const sim = simulateTrials(typicalUser({ lapseRate: 0, sessionSd: 0, sigma: SIGMA }), {
        params: defaultParams(),
        sessions: 1,
        trialsPerSession: 150,
        seed: 300 + seed,
      });
      const obs = observations(sim.trials);
      const fit = fitLevelModel(obs);
      const cf = crossFit(obs);
      if (fit.kind !== 'ok' || cf.kind !== 'ok') throw new Error('fit failed');
      let a = 0;
      let b = 0;
      obs.forEach((o, i) => {
        a += (o.y - predict(fit.model, o.problem) - (fit.model.sessionOffsets[o.sessionId] ?? 0)) ** 2;
        b += cf.residual[i]! ** 2;
      });
      inSample += a / obs.length / USERS;
      outOfFold += b / obs.length / USERS;
    }
    const truth = SIGMA ** 2;
    expect(inSample).toBeLessThan(0.97 * truth);
    expect(outOfFold).toBeGreaterThan(0.98 * truth);
    expect(outOfFold).toBeLessThan(1.2 * truth);
  });
});
