import { createProblemSource } from '../../domain/operations/registry';
import type { GeneratorParams, Rng } from '../../domain/types';
import { respond, type SimUser } from './simUser';

export interface RoundOptions {
  params: GeneratorParams;
  /** Typing time per digit after the first, ms. */
  gapMs: number;
  /** Round length, ms. A Zetamac round is 120 s. */
  durationMs?: number;
  /** This round's shift in log time. */
  sessionShift?: number;
}

/**
 * One timed round as the drill scores it: problems are drawn from the settings, each takes
 * the simulated first key plus a fixed typing gap per extra digit, and the score is the
 * number of problems finished before the time runs out. An injected weakness is not
 * applied. Deterministic for an rng state.
 */
export function simulateRoundScore(user: SimUser, opts: RoundOptions, rng: Rng): number {
  const next = createProblemSource(opts.params, rng);
  const durationMs = opts.durationMs ?? 120_000;
  let clock = 0;
  let score = 0;
  for (;;) {
    const problem = next();
    const first = respond(user, problem, opts.sessionShift ?? 0, rng).firstKeyMs;
    clock += first + opts.gapMs * (String(problem.answer).length - 1);
    if (clock > durationMs) return score;
    score++;
  }
}
