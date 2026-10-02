import { describe, expect, it } from 'vitest';
import { TRIAL_SCHEMA_VERSION, type Arm, type Problem, type Trial } from '../../domain/types';
import { simulateTrials, trueModel, typicalUser } from '../__sim__/simUser';
import { defaultParams } from '../../domain/operations/registry';
import { observations } from '../features';
import { fitLevelModel } from '../stage1/levelModel';
import { evaluatePairs } from './eprocess';
import { experimentPairs, experimentState } from './experiment';
import { pairEvidence } from './pairs';

const level = (() => {
  const { trials } = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 3, trialsPerSession: 100, seed: 11 });
  const fit = fitLevelModel(observations(trials));
  if (fit.kind !== 'ok') throw new Error(fit.reason);
  return fit.model;
})();

const T: Problem = { opId: 'add', operands: [38, 58], answer: 96 };
const C: Problem = { opId: 'add', operands: [34, 57], answer: 91 };

interface Spec {
  session: string;
  index: number;
  arm: Arm;
  /** First key time in ms, or null for a trial with no keystroke. */
  ms: number | null;
  /** When the session started. */
  at: number;
}

function trial(s: Spec): Trial {
  const problem = s.arm === 'treatment' ? T : C;
  const displayedAt = s.at + s.index * 10_000;
  return {
    id: `${s.session}-${String(s.index).padStart(3, '0')}`,
    schemaVersion: TRIAL_SCHEMA_VERSION,
    sessionId: s.session,
    mode: 'experiment',
    experimentId: 'x1',
    arm: s.arm,
    opId: problem.opId,
    operands: [...problem.operands],
    answer: problem.answer,
    displayedAt,
    keystrokes: s.ms === null ? [] : [{ k: '9', t: s.ms }],
    completedAt: displayedAt + (s.ms ?? 0) + 100,
    indexInSession: s.index,
    prevTrialId: null,
    paramsSnapshotId: 'ps',
  };
}

const session = (id: string, at: number, rows: readonly (readonly [Arm, number | null])[]): Trial[] =>
  rows.map(([arm, ms], index) => trial({ session: id, index, arm, ms, at }));

const ev = (treatmentMs: number, controlMs: number) => pairEvidence(level, { treatment: T, control: C }, treatmentMs, controlMs);

describe('experimentPairs', () => {
  it('reads pairs two at a time, whichever arm came first', () => {
    const trials = session('s1', 1000, [
      ['treatment', 2000],
      ['control', 1500],
      ['control', 1400],
      ['treatment', 2600],
    ]);
    expect(experimentPairs(trials, level)).toEqual([ev(2000, 1500), ev(2600, 1400)]);
  });

  it('drops the unpaired trial a session ends on', () => {
    const trials = session('s1', 1000, [
      ['treatment', 2000],
      ['control', 1500],
      ['treatment', 2600],
    ]);
    expect(experimentPairs(trials, level)).toEqual([ev(2000, 1500)]);
  });

  it('drops two treatments in a row and keeps reading two at a time', () => {
    const trials = session('s1', 1000, [
      ['treatment', 2000],
      ['treatment', 2100],
      ['control', 1400],
      ['treatment', 2600],
    ]);
    expect(experimentPairs(trials, level)).toEqual([ev(2600, 1400)]);
  });

  it('drops a pair with a trial that has no keystroke', () => {
    const trials = session('s1', 1000, [
      ['treatment', null],
      ['control', 1500],
      ['control', 1400],
      ['treatment', 2600],
    ]);
    expect(experimentPairs(trials, level)).toEqual([ev(2600, 1400)]);
  });

  it('puts the pairs of the earlier session first, and never pairs across sessions', () => {
    const later = session('a-later', 900_000, [
      ['control', 1100],
      ['treatment', 2100],
      ['treatment', 2300],
    ]);
    const earlier = session('z-earlier', 1000, [
      ['treatment', 2000],
      ['control', 1500],
      ['control', 1700],
    ]);
    expect(experimentPairs([...later, ...earlier], level)).toEqual([ev(2000, 1500), ev(2100, 1100)]);
  });

  it('gives finite evidence', () => {
    const trials = session('s1', 1000, [
      ['treatment', 0],
      ['control', 1500],
    ]);
    const [e] = experimentPairs(trials, level);
    expect(Number.isFinite(e!.d)).toBe(true);
    expect(e!.se).toBeGreaterThan(0);
  });

  it('drops a pair on an operation the level model has no fit for', () => {
    const addOnly = { ...trueModel(typicalUser()), opIds: ['sub'], alpha: { sub: 6 }, beta: { sub: 0.35 }, cov: new Array<number>(9).fill(0) };
    const trials = session('s1', 1000, [
      ['treatment', 2000],
      ['control', 1500],
    ]);
    expect(experimentPairs(trials, addOnly)).toEqual([]);
  });
});

describe('experimentState', () => {
  // A large effect: the treatment takes three times as long. Sessions of 5 pairs.
  const sessions = Array.from({ length: 8 }, (_, s) =>
    session(
      `s${s}`,
      1000 + s * 1_000_000,
      Array.from({ length: 10 }, (_, i): [Arm, number] => {
        const treatmentFirst = (s + Math.floor(i / 2)) % 2 === 0;
        const isTreatment = (i % 2 === 0) === treatmentFirst;
        return isTreatment ? ['treatment', 3000 + 10 * i] : ['control', 1000 + 10 * i];
      }),
    ),
  );
  const trials = sessions.flat();

  it('equals evaluatePairs over experimentPairs', () => {
    const state = experimentState(trials, level);
    const { decidedAt, ...rest } = state;
    expect(rest).toEqual(evaluatePairs(experimentPairs(trials, level)));
    expect(state.outcome).toBe('confirmed');
    expect(state.pairs).toBe(40);
    expect(decidedAt).not.toBeNull();
  });

  it('dates the decision at the later trial of the deciding pair', () => {
    const state = experimentState(trials, level);
    const n = state.decidedAtPair!;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(40);
    // No pair is dropped here, so pair n is trials 2n-2 and 2n-1 in time order.
    const a = trials[2 * n - 2]!;
    const b = trials[2 * n - 1]!;
    expect(b.completedAt).toBeGreaterThan(a.completedAt);
    expect(state.decidedAt).toBe(b.completedAt);
  });

  it('uses the later completedAt even when that trial has the lower index', () => {
    const [first, second] = session('s1', 1000, [
      ['treatment', 3000],
      ['control', 1000],
    ]) as [Trial, Trial];
    const odd = [{ ...first, completedAt: second.completedAt + 5000 }, second];
    const many = Array.from({ length: 30 }, (_, s) => odd.map((t) => ({ ...t, sessionId: `s${String(s).padStart(2, '0')}`, displayedAt: t.displayedAt + s * 1_000_000, completedAt: t.completedAt + s * 1_000_000 })));
    const state = experimentState(many.flat(), level);
    expect(state.outcome).toBe('confirmed');
    expect(state.decidedAt).toBe(many[state.decidedAtPair! - 1]![0]!.completedAt);
  });

  it('is open with no decision time while nothing is decided', () => {
    const state = experimentState(sessions[0]!.slice(0, 2), level);
    expect(state.outcome).toBe('open');
    expect(state.decidedAt).toBeNull();
    expect(experimentState([], level)).toEqual({ ...evaluatePairs([]), decidedAt: null });
  });

  it('gives the same state for trials in reverse order', () => {
    expect(experimentState([...trials].reverse(), level)).toEqual(experimentState(trials, level));
    expect(experimentPairs([...trials].reverse(), level)).toEqual(experimentPairs(trials, level));
  });
});
