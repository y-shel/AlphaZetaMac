import { createProblemSource, operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { GeneratorParams, Problem, Rng } from '../../domain/types';
import { termHolds } from '../confirm/pairs';
import { DERIVE_SAMPLES, MATCH_TOLERANCE_LOG_T, TRAIN_CALIBRATION_FRACTION, TRAIN_MAX_TRIES } from '../constants';
import { predictedLogTimes, quantile } from '../params/derive';
import { predict, type LevelModel } from '../stage1/levelModel';

/** What a Train round draws from (spec 22.3). */
export interface TrainPlan {
  level: LevelModel;
  /** The user's current settings. */
  params: GeneratorParams;
  /** Target percentile of the user's predicted log times, 50 to 95. */
  difficultyPct: number;
  /** Share of train draws aimed at a finding, 0 to 1. */
  focus: number;
  /**
   * The leading term and score points of each suspected or confirmed finding whose terms
   * can hold for a problem on its own. Weights are positive.
   */
  findings: readonly { lead: string; weight: number }[];
}

export interface TrainDraw {
  problem: Problem;
  /** The trial's tag (invariant 5). Only calibration draws feed the level model. */
  mode: 'calibration' | 'train';
  /** The term this problem was drawn for and holds for, or null for a broad draw. */
  focused: string | null;
}

/** True when the level model fits at least one enabled operation, so a Train round can be drawn. */
export function canTrain(level: LevelModel, params: GeneratorParams): boolean {
  return level.opIds.some((id) => params.enabled[id] === true);
}

/**
 * The problems of a Train round (spec 22.3), a deterministic function of the rng.
 *
 * The target is the difficultyPct percentile of the predicted log times of a fixed-seed
 * draw from the settings, over the operations the level model fits.
 *
 * Each draw is, with probability TRAIN_CALIBRATION_FRACTION, one problem from the settings
 * exactly as Normal draws it, tagged calibration (spec 10.4). Otherwise it is tagged train.
 * With probability focus, and any findings, one finding is picked in proportion to its
 * weight. Then up to TRAIN_MAX_TRIES problems are drawn from the settings. Those of an
 * unfitted operation, or where the picked term does not hold, are skipped. The first one
 * predicted within MATCH_TOLERANCE_LOG_T of the target is returned, or else the closest
 * seen. If none with the picked term turned up, the result is a broad draw instead.
 *
 * Throws when the level model fits none of the enabled operations.
 */
export function trainSource(
  plan: TrainPlan,
  rng: Rng,
  registry: readonly Operation[] = operations,
): { target: number; next(): TrainDraw } {
  const { level, params, focus, findings } = plan;
  if (!canTrain(level, params)) throw new Error('the model fits none of the enabled operations');
  const fitted = new Set(level.opIds);
  const scored = { ...params, enabled: Object.fromEntries(registry.map((op) => [op.id, params.enabled[op.id] === true && fitted.has(op.id)])) };
  const target = quantile(predictedLogTimes(level, scored, 1, DERIVE_SAMPLES, registry), plan.difficultyPct / 100);
  const draw = createProblemSource(params, rng, registry);
  const totalWeight = findings.reduce((sum, f) => sum + f.weight, 0);

  function pickLead(): string {
    let u = rng.next() * totalWeight;
    for (const f of findings) {
      u -= f.weight;
      if (u < 0) return f.lead;
    }
    return findings[findings.length - 1]!.lead;
  }

  /** The closest to the target of up to TRAIN_MAX_TRIES draws that pass, stopping at one within the tolerance. */
  function closest(lead: string | null): Problem | null {
    let best: Problem | null = null;
    let bestGap = Infinity;
    for (let tries = 0; tries < TRAIN_MAX_TRIES; tries++) {
      const problem = draw();
      if (!fitted.has(problem.opId)) continue;
      if (lead !== null && !termHolds(lead, problem)) continue;
      const gap = Math.abs(predict(level, problem, registry) - target);
      if (gap < bestGap) {
        best = problem;
        bestGap = gap;
      }
      if (gap <= MATCH_TOLERANCE_LOG_T) break;
    }
    return best;
  }

  function next(): TrainDraw {
    if (rng.next() < TRAIN_CALIBRATION_FRACTION) return { problem: draw(), mode: 'calibration', focused: null };
    const lead = findings.length > 0 && rng.next() < focus ? pickLead() : null;
    const problem = closest(lead);
    if (problem !== null) return { problem, mode: 'train', focused: lead };
    // Nothing with the picked term, or nothing fitted, in all the tries: one broad draw.
    return { problem: draw(), mode: 'train', focused: null };
  }

  return { target, next };
}
