import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { Experiment } from '../../domain/types';
import { simulateExperimentTrials } from '../__sim__/simExperiment';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { experimentStates } from '../analyse';
import { observations } from '../features';
import { fitLevelModel } from '../stage1/levelModel';
import type { ExperimentOutcome } from './eprocess';
import { experimentState } from './experiment';

const USERS = 150;
const MODEL_SEED = 6000;
const EXPERIMENT_SEED = 300;
const params = defaultParams();

type Shares = Record<ExperimentOutcome, number>;

const cache = new Map<string, Shares>();

/**
 * Whole experiments on USERS simulated users. Each user's level model is fitted on 300 of
 * their own trials, weakness included, then the experiment is run for `rounds` rounds and
 * read back from its trials. Returns the share of users with each outcome.
 */
function run(term: string, effect: number, rounds: number): Shares {
  const cacheKey = `${term}|${effect}|${rounds}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const user = typicalUser(effect === 0 ? {} : { weakness: { atomIds: term.split('&'), effect } });
  const experiment: Experiment = { id: 'x', terms: [term], createdAt: 0 };
  const counts: Shares = { confirmed: 0, 'ruled-out': 0, open: 0 };
  for (let u = 0; u < USERS; u++) {
    const { trials } = simulateTrials(user, { params, sessions: 3, trialsPerSession: 100, seed: MODEL_SEED + u });
    const fit = fitLevelModel(observations(trials));
    if (fit.kind !== 'ok') throw new Error(`user ${u}: ${fit.reason}`);
    const played = simulateExperimentTrials(user, fit.model, experiment, { params, rounds, seed: EXPERIMENT_SEED + u });
    if (played.length === 0) throw new Error(`user ${u}: no pairs could be built`);
    counts[experimentState(played, fit.model).outcome] += 1;
  }
  const shares: Shares = { confirmed: counts.confirmed / USERS, 'ruled-out': counts['ruled-out'] / USERS, open: counts.open / USERS };
  console.log(`${term} effect ${effect} rounds ${rounds}: confirmed ${shares.confirmed.toFixed(3)} ruled out ${shares['ruled-out'].toFixed(3)} open ${shares.open.toFixed(3)}`);
  cache.set(cacheKey, shares);
  return shares;
}

describe('whole experiments, calibration: a user with no weakness', () => {
  // Without the margin and the closest control these measure 5% to 14%.
  for (const term of ['contains_8', 'answer_three_digits', 'carry_required', 'two_digit_multiplier']) {
    it(`${term} is confirmed at most 4% of the time over 5 rounds`, () => {
      expect(run(term, 0, 5).confirmed).toBeLessThanOrEqual(0.04);
    });
  }

  it('contains_8 is ruled out at least 85% of the time over 5 rounds', () => {
    expect(run('contains_8', 0, 5)['ruled-out']).toBeGreaterThanOrEqual(0.85);
  });
});

describe('whole experiments, recovery: a user with the weakness', () => {
  it('contains_8 +0.30 is confirmed at least 96% of the time in 1 round', () => {
    expect(run('contains_8', 0.3, 1).confirmed).toBeGreaterThanOrEqual(0.96);
  });

  it('carry_required +0.30 is confirmed at least 96% of the time over 5 rounds', () => {
    expect(run('carry_required', 0.3, 5).confirmed).toBeGreaterThanOrEqual(0.96);
  });

  it('contains_8 +0.15 is confirmed at least 93% of the time over 5 rounds', () => {
    expect(run('contains_8', 0.15, 5).confirmed).toBeGreaterThanOrEqual(0.93);
  });
});

describe('a verdict stays put when the user plays on (spec 14.4)', () => {
  const START = 1_727_600_000_000;
  const DAY = 86_400_000;
  const N = 150;
  const moved = new Map<string, { moved: number; confirmed: number }>();

  /**
   * N users with a +0.30 weakness on the term, 10 sessions of 100. The experiment is run
   * against the level model of that log and stops at the deciding pair, as a round does.
   * It is judged as the analysis judges it, then again after 300 more normal trials.
   * Returns how many users' states differ between the two, and the share confirmed.
   */
  function stability(term: string) {
    const hit = moved.get(term);
    if (hit !== undefined) return hit;
    const user = typicalUser({ weakness: { atomIds: term.split('&'), effect: 0.3 } });
    const experiment: Experiment = { id: 'x', terms: [term], createdAt: START + 15 * DAY };
    let differ = 0;
    let confirmed = 0;
    for (let u = 0; u < N; u++) {
      const { trials } = simulateTrials(user, { params, sessions: 10, trialsPerSession: 100, seed: 7000 + u });
      const fit = fitLevelModel(observations(trials));
      if (fit.kind !== 'ok') throw new Error(`user ${u}: ${fit.reason}`);
      const all = simulateExperimentTrials(user, fit.model, experiment, { params, rounds: 5, seed: 8000 + u, startMs: START + 20 * DAY });
      if (all.length === 0) throw new Error(`user ${u}: no pairs could be built`);
      // The simulator answers every pair, so pair k is trials 2k - 2 and 2k - 1.
      const decidedAtPair = experimentState(all, fit.model).decidedAtPair;
      const played = decidedAtPair === null ? all : all.slice(0, 2 * decidedAtPair);
      const more = simulateTrials(user, { params, sessions: 3, trialsPerSession: 100, seed: 9000 + u, startMs: START + 40 * DAY, idPrefix: 'more' }).trials;
      const then = experimentStates({ trials: [...trials, ...played], experiments: [experiment] }).get('x')!;
      const now = experimentStates({ trials: [...trials, ...more, ...played], experiments: [experiment] }).get('x')!;
      expect(then).toEqual(experimentState(played, fit.model));
      if (then.outcome === 'confirmed') confirmed++;
      if (now.outcome !== then.outcome || now.pairs !== then.pairs || now.decidedAtPair !== then.decidedAtPair || now.decidedAt !== then.decidedAt) differ++;
    }
    const result = { moved: differ, confirmed: confirmed / N };
    console.log(`${term} +0.30, ${N} users: confirmed ${result.confirmed.toFixed(3)}, verdicts that moved after 300 more trials ${differ}`);
    moved.set(term, result);
    return result;
  }

  for (const term of ['carry_required', 'two_digit_multiplier']) {
    it(`${term} +0.30: no verdict of ${N} users moves after 300 more normal trials`, () => {
      expect(stability(term).moved).toBe(0);
    });

    it(`${term} +0.30 is confirmed at least 96% of the time, judged as the analysis judges it`, () => {
      expect(stability(term).confirmed).toBeGreaterThanOrEqual(0.96);
    });
  }
});
