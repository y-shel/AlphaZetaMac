import { describe, expect, it } from 'vitest';
import { createProblemSource, defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { respond, typicalUser } from '../__sim__/simUser';
import { EPROCESS_ALPHA, EXPERIMENT_RULE_OUT_LOG_T } from '../constants';
import { BettingEProcess, evaluatePairs, toUnit, type ExperimentState, type PairEvidence } from './eprocess';

const EXPERIMENTS = 1000;
const FIRST_SEED = 1000;

/**
 * One simulated experiment: the same problem answered twice by a typical user, the first
 * time with an extra log-time effect. The level model is taken as exact, so se is 0.
 */
function simulatePairs(effect: number, maxPairs: number, seed: number): PairEvidence[] {
  const rng = createRng(seed);
  const user = typicalUser();
  const next = createProblemSource(defaultParams(), rng);
  const pairs: PairEvidence[] = [];
  for (let i = 0; i < maxPairs; i++) {
    const problem = next();
    const treatment = respond(user, problem, 0, rng, effect).firstKeyMs;
    const control = respond(user, problem, 0, rng, 0).firstKeyMs;
    pairs.push({ d: Math.log(Math.max(treatment, 1)) - Math.log(Math.max(control, 1)), se: 0 });
  }
  return pairs;
}

function experiment(effect: number, maxPairs: number, seed: number): ExperimentState {
  return evaluatePairs(simulatePairs(effect, maxPairs, seed));
}

/**
 * The share of experiments in which one process alone, never stopped by the other, has an
 * e-value that reaches 1 / EPROCESS_ALPHA at any pair.
 */
function everRejects(make: () => BettingEProcess, effect: number, maxPairs: number): number {
  const threshold = 1 / EPROCESS_ALPHA;
  let rejected = 0;
  for (let s = 0; s < EXPERIMENTS; s++) {
    const process = make();
    for (const { d } of simulatePairs(effect, maxPairs, FIRST_SEED + s)) {
      process.add(toUnit(d));
      if (process.eValue >= threshold) {
        rejected += 1;
        break;
      }
    }
  }
  return rejected / EXPERIMENTS;
}

interface Tally {
  confirmed: number;
  ruledOut: number;
  /** Median deciding pair among the confirmed. */
  medianConfirmPair: number;
}

function tally(effect: number, maxPairs: number): Tally {
  const decidedAt: number[] = [];
  let ruledOut = 0;
  for (let s = 0; s < EXPERIMENTS; s++) {
    const state = experiment(effect, maxPairs, FIRST_SEED + s);
    if (state.outcome === 'confirmed') decidedAt.push(state.decidedAtPair!);
    else if (state.outcome === 'ruled-out') ruledOut += 1;
  }
  decidedAt.sort((a, b) => a - b);
  return {
    confirmed: decidedAt.length / EXPERIMENTS,
    ruledOut: ruledOut / EXPERIMENTS,
    medianConfirmPair: decidedAt[Math.floor(decidedAt.length / 2)] ?? NaN,
  };
}

describe('the two e-processes, calibration', () => {
  it('confirms at most 3% of experiments with no effect, looking after each of 300 pairs', () => {
    expect(tally(0, 300).confirmed).toBeLessThanOrEqual(0.03);
  });

  it('rules out at most 5% of experiments with an effect of 0.10 within 300 pairs', () => {
    expect(tally(0.1, 300).ruledOut).toBeLessThanOrEqual(0.05);
  });

  // In the two cases above the other process ends most runs first. These two run each
  // process alone, so the error rate is the named process's own.
  it('the confirming process alone wrongly rejects at most 3% with no effect, over 300 pairs', () => {
    expect(everRejects(() => new BettingEProcess(toUnit(0), 1), 0, 300)).toBeLessThanOrEqual(0.03);
  });

  it('the ruling-out process alone wrongly rejects at most 3.5% at an effect of 0.10, over 300 pairs', () => {
    expect(everRejects(() => new BettingEProcess(toUnit(EXPERIMENT_RULE_OUT_LOG_T), -1), 0.1, 300)).toBeLessThanOrEqual(0.035);
  });
});

describe('the two e-processes, recovery', () => {
  it('confirms an effect of 0.30 within one round of 60 pairs', () => {
    const t = tally(0.3, 60);
    expect(t.confirmed).toBeGreaterThanOrEqual(0.97);
    expect(t.medianConfirmPair).toBeLessThanOrEqual(28);
  });

  it('confirms an effect of 0.15 in about half of the 60-pair rounds', () => {
    const t = tally(0.15, 60);
    expect(t.confirmed).toBeGreaterThanOrEqual(0.45);
    expect(t.confirmed).toBeLessThanOrEqual(0.7);
  });

  it('rules out no effect within 300 pairs', () => {
    expect(tally(0, 300).ruledOut).toBeGreaterThanOrEqual(0.88);
  });
});
