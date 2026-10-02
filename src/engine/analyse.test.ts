import { describe, expect, it } from 'vitest';
import { defaultParams } from '../domain/operations/registry';
import type { Experiment, Trial, TrialMode } from '../domain/types';
import { simulateExperimentTrials } from './__sim__/simExperiment';
import { simulateTrials, typicalUser } from './__sim__/simUser';
import { simSessions } from './__sim__/simSessions';
import { analyse, stage2Method, type AnalysisSnapshot } from './analyse';
import { experimentState } from './confirm/experiment';
import { REFUTED_RETRY_TRIALS } from './constants';
import { findingId } from './findings/finding';
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
    const input = log(10, 100, 7);
    // The simulated sessions all score 100, and identical scores have no spread to draw.
    const sessions = [...input.sessions].sort((a, b) => a.startedAt - b.startedAt).map((s, i) => ({ ...s, score: 40 + (i % 3) }));
    const snap = analyse({ trials: input.trials, sessions });
    expect(snap.score!.points).toHaveLength(10);
    // Each band is where that round was expected to land, so the first round has none.
    expect(snap.score!.points[0]!.low).toBeNull();
    expect(snap.score!.points[0]!.high).toBeNull();
    for (const pt of snap.score!.points.slice(1)) {
      expect(pt.low).not.toBeNull();
      expect(pt.high).not.toBeNull();
      expect(pt.low!).toBeLessThan(pt.high!);
    }
    expect(snap.score!.next).not.toBeNull();
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
    expect(score.points[0]!.low).toBeNull();
    expect(score.points[0]!.high).toBeNull();
    for (const pt of score.points.slice(1)) {
      expect(pt.low).not.toBeNull();
      expect(pt.high).not.toBeNull();
      expect(pt.low!).toBeLessThan(pt.high!);
    }
    expect(score.next).not.toBeNull();
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
    expect(Object.keys(score).sort()).toEqual(['durationS', 'leftOut', 'next', 'points']);
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

describe('analyse with experiments', () => {
  const params = defaultParams();
  const START = 1_727_600_000_000;
  const DAY = 86_400_000;
  const weak = typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.15 } });
  // Seed 6: discovery reports the set ['contains_8'] as suspected, on these trials and with 1000 more.
  const base = simulateTrials(weak, { params, sessions: 10, trialsPerSession: 100, seed: 6 }).trials;
  const baseSessions = simSessions(base, params);
  const plain = analyse({ trials: base, sessions: baseSessions });
  const found = plain.findings.find((f) => f.terms.includes('contains_8'))!;
  const experiment: Experiment = { id: 'x1', terms: found.terms, createdAt: START + 15 * DAY };
  const played = (user: typeof weak, id = experiment.id): Trial[] =>
    simulateExperimentTrials(user, plain.level!, { ...experiment, id }, { params, rounds: 5, seed: 906, startMs: START + 20 * DAY });
  /** Play by the user with the weakness, which confirms it. */
  const confirming = played(weak);
  /** Play by a user without it, which rules it out. */
  const refuting = played(typicalUser());
  /** Level trials played after the experiment. */
  const later = simulateTrials(weak, { params, sessions: 10, trialsPerSession: 100, seed: 506, startMs: START + 40 * DAY, idPrefix: 'more' }).trials;
  const withLater = (n: number): AnalysisSnapshot => {
    const trials = [...base, ...later.slice(0, n)];
    return analyse({ trials: [...trials, ...refuting], sessions: simSessions(trials, params), experiments: [experiment] });
  };
  const of = (snap: AnalysisSnapshot) => snap.findings.find((f) => f.id === found.id);

  it('reports a finding with no experiment as testable and untested', () => {
    expect(found.tier).toBe('suspected');
    expect(found.terms).toEqual(['contains_8']);
    expect(found.experiment).toBeNull();
    expect(found.testable).toBe(true);
    expect(plain.ruledOut).toEqual([]);
    expect(plain.version).toBe(3);
  });

  it('confirms a finding by its experiment, at the deciding trial', () => {
    const snap = analyse({ trials: [...base, ...confirming], sessions: baseSessions, experiments: [experiment] });
    const state = experimentState(confirming, plain.level!);
    expect(state.outcome).toBe('confirmed');
    // The simulator answers every problem, so pair k is trials 2k - 2 and 2k - 1.
    const k = state.decidedAtPair!;
    const decidedAt = Math.max(confirming[2 * k - 2]!.completedAt, confirming[2 * k - 1]!.completedAt);
    const f = of(snap)!;
    expect(f.tier).toBe('confirmed');
    expect(f.experimentId).toBe('x1');
    expect(f.confirmedAt).toBe(decidedAt);
    expect(f.experiment).toEqual({ id: 'x1', outcome: 'confirmed', pairs: confirming.length / 2 });
    expect(f.replicated).toBe(false);
    // The experiment decides the tier and nothing else (spec 14.3).
    expect(f.effectMs).toBe(found.effectMs);
    expect(f.scorePoints).toBe(found.scorePoints);
    expect(snap.ruledOut).toEqual([]);
  });

  it('keeps experiment trials out of the level model (invariant 5)', () => {
    const snap = analyse({ trials: [...base, ...confirming], sessions: baseSessions, experiments: [experiment] });
    expect(snap.nTrials).toBe(base.length + confirming.length);
    expect(snap.nEligible).toBe(plain.nEligible);
    expect(snap.level).toEqual(plain.level);
  });

  it('shows an open experiment on the finding and leaves its tier alone', () => {
    const few = confirming.slice(0, 8);
    const snap = analyse({ trials: [...base, ...few], sessions: baseSessions, experiments: [experiment] });
    const f = of(snap)!;
    expect(f.tier).toBe('suspected');
    expect(f.experiment).toEqual({ id: 'x1', outcome: 'open', pairs: 4 });
    expect(f.experimentId).toBeUndefined();
    expect(f.confirmedAt).toBeUndefined();
  });

  it('hides a ruled-out finding, and proposes it again after 1000 more level trials (decision 5)', () => {
    const hidden = analyse({ trials: [...base, ...refuting], sessions: baseSessions, experiments: [experiment] });
    const state = experimentState(refuting, plain.level!);
    expect(state.outcome).toBe('ruled-out');
    expect(of(hidden)).toBeUndefined();
    expect(hidden.ruledOut).toEqual([{ findingId: found.id, terms: ['contains_8'], experimentId: 'x1', pairs: refuting.length / 2, decidedAt: state.decidedAt }]);

    expect(later).toHaveLength(REFUTED_RETRY_TRIALS);
    const still = withLater(REFUTED_RETRY_TRIALS - 1);
    expect(of(still)).toBeUndefined();
    expect(still.ruledOut.map((r) => r.findingId)).toEqual([found.id]);

    const back = withLater(REFUTED_RETRY_TRIALS);
    expect(back.ruledOut).toEqual([]);
    const f = of(back)!;
    expect(f.tier).toBe('suspected');
    expect(f.experiment).toMatchObject({ id: 'x1', outcome: 'ruled-out' });
    expect(f.experimentId).toBeUndefined();
    expect(f.confirmedAt).toBeUndefined();
  });

  it('ignores an experiment whose terms match no finding', () => {
    const stray: Experiment = { id: 'x1', terms: ['contains_3'], createdAt: START + 15 * DAY };
    expect(findingId(stray.terms)).not.toBe(found.id);
    const trials = [...base, ...confirming];
    const without = analyse({ trials, sessions: baseSessions });
    const snap = analyse({ trials, sessions: baseSessions, experiments: [stray] });
    expect(snap).toEqual(without);
    expect(of(snap)!.tier).toBe('suspected');
    expect(of(snap)!.experiment).toBeNull();
    expect(snap.findings.map((f) => f.id)).toEqual(plain.findings.map((f) => f.id));
    expect(snap.ruledOut).toEqual([]);
  });

  it('uses the newer of two experiments for one finding', () => {
    const newer: Experiment = { id: 'x0', terms: found.terms, createdAt: experiment.createdAt + DAY };
    const trials = [...base, ...confirming];
    for (const experiments of [[experiment, newer], [newer, experiment]]) {
      const f = of(analyse({ trials, sessions: baseSessions, experiments }))!;
      expect(f.experiment).toEqual({ id: 'x0', outcome: 'open', pairs: 0 });
      expect(f.tier).toBe('suspected');
    }
    // The newer one is the one judged when it is the one with the trials.
    const older: Experiment = { id: 'x2', terms: found.terms, createdAt: experiment.createdAt - DAY };
    const f = of(analyse({ trials, sessions: baseSessions, experiments: [experiment, older] }))!;
    expect(f.tier).toBe('confirmed');
    expect(f.experimentId).toBe('x1');
  });

  it('still analyses a log with a corrupt experiment trial, losing only its pair', () => {
    for (const bad of [NaN, -1]) {
      // The first trial, so the damaged pair comes before the deciding one.
      const corrupt = confirming.map((t, i) => (i === 0 ? { ...t, keystrokes: [{ k: '1', t: bad }] } : t));
      const f = of(analyse({ trials: [...base, ...corrupt], sessions: baseSessions, experiments: [experiment] }))!;
      expect(f.experiment).toEqual({ id: 'x1', outcome: 'confirmed', pairs: confirming.length / 2 - 1 });
      expect(f.tier).toBe('confirmed');
      expect(f.experimentId).toBe('x1');
    }
  });

  it('gives a tie in createdAt to the experiment with the larger id, whatever the input order', () => {
    const twin: Experiment = { id: 'x0', terms: found.terms, createdAt: experiment.createdAt };
    const trials = [...base, ...confirming];
    // x1 has the confirming trials and the larger id, so it is the one judged.
    for (const experiments of [[experiment, twin], [twin, experiment]]) {
      const f = of(analyse({ trials, sessions: baseSessions, experiments }))!;
      expect(f.experiment!.id).toBe('x1');
      expect(f.tier).toBe('confirmed');
    }
    const above: Experiment = { id: 'x2', terms: found.terms, createdAt: experiment.createdAt };
    for (const experiments of [[experiment, above], [above, experiment]]) {
      const f = of(analyse({ trials, sessions: baseSessions, experiments }))!;
      expect(f.experiment).toEqual({ id: 'x2', outcome: 'open', pairs: 0 });
      expect(f.tier).toBe('suspected');
    }
  });

  it('lets a ruled-out verdict outrank replication until a later experiment confirms (decision 5)', () => {
    const strong = typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.3 } });
    const first = simulateTrials(strong, { params, sessions: 10, trialsPerSession: 100, seed: 5 }).trials;
    const more = simulateTrials(strong, { params, sessions: 10, trialsPerSession: 100, seed: 505, startMs: START + 40 * DAY, idPrefix: 'more' }).trials;
    const run = (level: Trial[], other: Trial[], experiments: Experiment[]) => analyse({ trials: [...level, ...other], sessions: simSessions(level, params), experiments });

    // 1. Replicated, so confirmed with no experiment.
    const one = run(first, [], []);
    const f1 = one.findings.find((f) => f.terms.includes('contains_8'))!;
    expect(f1).toMatchObject({ tier: 'confirmed', replicated: true, experiment: null });
    const at = (snap: AnalysisSnapshot) => snap.findings.find((f) => f.id === f1.id);

    // 2. An experiment rules it out, so it is hidden.
    const x1: Experiment = { id: 'x1', terms: f1.terms, createdAt: START + 15 * DAY };
    const no = simulateExperimentTrials(typicalUser(), one.level!, x1, { params, rounds: 5, seed: 906, startMs: START + 20 * DAY });
    const two = run(first, no, [x1]);
    expect(at(two)).toBeUndefined();
    expect(two.ruledOut.map((r) => r.experimentId)).toEqual(['x1']);

    // 3. 1000 level trials later it is shown again, as suspected though it still replicates.
    const both = [...first, ...more];
    const three = run(both, no, [x1]);
    expect(at(three)).toMatchObject({ tier: 'suspected', replicated: true, experiment: { id: 'x1', outcome: 'ruled-out' } });
    expect(at(three)!.confirmedAt).toBeUndefined();
    expect(three.ruledOut).toEqual([]);

    // 4. A new experiment that is still open leaves it suspected.
    const x2: Experiment = { id: 'x2', terms: f1.terms, createdAt: START + 60 * DAY };
    const yes = simulateExperimentTrials(strong, three.level!, x2, { params, rounds: 5, seed: 907, startMs: START + 61 * DAY });
    const four = run(both, [...no, ...yes.slice(0, 8)], [x1, x2]);
    expect(at(four)).toMatchObject({ tier: 'suspected', replicated: true, experiment: { id: 'x2', outcome: 'open', pairs: 4 } });
    expect(at(four)!.confirmedAt).toBeUndefined();
    expect(four.ruledOut).toEqual([]);
    // An open retest started before the retry point does not bring it back early.
    const early = run(first, [...no, ...yes.slice(0, 8)], [x1, x2]);
    expect(at(early)).toBeUndefined();
    expect(early.ruledOut.map((r) => r.experimentId)).toEqual(['x1']);

    // 5. That experiment confirms, so it is confirmed.
    const five = run(both, [...no, ...yes], [x1, x2]);
    expect(at(five)).toMatchObject({ tier: 'confirmed', experimentId: 'x2', experiment: { id: 'x2', outcome: 'confirmed' } });
    expect(five.ruledOut).toEqual([]);
  });

  it('marks a finding with a sequence atom as not testable', () => {
    // Seed 3: the set is contains_8 or contains_8 after a different operation.
    const { trials } = simulateTrials(weak, { params, sessions: 10, trialsPerSession: 100, seed: 3 });
    const f = analyse({ trials, sessions: simSessions(trials, params) }).findings.find((x) => x.terms.includes('contains_8'))!;
    expect(f.terms).toEqual(['contains_8', 'contains_8&prev_op_differs']);
    expect(f.testable).toBe(false);
  });

  it('does not depend on the order of trials, sessions or experiments', () => {
    const other: Experiment = { id: 'x0', terms: found.terms, createdAt: experiment.createdAt - DAY };
    const trials = [...base, ...confirming, ...played(typicalUser(), 'x0')];
    const a = analyse({ trials, sessions: baseSessions, experiments: [experiment, other] });
    const b = analyse({ trials: [...trials].reverse(), sessions: [...baseSessions].reverse(), experiments: [other, experiment] });
    expect(b).toEqual(a);
    expect(of(a)!.experimentId).toBe('x1');
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
