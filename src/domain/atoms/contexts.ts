import { TRIAL_SCHEMA_VERSION, type Problem, type Trial } from '../types';
import type { AtomContext } from './types';

/** The context an atom needs for each trial: the previous trial and the round length. */
export function atomContexts(trials: readonly Trial[], all: readonly Trial[]): AtomContext[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const roundLength = new Map<string, number>();
  for (const t of all) roundLength.set(t.sessionId, (roundLength.get(t.sessionId) ?? 0) + 1);
  return trials.map((t) => ({
    problem: { opId: t.opId, operands: t.operands, answer: t.answer },
    prev: t.prevTrialId === null ? null : (byId.get(t.prevTrialId) ?? null),
    indexInSession: t.indexInSession,
    roundLength: roundLength.get(t.sessionId) ?? 0,
  }));
}

/**
 * Contexts for problems shown one after another in a single round, when there are no stored
 * trials: a default-settings round, or a Test that has only its problems.
 */
export function roundContexts(problems: readonly Problem[]): AtomContext[] {
  return problems.map((problem, i) => ({
    problem,
    prev: i === 0 ? null : stubTrial(problems[i - 1]!, i - 1),
    indexInSession: i,
    roundLength: problems.length,
  }));
}

/** Just enough of a Trial for the sequence atoms, which read prev.opId. */
function stubTrial(problem: Problem, i: number): Trial {
  return {
    id: `round-${i}`,
    schemaVersion: TRIAL_SCHEMA_VERSION,
    sessionId: 'round',
    mode: 'normal',
    opId: problem.opId,
    operands: [...problem.operands],
    answer: problem.answer,
    displayedAt: 0,
    keystrokes: [],
    completedAt: 0,
    indexInSession: i,
    prevTrialId: i === 0 ? null : `round-${i - 1}`,
    paramsSnapshotId: 'round',
  };
}
