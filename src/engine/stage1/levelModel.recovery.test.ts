import { describe, expect, it } from 'vitest';
import { defaultParams, operations } from '../../domain/operations/registry';
import { simulateTrials, typicalUser, type SimUser } from '../__sim__/simUser';
import { observations } from '../features';
import { fitLevelModel, gammaSe } from './levelModel';

function fit(user: SimUser, seed: number, sessions: number, trialsPerSession: number) {
  const sim = simulateTrials(user, { params: defaultParams(), sessions, trialsPerSession, seed });
  const result = fitLevelModel(observations(sim.trials));
  if (result.kind !== 'ok') throw new Error(result.reason);
  return { sim, ...result };
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  a.forEach((v, i) => {
    sab += (v - ma) * (b[i]! - mb);
    saa += (v - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  });
  return sab / Math.sqrt(saa * sbb);
}

describe('level model: recovery', () => {
  it('recovers slopes, gamma and sigma, and intercepts up to the shared session shift', () => {
    const user = typicalUser({ lapseRate: 0.03, sessionSd: 0.1 });
    const { model, sim } = fit(user, 1, 10, 200);
    for (const op of operations.map((o) => o.id)) {
      expect(Math.abs(model.beta[op]! - user.beta[op]!)).toBeLessThan(0.06);
      // The mean shift of the sessions seen cannot be told apart from the intercept.
      expect(Math.abs(model.alpha[op]! - user.alpha[op]!)).toBeLessThan(0.3);
    }
    expect(Math.abs(model.gamma - user.gamma)).toBeLessThan(0.2);
    expect(Math.abs(model.sigma - user.sigma)).toBeLessThan(0.02);
    const ids = Object.keys(sim.sessionShifts);
    expect(correlation(ids.map((s) => sim.sessionShifts[s]!), ids.map((s) => model.sessionOffsets[s]!))).toBeGreaterThan(0.9);
  });

  it('recovers the injected lapse rate and flags most lapses', () => {
    const rates: number[] = [];
    let lapses = 0;
    let flagged = 0;
    for (let seed = 0; seed < 50; seed++) {
      const { model, sim, lapseResp } = fit(typicalUser({ lapseRate: 0.05 }), 900 + seed, 5, 200);
      rates.push(model.lapseRate);
      sim.lapse.forEach((isLapse, i) => {
        if (!isLapse) return;
        lapses++;
        if (lapseResp[i]! > 0.5) flagged++;
      });
    }
    rates.sort((a, b) => a - b);
    expect(Math.abs(rates[25]! - 0.05)).toBeLessThan(0.01);
    expect(rates[0]).toBeGreaterThan(0.025);
    expect(rates[49]).toBeLessThan(0.08);
    // A lapse that lands inside the normal range of times cannot be told apart. About a
    // quarter of uniform lapses do.
    expect(flagged / lapses).toBeGreaterThan(0.6);
  });
});

/**
 * Share of 95% intervals that cover the truth, as [alpha, beta, gamma], over 1000 users.
 * Alpha and beta count only fitted operations. In one short session an operation can fall
 * below the trial minimum, and that is not a coverage failure.
 */
function coverage(sessions: number, trialsPerSession: number): [number, number, number] {
  const USERS = 1000;
  let alpha = 0;
  let beta = 0;
  let gamma = 0;
  let fitted = 0;
  for (let seed = 0; seed < USERS; seed++) {
    const user = typicalUser({ sessionSd: 0 });
    const { model } = fit(user, 1000 + seed, sessions, trialsPerSession);
    const k = 2 * model.opIds.length + 1;
    model.opIds.forEach((op, j) => {
      fitted++;
      const sa = Math.sqrt(model.cov[2 * j * k + 2 * j]!);
      const sb = Math.sqrt(model.cov[(2 * j + 1) * k + 2 * j + 1]!);
      if (Math.abs(model.alpha[op]! - user.alpha[op]!) < 1.96 * sa) alpha++;
      if (Math.abs(model.beta[op]! - user.beta[op]!) < 1.96 * sb) beta++;
    });
    if (Math.abs(model.gamma - user.gamma) < 1.96 * gammaSe(model)) gamma++;
  }
  return [alpha / fitted, beta / fitted, gamma / USERS];
}

function expectNominal([alpha, beta, gamma]: [number, number, number]) {
  for (const c of [alpha, beta]) {
    expect(c).toBeGreaterThan(0.935);
    expect(c).toBeLessThan(0.965);
  }
  expect(gamma).toBeGreaterThan(0.93);
  expect(gamma).toBeLessThan(0.97);
}

describe('level model: calibration', () => {
  it('95% intervals cover the truth about 95% of the time', () => {
    expectNominal(coverage(6, 100));
  });

  it('95% intervals hold in the Test tab regime, one session of 100', () => {
    expectNominal(coverage(1, 100));
  });

  it('flags almost no clean trial as a lapse', () => {
    let flagged = 0;
    let total = 0;
    for (let seed = 0; seed < 50; seed++) {
      const { model, lapseResp } = fit(typicalUser({ lapseRate: 0 }), 500 + seed, 5, 200);
      expect(model.lapseRate).toBeLessThan(0.01);
      for (const r of lapseResp) {
        total++;
        if (r > 0.5) flagged++;
      }
    }
    expect(flagged / total).toBeLessThan(0.002);
  });
});
