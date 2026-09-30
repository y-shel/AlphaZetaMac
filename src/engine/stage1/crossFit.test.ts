import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { LAPSE_MAX_MS, STAGE1_MIN_TRIALS } from '../constants';
import { observations } from '../features';
import { crossFit } from './crossFit';
import { ewmaWeights, fitLevelModel, predict } from './levelModel';

describe('crossFit', () => {
  it('needs STAGE1_MIN_TRIALS trials', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: STAGE1_MIN_TRIALS - 1, seed: 1 });
    expect(crossFit(observations(sim.trials)).kind).toBe('insufficient-data');
  });

  it('counts only trials at or below LAPSE_MAX_MS toward that minimum', () => {
    const sim = simulateTrials(typicalUser({ lapseRate: 0 }), { params: defaultParams(), sessions: 1, trialsPerSession: 110, seed: 9 });
    const obs = observations(sim.trials).map((o, i) => (i < 20 ? { ...o, y: Math.log(LAPSE_MAX_MS + 1000) } : o));
    expect(crossFit(obs).kind).toBe('insufficient-data');
  });

  it('gives every trial an out-of-fold residual', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 2, trialsPerSession: 100, seed: 2 });
    const cf = crossFit(observations(sim.trials));
    if (cf.kind !== 'ok') throw new Error(cf.reason);
    expect(cf.residual).toHaveLength(200);
    expect([...cf.residual].every(Number.isFinite)).toBe(true);
    expect([...cf.lapseResp].every((r) => r >= 0 && r <= 1)).toBe(true);
  });

  it('assigns folds by interleaving: a trial is predicted by a model that never saw it', () => {
    const sim = simulateTrials(typicalUser({ lapseRate: 0 }), { params: defaultParams(), sessions: 1, trialsPerSession: 150, seed: 3 });
    const obs = observations(sim.trials);
    const cf = crossFit(obs);
    if (cf.kind !== 'ok') throw new Error(cf.reason);
    // Refit fold 0 by hand: train on every trial whose index mod 5 is not 0, with the
    // weights of the full sequence.
    const all = ewmaWeights(obs.length);
    const train = obs.filter((_, i) => i % 5 !== 0);
    const w = Array.from(all).filter((_, i) => i % 5 !== 0);
    const fit = fitLevelModel(train, w);
    if (fit.kind !== 'ok') throw new Error(fit.reason);
    const o = obs[5]!;
    const expected = o.y - predict(fit.model, o.problem) - (fit.model.sessionOffsets[o.sessionId] ?? 0);
    expect(cf.residual[5]).toBeCloseTo(expected, 10);
  });
});
