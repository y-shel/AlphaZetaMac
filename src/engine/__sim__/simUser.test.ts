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

describe('idPrefix', () => {
  const opts = { params: defaultParams(), sessions: 2, trialsPerSession: 5, seed: 6 };

  it('defaults to sim, so existing ids do not change', () => {
    const { trials, sessionShifts } = simulateTrials(typicalUser(), opts);
    expect(trials[0]!.id).toBe('sim-t00000000');
    expect(trials[0]!.sessionId).toBe('sim-s0000');
    expect(trials[9]!.id).toBe('sim-t00000009');
    expect(trials[9]!.sessionId).toBe('sim-s0001');
    expect(trials[9]!.prevTrialId).toBe('sim-t00000008');
    expect(Object.keys(sessionShifts)).toEqual(['sim-s0000', 'sim-s0001']);
    expect(simulateTrials(typicalUser(), { ...opts, idPrefix: 'sim' })).toEqual(simulateTrials(typicalUser(), opts));
  });

  it('names sessions and trials with the prefix and changes nothing else', () => {
    const plain = simulateTrials(typicalUser(), opts);
    const other = simulateTrials(typicalUser(), { ...opts, idPrefix: 'b' });
    expect(other.trials[0]!.id).toBe('b-t00000000');
    expect(other.trials[0]!.sessionId).toBe('b-s0000');
    expect(other.trials[9]!.prevTrialId).toBe('b-t00000008');
    expect(Object.keys(other.sessionShifts)).toEqual(['b-s0000', 'b-s0001']);
    const rename = (id: string) => id.replace(/^b-/, 'sim-');
    expect(other.trials.map((t) => ({ ...t, id: rename(t.id), sessionId: rename(t.sessionId), prevTrialId: t.prevTrialId === null ? null : rename(t.prevTrialId) }))).toEqual(plain.trials);
    expect(other.lapse).toEqual(plain.lapse);
  });

  it('lets two logs be joined with no shared id', () => {
    const a = simulateTrials(typicalUser(), opts).trials;
    const b = simulateTrials(typicalUser(), { ...opts, idPrefix: 'b' }).trials;
    const joined = [...a, ...b];
    expect(new Set(joined.map((t) => t.id)).size).toBe(joined.length);
    expect(new Set(joined.map((t) => t.sessionId)).size).toBe(4);
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

describe('injected weakness', () => {
  it('adds its effect to exactly the problems where every atom holds', () => {
    const user = typicalUser({ lapseRate: 0, sessionSd: 0, sigma: 0.2, weakness: { atomIds: ['op_mul', 'contains_7'], effect: 0.3 } });
    const sim = simulateTrials(user, { params: defaultParams(), sessions: 5, trialsPerSession: 400, seed: 4 });
    const obs = observations(sim.trials);
    let weak = 0;
    let sum = 0;
    sim.trials.forEach((t, i) => {
      const expected = t.opId === 'mul' && t.operands.some((n) => String(n).includes('7'));
      expect(sim.weak[i]).toBe(expected);
      if (expected) {
        weak++;
        sum += obs[i]!.y - trueMean(user, obs[i]!.problem);
      }
    });
    expect(weak).toBeGreaterThan(50);
    expect(Math.abs(sum / weak - 0.3)).toBeLessThan(0.05);
  });
});
