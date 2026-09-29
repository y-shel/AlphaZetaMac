import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { observations } from '../features';
import { normal, simulateTrials, trueMean, typicalUser } from './simUser';

describe('simulateTrials', () => {
  it('is deterministic for a seed', () => {
    const opts = { params: defaultParams(), sessions: 2, trialsPerSession: 20, seed: 5 };
    expect(simulateTrials(typicalUser(), opts)).toEqual(simulateTrials(typicalUser(), opts));
  });

  it('builds well formed trials: answers typed, ids ordered, sessions chained', () => {
    const { trials } = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 3, trialsPerSession: 10, seed: 1, mode: 'test' });
    expect(trials).toHaveLength(30);
    expect([...trials].map((t) => t.id).sort()).toEqual(trials.map((t) => t.id));
    for (const t of trials) {
      expect(t.mode).toBe('test');
      expect(t.keystrokes.map((k) => k.k).join('')).toBe(String(t.answer));
      expect(t.completedAt).toBeGreaterThanOrEqual(t.displayedAt);
    }
    expect(trials[10]!.prevTrialId).toBeNull();
    expect(trials[11]!.prevTrialId).toBe(trials[10]!.id);
    expect(new Set(trials.map((t) => t.sessionId)).size).toBe(3);
  });

  it('injects lapses at the requested rate', () => {
    const { lapse } = simulateTrials(typicalUser({ lapseRate: 0.1 }), { params: defaultParams(), sessions: 10, trialsPerSession: 500, seed: 2 });
    const rate = lapse.filter(Boolean).length / lapse.length;
    expect(rate).toBeGreaterThan(0.09);
    expect(rate).toBeLessThan(0.11);
  });

  it('draws clean log times around the true mean plus the session shift, with sd sigma', () => {
    const user = typicalUser({ lapseRate: 0, sigma: 0.25, sessionSd: 0.1 });
    const sim = simulateTrials(user, { params: defaultParams(), sessions: 5, trialsPerSession: 1000, seed: 3 });
    const obs = observations(sim.trials);
    const e = obs.map((o) => o.y - trueMean(user, o.problem) - sim.sessionShifts[o.sessionId]!);
    const mean = e.reduce((a, b) => a + b, 0) / e.length;
    const sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / e.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(0.24);
    expect(sd).toBeLessThan(0.26);
  });
});

describe('normal', () => {
  it('has mean 0 and sd 1', () => {
    const rng = createRng(9);
    const xs = Array.from({ length: 20000 }, () => normal(rng));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
});
