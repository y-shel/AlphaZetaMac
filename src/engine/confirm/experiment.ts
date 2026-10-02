import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Problem, Trial } from '../../domain/types';
import type { LevelModel } from '../stage1/levelModel';
import { evaluatePairs, type ExperimentState, type PairEvidence } from './eprocess';
import { pairEvidence } from './pairs';

interface ReadPair {
  evidence: PairEvidence;
  /** The completedAt of the later of the pair's two trials. */
  completedAt: number;
}

const problemOf = (t: Trial): Problem => ({ opId: t.opId, operands: t.operands, answer: t.answer });

/**
 * The pairs of one experiment, read from its trials: grouped by session, in indexInSession
 * order, taken two at a time. Sessions go by the time of their first trial. A pair needs
 * one treatment and one control trial, each with a first keystroke, on an operation the
 * level model has a fit for. Anything else is dropped.
 */
function readPairs(trials: readonly Trial[], level: LevelModel, registry: readonly Operation[]): ReadPair[] {
  const sessions = new Map<string, Trial[]>();
  for (const t of trials) {
    const ofSession = sessions.get(t.sessionId);
    if (ofSession === undefined) sessions.set(t.sessionId, [t]);
    else ofSession.push(t);
  }
  const ordered = [...sessions.entries()]
    .map(([id, ts]) => ({ id, start: Math.min(...ts.map((t) => t.displayedAt)), trials: ts.sort((a, b) => a.indexInSession - b.indexInSession || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fitted = new Set(level.opIds);
  const out: ReadPair[] = [];
  for (const session of ordered) {
    for (let i = 0; i + 1 < session.trials.length; i += 2) {
      const a = session.trials[i]!;
      const b = session.trials[i + 1]!;
      const treatment = a.arm === 'treatment' ? a : b.arm === 'treatment' ? b : undefined;
      const control = a.arm === 'control' ? a : b.arm === 'control' ? b : undefined;
      if (treatment === undefined || control === undefined) continue;
      const treatmentKey = treatment.keystrokes[0];
      const controlKey = control.keystrokes[0];
      if (treatmentKey === undefined || controlKey === undefined) continue;
      if (!fitted.has(treatment.opId) || !fitted.has(control.opId)) continue;
      const pair = { treatment: problemOf(treatment), control: problemOf(control) };
      out.push({
        evidence: pairEvidence(level, pair, treatmentKey.t, controlKey.t, registry),
        completedAt: Math.max(a.completedAt, b.completedAt),
      });
    }
  }
  return out;
}

/**
 * The evidence of one experiment, read from the trial log (spec 14.4). trials are the
 * trials that carry the experiment's id, in any order. They are grouped by session, put in
 * indexInSession order and taken two at a time. A pair needs one treatment and one control
 * trial, each with a first keystroke, on an operation the level model has a fit for.
 * Anything else is dropped. Pairs from earlier sessions come first.
 */
export function experimentPairs(trials: readonly Trial[], level: LevelModel, registry: readonly Operation[] = operations): PairEvidence[] {
  return readPairs(trials, level, registry).map((p) => p.evidence);
}

/**
 * Where an experiment stands, recomputed from its trials (spec 14.4). decidedAt is the
 * completedAt of the later trial of the pair that decided it, or null while it is open.
 */
export function experimentState(
  trials: readonly Trial[],
  level: LevelModel,
  registry: readonly Operation[] = operations,
): ExperimentState & { decidedAt: number | null } {
  const pairs = readPairs(trials, level, registry);
  const state = evaluatePairs(pairs.map((p) => p.evidence));
  return { ...state, decidedAt: state.decidedAtPair === null ? null : pairs[state.decidedAtPair - 1]!.completedAt };
}
