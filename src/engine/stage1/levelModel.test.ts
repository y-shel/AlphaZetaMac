import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { HALF_LIFE_TRIALS, LAPSE_MAX_MS } from '../constants';
import type { Problem } from '../../domain/types';
import { observations, sizeOf, type Obs } from '../features';
import { priorOffset } from '../prior/populationPrior';
import { ewmaWeights, fitLevelModel, gammaSe, lapseResponsibility, predict, predictionSe, type LevelModel } from './levelModel';

describe('ewmaWeights', () => {
  it('gives the newest trial weight 1 and halves every HALF_LIFE_TRIALS back', () => {
    const w = ewmaWeights(HALF_LIFE_TRIALS * 2 + 1);
    expect(w.at(-1)).toBe(1);
    expect(w[HALF_LIFE_TRIALS]).toBeCloseTo(0.5, 12);
    expect(w[0]).toBeCloseTo(0.25, 12);
  });
});

describe('lapseResponsibility', () => {
  it('is near 0 for a typical residual and near 1 far in the tail', () => {
    expect(lapseResponsibility(Math.log(1500), 0, 0.25, 0.02)).toBeLessThan(0.01);
    expect(lapseResponsibility(Math.log(9000), 1.8, 0.25, 0.02)).toBeGreaterThan(0.99);
    expect(lapseResponsibility(Math.log(40), -3.6, 0.25, 0.02)).toBeGreaterThan(0.99);
  });

  it('is 1 above LAPSE_MAX_MS', () => {
    expect(lapseResponsibility(Math.log(LAPSE_MAX_MS + 1), 0, 0.25, 0.02)).toBe(1);
  });
});

describe('fitLevelModel', () => {
  it('fits a clean simulated user closely', () => {
    const user = typicalUser({ lapseRate: 0, sessionSd: 0 });
    const sim = simulateTrials(user, { params: defaultParams(), sessions: 5, trialsPerSession: 400, seed: 11 });
    const fit = fitLevelModel(observations(sim.trials));
    if (fit.kind !== 'ok') throw new Error(fit.reason);
    expect(fit.model.opIds).toEqual(['add', 'sub', 'mul', 'div']);
    for (const op of fit.model.opIds) expect(Math.abs(fit.model.beta[op]! - user.beta[op]!)).toBeLessThan(0.1);
    expect(Math.abs(fit.model.sigma - 0.25)).toBeLessThan(0.02);
    expect(fit.model.nObs).toBe(2000);
    expect(fit.lapseResp).toHaveLength(2000);
  });

  it('is deterministic', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 2, trialsPerSession: 100, seed: 12 });
    const obs = observations(sim.trials);
    expect(fitLevelModel(obs)).toEqual(fitLevelModel(obs));
  });

  it('leaves out an operation with too few trials and marks its inputs NaN', () => {
    const add = (a: number, b: number, y: number): Obs => ({ problem: { opId: 'add', operands: [a, b], answer: a + b }, y, sessionId: 's' });
    const obs: Obs[] = [];
    for (let i = 0; i < 30; i++) obs.push(add(10 + i, 20 + (i % 7), 7 + 0.01 * i));
    obs.push({ problem: { opId: 'mul', operands: [3, 4], answer: 12 }, y: 7, sessionId: 's' });
    const fit = fitLevelModel(obs);
    if (fit.kind !== 'ok') throw new Error(fit.reason);
    expect(fit.model.opIds).toEqual(['add']);
    expect(fit.lapseResp[30]).toBeNaN();
    expect(() => predict(fit.model, obs[30]!.problem)).toThrow(/mul/);
  });

  it('reports insufficient data when no operation has enough trials', () => {
    const obs: Obs[] = [{ problem: { opId: 'add', operands: [1, 2], answer: 3 }, y: 7, sessionId: 's' }];
    expect(fitLevelModel(obs).kind).toBe('insufficient-data');
  });

  it('does not crash when every time is identical', () => {
    const obs: Obs[] = Array.from({ length: 40 }, (_, i) => ({
      problem: { opId: 'add', operands: [i + 2, 3], answer: i + 5 },
      y: Math.log(900),
      sessionId: 's',
    }));
    const fit = fitLevelModel(obs);
    if (fit.kind !== 'ok') throw new Error(fit.reason);
    expect(Number.isFinite(fit.model.sigma)).toBe(true);
    expect(Number.isFinite(fit.model.alpha.add!)).toBe(true);
  });

  const cleanAdd = (i: number): Obs => ({
    problem: { opId: 'add', operands: [10 + i, 20 + (i % 7)], answer: 30 + i + (i % 7) },
    y: Math.log(1200 + 13 * ((i * 7) % 11)),
    sessionId: 's',
  });

  it('does not count times above LAPSE_MAX_MS toward the operation minimum', () => {
    const obs: Obs[] = Array.from({ length: 40 }, (_, i) => cleanAdd(i));
    for (let i = 0; i < 12; i++) {
      obs.push({ problem: { opId: 'div', operands: [56, 7], answer: 8 }, y: Math.log(LAPSE_MAX_MS + 1000 + i), sessionId: 's' });
    }
    const fit = fitLevelModel(obs);
    if (fit.kind !== 'ok') throw new Error(fit.reason);
    expect(fit.model.opIds).toEqual(['add']);
    expect(fit.lapseResp[45]).toBeNaN();
  });

  it('reports insufficient data when every trial is a lapse', () => {
    const obs: Obs[] = Array.from({ length: 40 }, (_, i) => ({ ...cleanAdd(i), y: Math.log(LAPSE_MAX_MS + 1000 + i) }));
    expect(fitLevelModel(obs).kind).toBe('insufficient-data');
  });
});

describe('predictionSe and gammaSe', () => {
  it('read the full covariance, gamma column included', () => {
    // k = 5: [alpha_add, beta_add, alpha_sub, beta_sub, gamma]. Symmetric, row-major.
    const cov = [
      0.04,  0.01,  0.02, 0,     0.03,
      0.01,  0.09,  0,    0,    -0.02,
      0.02,  0,     0.25, 0.05,  0.06,
      0,     0,     0.05, 0.01, -0.01,
      0.03, -0.02,  0.06, -0.01, 0.16,
    ];
    const model: LevelModel = {
      opIds: ['add', 'sub'],
      alpha: { add: 0, sub: 0 },
      beta: { add: 0, sub: 0 },
      gamma: 0,
      sigma: 1,
      lapseRate: 0,
      cov,
      sessionOffsets: {},
      nObs: 0,
    };
    const add: Problem = { opId: 'add', operands: [38, 45], answer: 83 };
    const s = sizeOf(add);
    const g = priorOffset(add);
    expect(g).not.toBe(0);
    const vAdd = 0.04 + s * s * 0.09 + g * g * 0.16 + 2 * s * 0.01 + 2 * g * 0.03 + 2 * s * g * -0.02;
    expect(predictionSe(model, add)).toBeCloseTo(Math.sqrt(vAdd), 12);

    const sub: Problem = { opId: 'sub', operands: [52, 17], answer: 35 };
    const t = sizeOf(sub);
    const h = priorOffset(sub);
    expect(h).not.toBe(0);
    const vSub = 0.25 + t * t * 0.01 + h * h * 0.16 + 2 * t * 0.05 + 2 * h * 0.06 + 2 * t * h * -0.01;
    expect(predictionSe(model, sub)).toBeCloseTo(Math.sqrt(vSub), 12);

    expect(gammaSe(model)).toBeCloseTo(0.4, 12);
    expect(() => predictionSe(model, { opId: 'mul', operands: [3, 4], answer: 12 })).toThrow(/mul/);
  });
});
