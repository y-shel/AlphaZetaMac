import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { GeneratorParams, Problem } from '../../domain/types';
import { simulateTrials, trueModel, typicalUser } from '../__sim__/simUser';
import { EPROCESS_MAX_PAIRS, EXPERIMENT_POOL, MATCH_TOLERANCE_LOG_T } from '../constants';
import { logTime, observations, sizeOf } from '../features';
import { priorOffset } from '../prior/populationPrior';
import { sampleProblems } from '../round/reference';
import { fitLevelModel, predict, type LevelModel } from '../stage1/levelModel';
import { buildPairs, isTestable, pairEvidence, pairSe, termHolds } from './pairs';

const params = defaultParams();

function fitted(p: GeneratorParams = params, seed = 11): LevelModel {
  const { trials } = simulateTrials(typicalUser(), { params: p, sessions: 3, trialsPerSession: 100, seed });
  const fit = fitLevelModel(observations(trials));
  if (fit.kind !== 'ok') throw new Error(fit.reason);
  return fit.model;
}

const level = fitted();
const key = (p: Problem): string => `${p.opId}:${p.operands.join(',')}`;
const mul = (a: number, b: number): Problem => ({ opId: 'mul', operands: [a, b], answer: a * b });
const add = (a: number, b: number): Problem => ({ opId: 'add', operands: [a, b], answer: a + b });

describe('termHolds', () => {
  it('needs every atom of a scoped term', () => {
    expect(termHolds('contains_7&op_mul', mul(7, 45))).toBe(true);
    expect(termHolds('contains_7&op_mul', add(7, 45))).toBe(false);
    expect(termHolds('contains_7&op_mul', mul(6, 45))).toBe(false);
    expect(termHolds('contains_7', add(7, 45))).toBe(true);
  });
});

describe('isTestable', () => {
  it('is false for a set with a sequence atom in any term', () => {
    expect(isTestable(['contains_8', 'carry_required&op_add'])).toBe(true);
    expect(isTestable(['contains_8', 'late_in_round'])).toBe(false);
    expect(isTestable(['contains_8&prev_op_differs'])).toBe(false);
  });
});

describe('pairSe', () => {
  it('is 0 for a problem paired with itself', () => {
    expect(pairSe(level, add(34, 58), add(34, 58))).toBe(0);
  });

  it('matches a hand computation on a small covariance', () => {
    // One operation: columns are intercept, size slope, prior. The two rows share the
    // intercept, so its large variance must not show.
    const small: LevelModel = {
      ...trueModel(typicalUser()),
      opIds: ['add'],
      cov: [9, 1, 1, 1, 0.04, 0.01, 1, 0.01, 0.09],
    };
    const a = add(34, 58);
    const b = add(12, 7);
    const ds = sizeOf(a) - sizeOf(b);
    const dp = priorOffset(a) - priorOffset(b);
    expect(ds).not.toBe(0);
    const expected = Math.sqrt(ds * ds * 0.04 + 2 * ds * dp * 0.01 + dp * dp * 0.09);
    expect(pairSe(small, a, b)).toBeCloseTo(expected, 12);
    expect(pairSe(small, b, a)).toBeCloseTo(expected, 12);
  });

  it('is clamped at 0 when the covariance gives a negative variance', () => {
    const bad: LevelModel = { ...trueModel(typicalUser()), opIds: ['add'], cov: [0, 0, 0, 0, -1, 0, 0, 0, 0] };
    expect(pairSe(bad, add(34, 58), add(12, 7))).toBe(0);
  });
});

describe('buildPairs', () => {
  const terms = ['contains_8', 'answer_three_digits'];
  const pairs = buildPairs(level, params, terms, 5);

  it('is deterministic for a seed, and the seed matters', () => {
    expect(buildPairs(level, params, terms, 5)).toEqual(pairs);
    expect(buildPairs(level, params, terms, 6)).not.toEqual(pairs);
  });

  it('builds a full set from default settings and stops at the cap', () => {
    expect(pairs).toHaveLength(EPROCESS_MAX_PAIRS);
  });

  it('has the leading term in every treatment and no term in any control', () => {
    for (const { treatment, control } of pairs) {
      expect(termHolds(terms[0]!, treatment)).toBe(true);
      for (const term of terms) expect(termHolds(term, control)).toBe(false);
    }
  });

  it('pairs within one operation and within the tolerance', () => {
    for (const { treatment, control } of pairs) {
      expect(control.opId).toBe(treatment.opId);
      expect(Math.abs(predict(level, control) - predict(level, treatment))).toBeLessThanOrEqual(MATCH_TOLERANCE_LOG_T);
    }
  });

  it('takes treatments in pool order', () => {
    // The pairs' treatments are a subsequence of the pool's treatments.
    const pool = sampleProblems(params, 5, EXPERIMENT_POOL);
    let from = 0;
    for (const { treatment } of pairs) {
      const at = pool.findIndex((p, i) => i >= from && key(p) === key(treatment));
      expect(at).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
  });

  it('uses no control twice', () => {
    // Problems of one build are objects of one pool, so identity tells them apart.
    expect(new Set(pairs.map((p) => p.control)).size).toBe(pairs.length);
    expect(pairs.some((p) => p.control === p.treatment)).toBe(false);
  });

  it('never uses an operation the level model did not fit', () => {
    const two: GeneratorParams = { ...params, enabled: { ...params.enabled, mul: false, div: false } };
    const partial = fitted(two);
    expect(partial.opIds).toEqual(['add', 'sub']);
    const built = buildPairs(partial, params, ['contains_8'], 5);
    expect(built.length).toBeGreaterThan(0);
    for (const { treatment, control } of built) {
      expect(partial.opIds).toContain(treatment.opId);
      expect(partial.opIds).toContain(control.opId);
    }
  });

  it('chooses, among the candidates in tolerance, the one with the smallest pairSe', () => {
    // Replays the rule on a pool of its own, tracking used controls by pool index.
    const pool = sampleProblems(params, 5, EXPERIMENT_POOL);
    const used = new Set<number>();
    let withChoice = 0;
    let notTheFirst = 0;
    let notTheClosest = 0;
    for (const { treatment, control } of pairs) {
      const y = predict(level, treatment);
      const candidates = pool
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p, i }) =>
            !used.has(i) &&
            p.opId === treatment.opId &&
            !terms.some((t) => termHolds(t, p)) &&
            Math.abs(predict(level, p) - y) <= MATCH_TOLERANCE_LOG_T,
        );
      expect(candidates.length).toBeGreaterThan(0);
      const chosen = pairSe(level, treatment, control);
      let best = candidates[0]!;
      let closest = candidates[0]!;
      for (const c of candidates) {
        expect(chosen).toBeLessThanOrEqual(pairSe(level, treatment, c.p));
        if (pairSe(level, treatment, c.p) < pairSe(level, treatment, best.p)) best = c;
        if (Math.abs(predict(level, c.p) - y) < Math.abs(predict(level, closest.p) - y)) closest = c;
      }
      // Ties go to the earliest in the pool.
      expect(key(control)).toBe(key(best.p));
      if (candidates.length > 1) withChoice += 1;
      if (key(control) !== key(candidates[0]!.p)) notTheFirst += 1;
      if (key(control) !== key(closest.p)) notTheClosest += 1;
      used.add(best.i);
    }
    // The rule is not "the first candidate" and not "the closest prediction".
    expect(withChoice).toBeGreaterThan(pairs.length / 2);
    expect(notTheFirst).toBeGreaterThan(0);
    expect(notTheClosest).toBeGreaterThan(0);
  });

  it('skips a treatment with no candidate and returns nothing for an empty set', () => {
    // Every problem holds one of these, so there is no control at all.
    const everything = level.opIds.map((id) => `op_${id}`);
    expect(buildPairs(level, params, everything, 5)).toEqual([]);
    expect(buildPairs(level, params, [], 5)).toEqual([]);
  });
});

describe('pairEvidence', () => {
  it('is the difference of the two residuals, with the pair standard error', () => {
    const pair = { treatment: add(38, 58), control: add(34, 57) };
    const e = pairEvidence(level, pair, 2400, 1500);
    const expected = logTime(2400) - predict(level, pair.treatment) - (logTime(1500) - predict(level, pair.control));
    expect(e.d).toBeCloseTo(expected, 12);
    expect(e.se).toBe(pairSe(level, pair.treatment, pair.control));
    expect(e.se).toBeGreaterThan(0);
  });

  it('stays finite for a first key at 0 ms', () => {
    const pair = { treatment: add(38, 58), control: add(34, 57) };
    expect(Number.isFinite(pairEvidence(level, pair, 0, 1500).d)).toBe(true);
  });
});
