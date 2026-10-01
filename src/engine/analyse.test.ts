import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import type { Trial, TrialMode } from '../domain/types';
import { simulateTrials, typicalUser } from './__sim__/simUser';
import { simSessions } from './__sim__/simSessions';
import { analyse } from './analyse';

/** The same trial under another non-experiment mode. */
function asMode(t: Trial, mode: Exclude<TrialMode, 'experiment'>): Trial {
  if (t.mode === 'experiment') throw new Error('simulated trials are never experiment trials');
  return { ...t, mode };
}

function log(sessions: number, trialsPerSession: number, seed: number, over = {}) {
  const params = defaultParams();
  const { trials } = simulateTrials(typicalUser(over), { params, sessions, trialsPerSession, seed });
  return { trials, sessions: simSessions(trials, params) };
}

describe('analyse', () => {
  it('handles an empty log', () => {
    const snap = analyse({ trials: [], sessions: [] });
    expect(snap).toMatchObject({ computedAt: 0, nTrials: 0, stage2: 'none', level: null, findings: [], score: null, standing: null });
  });

  it('runs no Stage 2 below 100 trials, the fallback below 200, and SuSiE from 200', () => {
    expect(analyse(log(1, 60, 1)).stage2).toBe('none');
    const small = analyse(log(3, 50, 2));
    expect(small.stage2).toBe('fallback');
    expect(small.findings).toEqual([]);
    expect(analyse(log(3, 100, 3)).stage2).toBe('susie');
  });

  it('is deterministic, and does not depend on the order trials arrive in', () => {
    const input = log(5, 100, 4, { weakness: { atomIds: ['contains_8'], effect: 0.3 } });
    const a = analyse(input);
    const b = analyse({ trials: [...input.trials].reverse(), sessions: [...input.sessions].reverse() });
    expect(b).toEqual(a);
  });

  it("states a found weakness in score points against the user's normal rounds", () => {
    const snap = analyse(log(10, 100, 5, { weakness: { atomIds: ['contains_8'], effect: 0.3 } }));
    const f = snap.findings.find((x) => x.terms.includes('contains_8'))!;
    expect(f).toBeDefined();
    expect(f.prevalenceEstimated).toBe(false);
    expect(f.prevalence).toBeGreaterThan(0.2);
    expect(f.scorePoints).toBeGreaterThan(0);
    expect(f.scorePointsLow).toBeLessThanOrEqual(f.scorePoints);
    expect(f.scorePointsHigh).toBeGreaterThanOrEqual(f.scorePoints);
    expect(f.effectMs).toBeGreaterThan(100);
    expect(f.discoveredAt).toBe(snap.computedAt);
  });

  it('estimates prevalence from default settings when there are no normal rounds', () => {
    const input = log(10, 100, 6, { weakness: { atomIds: ['contains_8'], effect: 0.3 } });
    const trials = input.trials.map((t) => asMode(t, 'test'));
    const sessions = input.sessions.map((s) => ({ ...s, mode: 'test' as const, durationS: null }));
    const snap = analyse({ trials, sessions });
    expect(snap.score).toBeNull();
    expect(snap.findings.find((x) => x.terms.includes('contains_8'))?.prevalenceEstimated).toBe(true);
  });

  it('gives a score series with a noise band, and a standing in bands', () => {
    const snap = analyse(log(10, 100, 7));
    expect(snap.score!.points).toHaveLength(10);
    const last = snap.score!.points.at(-1)!;
    expect(last.low!).toBeLessThan(last.trend);
    expect(last.high!).toBeGreaterThan(last.trend);
    expect(snap.standing!.operations.map((o) => o.opId)).toEqual(['add', 'sub', 'mul', 'div']);
    expect(snap.standing!.overall.band.approximate).toBe(true);
  });

  it('leaves train and experiment trials out of the model (invariant 5)', () => {
    const input = log(3, 100, 8);
    const trained = input.trials.map((t, i) => (i % 2 === 0 ? asMode(t, 'train') : t));
    expect(analyse({ ...input, trials: trained }).nEligible).toBe(150);
  });
});
