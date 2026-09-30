import { createProblemSource } from '../../domain/operations/registry';
import { paramsSnapshotId } from '../../domain/params';
import { createRng } from '../../domain/rng';
import { TRIAL_SCHEMA_VERSION, type GeneratorParams, type Problem, type Rng, type Trial, type TrialMode } from '../../domain/types';
import { LAPSE_MAX_MS } from '../constants';
import { sizeOf } from '../features';
import { priorOffset } from '../prior/populationPrior';
import type { LevelModel } from '../stage1/levelModel';

/** A fake user with a known level model. The ground truth for recovery tests. */
export interface SimUser {
  /** Per operation id. Every operation the simulation draws must have an entry. */
  alpha: Readonly<Record<string, number>>;
  beta: Readonly<Record<string, number>>;
  gamma: number;
  /** Sd of log first-key time within a session. */
  sigma: number;
  /** Share of trials that are lapses, with first-key time uniform on [0, LAPSE_MAX_MS]. */
  lapseRate: number;
  /** Sd of the per-session shift in log time. */
  sessionSd: number;
}

/** A plausible adult. Times are about 1.5 s for 30 + 45 and 3 s for 7 × 45. */
export function typicalUser(over: Partial<SimUser> = {}): SimUser {
  return {
    alpha: { add: 5.8, sub: 6.0, mul: 5.7, div: 5.9 },
    beta: { add: 0.35, sub: 0.35, mul: 0.4, div: 0.4 },
    gamma: 1,
    sigma: 0.25,
    lapseRate: 0.02,
    sessionSd: 0.1,
    ...over,
  };
}

/** Standard normal by Box-Muller. */
export function normal(rng: Rng): number {
  const u1 = 1 - rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Mean log first-key time for this user, without session shift or noise. */
export function trueMean(user: SimUser, problem: Problem): number {
  const a = user.alpha[problem.opId];
  const b = user.beta[problem.opId];
  if (a === undefined || b === undefined) throw new Error(`sim user has no truth for "${problem.opId}"`);
  return a + b * sizeOf(problem) + user.gamma * priorOffset(problem);
}

export interface Response {
  firstKeyMs: number;
  lapse: boolean;
}

/** One simulated response. */
export function respond(user: SimUser, problem: Problem, sessionShift: number, rng: Rng): Response {
  if (rng.next() < user.lapseRate) return { firstKeyMs: rng.next() * LAPSE_MAX_MS, lapse: true };
  return { firstKeyMs: Math.exp(trueMean(user, problem) + sessionShift + user.sigma * normal(rng)), lapse: false };
}

export interface SimOptions {
  params: GeneratorParams;
  sessions: number;
  trialsPerSession: number;
  seed: number;
  mode?: Exclude<TrialMode, 'experiment'>;
  /** Epoch ms of the first session. Sessions are a day apart. */
  startMs?: number;
}

export interface SimResult {
  /** Oldest first. */
  trials: Trial[];
  /** True shift per session id. */
  sessionShifts: Record<string, number>;
  /** Parallel to trials. */
  lapse: boolean[];
}

const DAY_MS = 86_400_000;
const KEY_GAP_MS = 120;

/** Simulates whole sessions of play as stored trials. Deterministic for a seed. */
export function simulateTrials(user: SimUser, opts: SimOptions): SimResult {
  const rng = createRng(opts.seed);
  const next = createProblemSource(opts.params, rng);
  const mode = opts.mode ?? 'normal';
  const snapshotId = paramsSnapshotId(opts.params);
  const trials: Trial[] = [];
  const lapse: boolean[] = [];
  const sessionShifts: Record<string, number> = {};
  for (let s = 0; s < opts.sessions; s++) {
    const sessionId = `sim-s${String(s).padStart(4, '0')}`;
    const shift = user.sessionSd * normal(rng);
    sessionShifts[sessionId] = shift;
    let clock = (opts.startMs ?? 1_727_600_000_000) + s * DAY_MS;
    let prev: string | null = null;
    for (let i = 0; i < opts.trialsPerSession; i++) {
      const problem = next();
      const r = respond(user, problem, shift, rng);
      const digits = String(problem.answer);
      const keystrokes = [...digits].map((k, j) => ({ k, t: r.firstKeyMs + j * KEY_GAP_MS }));
      const id = `sim-t${String(trials.length).padStart(8, '0')}`;
      const completedAt = clock + keystrokes.at(-1)!.t;
      trials.push({
        id,
        schemaVersion: TRIAL_SCHEMA_VERSION,
        sessionId,
        mode,
        opId: problem.opId,
        operands: [...problem.operands],
        answer: problem.answer,
        displayedAt: clock,
        keystrokes,
        completedAt,
        indexInSession: i,
        prevTrialId: prev,
        paramsSnapshotId: snapshotId,
      });
      lapse.push(r.lapse);
      prev = id;
      clock = completedAt;
    }
  }
  return { trials, sessionShifts, lapse };
}

/** The user's true level model, with zero covariance. For tests that need an exact model. */
export function trueModel(user: SimUser): LevelModel {
  const opIds = Object.keys(user.alpha);
  return {
    opIds,
    alpha: user.alpha,
    beta: user.beta,
    gamma: user.gamma,
    sigma: user.sigma,
    lapseRate: user.lapseRate,
    cov: new Array<number>((2 * opIds.length + 1) ** 2).fill(0),
    sessionOffsets: {},
    nObs: 0,
  };
}
