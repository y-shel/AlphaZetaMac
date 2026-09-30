import { getOperation, operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { Problem, Trial, TrialMode } from '../domain/types';
import { MIN_FIRST_KEY_MS } from './constants';

/** Modes that feed the level model (invariant 5, spec 8.3). */
export const LEVEL_MODES: readonly TrialMode[] = ['normal', 'test', 'calibration'];

/** One trial as the level model sees it. */
export interface Obs {
  problem: Problem;
  /** log of the first-key time in ms (spec 8.1). */
  y: number;
  sessionId: string;
}

/**
 * The operation's size metric, clamped at 0. A floor of 0 allows a sum or product of 0,
 * and log(0) is -Infinity.
 */
export function sizeOf(problem: Problem, registry: readonly Operation[] = operations): number {
  const s = getOperation(problem.opId, registry).sizeMetric(problem);
  return s > 0 ? s : 0;
}

export function logTime(firstKeyMs: number): number {
  return Math.log(Math.max(firstKeyMs, MIN_FIRST_KEY_MS));
}

/**
 * Level-model observations from the trial log, in the order given. Skips ineligible modes
 * and trials with no keystroke.
 */
export function observations(trials: readonly Trial[]): Obs[] {
  const out: Obs[] = [];
  for (const t of trials) {
    const first = t.keystrokes[0];
    if (!LEVEL_MODES.includes(t.mode) || first === undefined) continue;
    out.push({ problem: { opId: t.opId, operands: t.operands, answer: t.answer }, y: logTime(first.t), sessionId: t.sessionId });
  }
  return out;
}
