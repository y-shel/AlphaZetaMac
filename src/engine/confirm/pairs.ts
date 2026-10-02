import { getAtom } from '../../domain/atoms/registry';
import type { AtomContext } from '../../domain/atoms/types';
import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { GeneratorParams, Problem } from '../../domain/types';
import { EPROCESS_MAX_PAIRS, EXPERIMENT_POOL, MATCH_TOLERANCE_LOG_T } from '../constants';
import { logTime } from '../features';
import { sampleProblems } from '../round/reference';
import { levelDesign } from '../stage1/design';
import { predict, type LevelModel } from '../stage1/levelModel';
import type { PairEvidence } from './eprocess';

/** The family of atoms that need a place in a round, which a generated problem has none of. */
const SEQUENCE_FAMILY = 'sequence';

const atomIdsOf = (termId: string): string[] => termId.split('&');

/**
 * Whether a term holds for a problem on its own: every atom of the term answers true for
 * the problem with no predecessor and no place in a round. A term id is its atom ids
 * joined by '&'.
 */
export function termHolds(termId: string, problem: Problem): boolean {
  const ctx: AtomContext = { problem, prev: null, indexInSession: 0, roundLength: 0 };
  return atomIdsOf(termId).every((id) => getAtom(id).applies(ctx) === true);
}

/**
 * Whether a set of terms can be tested with matched pairs (spec 14.1). False when any atom
 * of any term is a sequence atom: a generated problem cannot be given its place in the
 * round or its predecessor without breaking the pairing.
 */
export function isTestable(terms: readonly string[]): boolean {
  return terms.every((term) => atomIdsOf(term).every((id) => getAtom(id).family !== SEQUENCE_FAMILY));
}

/** A treatment problem and the control it is matched with (spec 14.1). */
export interface MatchedPair {
  treatment: Problem;
  control: Problem;
}

/** vᵀ Σ v for v = a − b, with Σ row-major and k columns wide. */
function differenceVariance(a: Float64Array, b: Float64Array, cov: readonly number[], k: number): number {
  let v = 0;
  for (let i = 0; i < k; i++) {
    const di = a[i]! - b[i]!;
    if (di === 0) continue;
    for (let j = 0; j < k; j++) v += di * (a[j]! - b[j]!) * cov[i * k + j]!;
  }
  return v;
}

/**
 * Standard error of the level model's predicted difference between two problems (spec
 * 14.2): sqrt(vᵀ Σ v), with v the difference of their design rows and Σ the model's
 * covariance, clamped at 0. Throws for an unfitted operation.
 */
export function pairSe(level: LevelModel, a: Problem, b: Problem, registry: readonly Operation[] = operations): number {
  const design = levelDesign(level.opIds, registry);
  return Math.sqrt(Math.max(differenceVariance(design.row(a), design.row(b), level.cov, design.k), 0));
}

interface Control {
  problem: Problem;
  predicted: number;
  row: Float64Array;
  used: boolean;
}

/**
 * The matched pairs for one round of an experiment on a set of terms (spec 14.1).
 * Deterministic for a seed.
 *
 * The pool is EXPERIMENT_POOL problems drawn from params, less those of an operation the
 * level model has no fit for. Treatments are the pool problems where terms[0] holds, in
 * pool order. Controls are the pool problems where no term holds. Each treatment takes,
 * among the unused controls of its operation predicted within MATCH_TOLERANCE_LOG_T of it,
 * the one with the smallest pairSe, the earliest on a tie. That is the control whose
 * predicted difference the level model is most certain about, which keeps the model's own
 * error out of the evidence. A treatment with no candidate is skipped. Stops at
 * EPROCESS_MAX_PAIRS pairs.
 */
export function buildPairs(
  level: LevelModel,
  params: GeneratorParams,
  terms: readonly string[],
  seed: number,
  registry: readonly Operation[] = operations,
): MatchedPair[] {
  const leading = terms[0];
  if (leading === undefined) return [];
  const design = levelDesign(level.opIds, registry);
  const pool = sampleProblems(params, seed, EXPERIMENT_POOL, registry).filter((p) => design.has(p.opId));
  const controls = new Map<string, Control[]>();
  for (const problem of pool) {
    if (terms.some((term) => termHolds(term, problem))) continue;
    const control: Control = { problem, predicted: predict(level, problem, registry), row: design.row(problem), used: false };
    const ofOp = controls.get(problem.opId);
    if (ofOp === undefined) controls.set(problem.opId, [control]);
    else ofOp.push(control);
  }
  const pairs: MatchedPair[] = [];
  for (const treatment of pool) {
    if (pairs.length >= EPROCESS_MAX_PAIRS) break;
    if (!termHolds(leading, treatment)) continue;
    const predicted = predict(level, treatment, registry);
    const row = design.row(treatment);
    let best: Control | null = null;
    let bestVariance = Infinity;
    for (const control of controls.get(treatment.opId) ?? []) {
      if (control.used || Math.abs(control.predicted - predicted) > MATCH_TOLERANCE_LOG_T) continue;
      const variance = differenceVariance(row, control.row, level.cov, design.k);
      if (best === null || variance < bestVariance) {
        best = control;
        bestVariance = variance;
      }
    }
    if (best === null) continue;
    best.used = true;
    pairs.push({ treatment, control: best.problem });
  }
  return pairs;
}

/**
 * What one answered pair says (spec 14.2): d is the difference of the two Stage 1
 * residuals on log first-key time, treatment minus control, and se is the standard error
 * of the level model's predicted difference for the pair. Throws for an unfitted operation.
 */
export function pairEvidence(
  level: LevelModel,
  pair: MatchedPair,
  treatmentMs: number,
  controlMs: number,
  registry: readonly Operation[] = operations,
): PairEvidence {
  const treatment = logTime(treatmentMs) - predict(level, pair.treatment, registry);
  const control = logTime(controlMs) - predict(level, pair.control, registry);
  return { d: treatment - control, se: pairSe(level, pair.treatment, pair.control, registry) };
}
