import { paramsSnapshotId } from '../../domain/params';
import { createRng } from '../../domain/rng';
import { TRIAL_SCHEMA_VERSION, type Arm, type Experiment, type GeneratorParams, type Problem, type Trial } from '../../domain/types';
import { buildPairs } from '../confirm/pairs';
import { EXPERIMENT_MIN_BUILDABLE_PAIRS } from '../constants';
import type { LevelModel } from '../stage1/levelModel';
import { respond, weaknessEffect, type SimUser } from './simUser';

export interface SimExperimentOptions {
  params: GeneratorParams;
  rounds: number;
  seed: number;
  /** Epoch ms of the first round. Rounds are a day apart. */
  startMs?: number;
}

const DAY_MS = 86_400_000;
const KEY_GAP_MS = 120;

/**
 * Simulates whole rounds of an experiment as stored trials. Deterministic for a seed.
 *
 * Each round builds its pairs from the level model with a seed of its own, puts each pair
 * in random order, and answers both problems. The weakness applies to a problem on its
 * own: no predecessor, no place in the round. There is no session shift, since it cancels
 * within a pair. Every round is played to its last pair, the reader stops at the deciding
 * one. A round with fewer than EXPERIMENT_MIN_BUILDABLE_PAIRS pairs cannot be run, so the
 * simulation ends there.
 */
export function simulateExperimentTrials(user: SimUser, level: LevelModel, experiment: Experiment, opts: SimExperimentOptions): Trial[] {
  const rng = createRng(opts.seed);
  const snapshotId = paramsSnapshotId(opts.params);
  const trials: Trial[] = [];
  for (let r = 0; r < opts.rounds; r++) {
    const pairs = buildPairs(level, opts.params, experiment.terms, opts.seed * 31 + r);
    if (pairs.length < EXPERIMENT_MIN_BUILDABLE_PAIRS) break;
    const sessionId = `${experiment.id}-r${String(r).padStart(4, '0')}`;
    let clock = (opts.startMs ?? 1_727_600_000_000) + r * DAY_MS;
    let prev: string | null = null;
    let index = 0;
    for (const pair of pairs) {
      const treatmentFirst = rng.next() < 0.5;
      const order: readonly [Arm, Problem][] = treatmentFirst
        ? [['treatment', pair.treatment], ['control', pair.control]]
        : [['control', pair.control], ['treatment', pair.treatment]];
      for (const [arm, problem] of order) {
        const extra = weaknessEffect(user, { problem, prev: null, indexInSession: 0, roundLength: 0 });
        const firstKeyMs = respond(user, problem, 0, rng, extra).firstKeyMs;
        const keystrokes = [...String(problem.answer)].map((k, j) => ({ k, t: firstKeyMs + j * KEY_GAP_MS }));
        const id = `${experiment.id}-t${String(trials.length).padStart(8, '0')}`;
        const completedAt = clock + keystrokes.at(-1)!.t;
        trials.push({
          id,
          schemaVersion: TRIAL_SCHEMA_VERSION,
          sessionId,
          mode: 'experiment',
          experimentId: experiment.id,
          arm,
          opId: problem.opId,
          operands: [...problem.operands],
          answer: problem.answer,
          displayedAt: clock,
          keystrokes,
          completedAt,
          indexInSession: index,
          prevTrialId: prev,
          paramsSnapshotId: snapshotId,
        });
        prev = id;
        clock = completedAt;
        index += 1;
      }
    }
  }
  return trials;
}
