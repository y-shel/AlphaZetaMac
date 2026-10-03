import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { Experiment, Problem, Trial } from '../../domain/types';
import { experimentPairs } from '../confirm/experiment';
import { termHolds } from '../confirm/pairs';
import { EPROCESS_MAX_PAIRS } from '../constants';
import { observations } from '../features';
import { fitLevelModel } from '../stage1/levelModel';
import { simulateExperimentTrials } from './simExperiment';
import { simulateTrials, typicalUser } from './simUser';

const params = defaultParams();
const level = (() => {
  const { trials } = simulateTrials(typicalUser(), { params, sessions: 3, trialsPerSession: 100, seed: 11 });
  const fit = fitLevelModel(observations(trials));
  if (fit.kind !== 'ok') throw new Error(fit.reason);
  return fit.model;
})();
const experiment: Experiment = { id: 'x-abc', terms: ['contains_8', 'answer_three_digits'], createdAt: 5 };
const opts = { params, rounds: 2, seed: 9 };
const trials = simulateExperimentTrials(typicalUser(), level, experiment, opts);
const problemOf = (t: Trial): Problem => ({ opId: t.opId, operands: t.operands, answer: t.answer });

describe('simulateExperimentTrials', () => {
  it('is deterministic for a seed, and the seed matters', () => {
    expect(simulateExperimentTrials(typicalUser(), level, experiment, opts)).toEqual(trials);
    expect(simulateExperimentTrials(typicalUser(), level, experiment, { ...opts, seed: 10 })).not.toEqual(trials);
  });

  it('tags every trial experiment, with the experiment id and an arm', () => {
    expect(trials).toHaveLength(2 * 2 * EPROCESS_MAX_PAIRS);
    for (const t of trials) {
      expect(t.mode).toBe('experiment');
      expect(t.experimentId).toBe('x-abc');
      expect(['treatment', 'control']).toContain(t.arm);
      expect(t.keystrokes.map((k) => k.k).join('')).toBe(String(t.answer));
      expect(termHolds('contains_8', problemOf(t))).toBe(t.arm === 'treatment');
    }
  });

  it('is one session per round, ids sorting by time, sessions chained', () => {
    expect(new Set(trials.map((t) => t.sessionId)).size).toBe(2);
    expect([...trials].map((t) => t.id).sort()).toEqual(trials.map((t) => t.id));
    for (let i = 1; i < trials.length; i++) expect(trials[i]!.displayedAt).toBeGreaterThanOrEqual(trials[i - 1]!.completedAt);
    const second = trials.filter((t) => t.sessionId === trials.at(-1)!.sessionId);
    expect(second.map((t) => t.indexInSession)).toEqual(second.map((_, i) => i));
    expect(second[0]!.prevTrialId).toBeNull();
    expect(second[1]!.prevTrialId).toBe(second[0]!.id);
  });

  it('alternates arms by pair, in random order within a pair', () => {
    let treatmentFirst = 0;
    for (let i = 0; i < trials.length; i += 2) {
      expect(new Set([trials[i]!.arm, trials[i + 1]!.arm]).size).toBe(2);
      if (trials[i]!.arm === 'treatment') treatmentFirst += 1;
    }
    const pairs = trials.length / 2;
    expect(treatmentFirst).toBeGreaterThan(pairs * 0.3);
    expect(treatmentFirst).toBeLessThan(pairs * 0.7);
  });

  it('reads back as one pair of evidence per pair played', () => {
    expect(experimentPairs(trials, level)).toHaveLength(trials.length / 2);
  });

  it('builds different pairs in each round', () => {
    const [a, b] = [...new Set(trials.map((t) => t.sessionId))].map((id) => trials.filter((t) => t.sessionId === id).map((t) => t.operands.join()));
    expect(a).not.toEqual(b);
  });

  it('adds the weakness to the problems it applies to', () => {
    const mean = (user: ReturnType<typeof typicalUser>): number => {
      const pairs = experimentPairs(simulateExperimentTrials(user, level, experiment, { ...opts, rounds: 5 }), level);
      return pairs.reduce((s, p) => s + p.d, 0) / pairs.length;
    };
    const quiet = { lapseRate: 0 };
    const gap = mean(typicalUser({ ...quiet, weakness: { atomIds: ['contains_8'], effect: 0.3 } })) - mean(typicalUser(quiet));
    expect(gap).toBeGreaterThan(0.2);
    expect(gap).toBeLessThan(0.4);
  });
});
