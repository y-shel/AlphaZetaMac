import { getAtom } from '../../domain/atoms/registry';
import type { AtomContext } from '../../domain/atoms/types';
import { createProblemSource, defaultParams, operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { createRng } from '../../domain/rng';
import type { GeneratorParams, Problem, Session, Trial } from '../../domain/types';
import { DEFAULT_ROUND_SAMPLES, DEFAULT_ROUND_SECONDS, RECENT_NORMAL_SESSIONS } from '../constants';
import { atomContexts, roundContexts } from '../stage2/terms';

/**
 * `count` problems drawn from params with a fixed seed. This is the one sampler: score
 * points, standing, suggested settings and Test results all measure against its draws.
 * It draws exactly `count` times from one fresh source, so a seed and a count name the
 * same problems everywhere.
 */
export function sampleProblems(params: GeneratorParams, seed: number, count: number, registry: readonly Operation[] = operations): Problem[] {
  const next = createProblemSource(params, createRng(seed), registry);
  const out: Problem[] = [];
  for (let i = 0; i < count; i++) out.push(next());
  return out;
}

/**
 * The median of gaps between keystrokes, ms. 0 for none. For an even count it is the upper
 * middle element, not the average of the two middle ones. gaps is sorted in place.
 */
export function medianGapMs(gaps: number[]): number {
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

/** Median gap between keystrokes, ms: the typing time per extra digit. */
export function typingGapMs(trials: readonly Trial[]): number {
  const gaps: number[] = [];
  for (const t of trials) for (let k = 1; k < t.keystrokes.length; k++) gaps.push(t.keystrokes[k]!.t - t.keystrokes[k - 1]!.t);
  return medianGapMs(gaps);
}

/** The round a finding's prevalence and score points are measured against (spec 12.3). */
export interface ReferenceRound {
  roundSeconds: number;
  meanSecondsPerProblem: number;
  contexts: AtomContext[];
  /** True when the user has no normal rounds, so the round is a default-settings one. */
  estimated: boolean;
}

/**
 * What "a typical round" means for prevalence and pace (spec 12.3): the user's recent normal
 * rounds, or, with none, a default-settings round and the pace of whatever they have played.
 * The default-settings round is a fixed-seed draw. null when there is nothing to take a
 * pace from.
 */
export function referenceRound(
  sessions: readonly Session[],
  all: readonly Trial[],
  eligible: readonly Trial[],
  registry: readonly Operation[] = operations,
): ReferenceRound | null {
  const recent = sessions
    .filter((s) => s.mode === 'normal')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, RECENT_NORMAL_SESSIONS);
  const ids = new Set(recent.map((s) => s.id));
  const normal = all.filter((t) => t.mode === 'normal' && ids.has(t.sessionId));
  if (normal.length > 0) {
    return {
      roundSeconds: recent[0]!.durationS ?? DEFAULT_ROUND_SECONDS,
      meanSecondsPerProblem: meanSeconds(normal),
      contexts: atomContexts(normal, all),
      estimated: false,
    };
  }
  if (eligible.length === 0) return null;
  return {
    roundSeconds: DEFAULT_ROUND_SECONDS,
    meanSecondsPerProblem: meanSeconds(eligible),
    contexts: roundContexts(sampleProblems(defaultParams(registry), 1, DEFAULT_ROUND_SAMPLES, registry)),
    estimated: true,
  };
}

function meanSeconds(trials: readonly Trial[]): number {
  let s = 0;
  for (const t of trials) s += t.completedAt - t.displayedAt;
  return s / trials.length / 1000;
}

/** Share of a round's problems for which every one of the atoms is true. */
export function termPrevalence(atomIds: readonly string[], contexts: readonly AtomContext[]): number {
  if (contexts.length === 0) return 0;
  const atoms = atomIds.map((id) => getAtom(id));
  let hits = 0;
  for (const ctx of contexts) if (atoms.every((a) => a.applies(ctx) === true)) hits++;
  return hits / contexts.length;
}
