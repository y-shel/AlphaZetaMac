import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import type { Trial, TrialMode } from '../domain/types';
import { simulateTrials, typicalUser } from './__sim__/simUser';
import { simSessions } from './__sim__/simSessions';
import { analyse, stage2Method } from './analyse';
import type { SusieFit } from './stage2/susie';

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

  it('gives a score series with a band from the scores, and a standing in bands', () => {
    const snap = analyse(log(10, 100, 7));
    expect(snap.score!.points).toHaveLength(10);
    for (const pt of snap.score!.points) {
      expect(pt.low).not.toBeNull();
      expect(pt.low!).toBeLessThan(pt.trend);
      expect(pt.high!).toBeGreaterThan(pt.trend);
    }
    expect(snap.standing!.operations.map((o) => o.opId)).toEqual(['add', 'sub', 'mul', 'div']);
    expect(snap.standing!.overall!.band.approximate).toBe(true);
  });

  it('shows a band for 10 rounds even when the session means vary less than their sampling noise', () => {
    // sessionSd 0 on seed 1 used to give no band, because the band came from the level model's
    // session variance. It now comes from the scores, so 10 rounds always have one.
    const input = log(10, 100, 1, { sessionSd: 0 });
    // Scores that rise every session.
    const sessions = [...input.sessions]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s, i) => ({ ...s, score: 40 + i }));
    const score = analyse({ trials: input.trials, sessions }).score!;
    expect(score.points).toHaveLength(10);
    expect(score.points.at(-1)!.trend).toBeGreaterThan(score.points[0]!.trend);
    for (const pt of score.points) {
      expect(pt.low).not.toBeNull();
      expect(pt.low!).toBeLessThan(pt.trend);
      expect(pt.high!).toBeGreaterThan(pt.trend);
    }
  });

  it('keeps the score series, with no band, below 100 trials', () => {
    const snap = analyse(log(1, 60, 1));
    expect(snap.stage2).toBe('none');
    expect(snap.score).not.toBeNull();
    expect(snap.score!.points).toHaveLength(1);
    expect(snap.score!.points[0]!.score).toBe(60);
    expect(snap.score!.points[0]!.low).toBeNull();
    expect(snap.score!.points[0]!.high).toBeNull();
  });

  it('makes no claim about improvement: the series is points and a duration only', () => {
    // A trend above the first band is not a calibrated test, so the snapshot carries no such flag.
    const input = log(10, 100, 7);
    const sessions = [...input.sessions].sort((a, b) => a.startedAt - b.startedAt).map((s, i) => ({ ...s, score: 40 + 5 * i }));
    const score = analyse({ trials: input.trials, sessions }).score!;
    expect(score.points.at(-1)!.high).not.toBeNull();
    expect(Object.keys(score).sort()).toEqual(['durationS', 'points']);
  });

  it('leaves train and experiment trials out of the model (invariant 5)', () => {
    const input = log(3, 100, 8);
    const trained = input.trials.map((t, i) => (i % 2 === 0 ? asMode(t, 'train') : t));
    expect(analyse({ ...input, trials: trained }).nEligible).toBe(150);
  });

  it('analyses trials in completedAt order, not id order', () => {
    const input = log(5, 100, 4, { weakness: { atomIds: ['contains_8'], effect: 0.3 } });
    const byTime = [...input.trials].sort((a, b) => a.completedAt - b.completedAt);
    // The same trials with ids that sort the other way round from their times.
    const width = String(byTime.length).length;
    const newId = new Map(byTime.map((t, i) => [t.id, `t${String(byTime.length - i).padStart(width, '0')}`]));
    const swapped = byTime.map((t) => ({ ...t, id: newId.get(t.id)!, prevTrialId: t.prevTrialId === null ? null : newId.get(t.prevTrialId)! }));
    expect(swapped[0]!.id > swapped.at(-1)!.id).toBe(true);
    const expected = analyse(input);
    const snap = analyse({ trials: swapped, sessions: input.sessions });
    expect(snap.computedAt).toBe(byTime.at(-1)!.completedAt);
    expect(snap).toEqual(expected);
    expect(analyse({ trials: [...swapped].reverse(), sessions: input.sessions })).toEqual(expected);
  });

  it('breaks a tie in completedAt by id', () => {
    const input = log(3, 100, 3);
    const tied = input.trials.map((t) => ({ ...t, completedAt: 5 }));
    const a = analyse({ trials: tied, sessions: input.sessions });
    expect(analyse({ trials: [...tied].reverse(), sessions: input.sessions })).toEqual(a);
  });
});

describe('stage2Method', () => {
  const fit = (converged: boolean): SusieFit => ({ pip: new Float64Array(0), sets: [], sigma2: 1, elbo: 0, iterations: 100, converged });

  it('reports SuSiE for a fit that converged', () => {
    expect(stage2Method(fit(true))).toBe('susie');
  });

  it('falls back when the fit did not converge (spec 19)', () => {
    expect(stage2Method(fit(false))).toBe('fallback');
  });
});
