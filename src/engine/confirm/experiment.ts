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

/** A first-key time the evidence can be computed from. */
const usable = (ms: number | undefined): ms is number => ms !== undefined && Number.isFinite(ms) && ms >= 0;

/**
 * The pairs of one experiment, read from its trials, grouped by session. Sessions go by
 * the time of their first trial. Within a session, pair k is the trials with indexInSession
 * 2k and 2k + 1, so a missing trial costs its own pair and no other. A pair needs exactly
 * those two trials, one treatment and one control, each with a first keystroke at a finite
 * time of 0 or more, on an operation the level model has a fit for, and evidence that is
 * finite. Anything else is dropped.
 */
function readPairs(trials: readonly Trial[], level: LevelModel, registry: readonly Operation[]): ReadPair[] {
  const sessions = new Map<string, Trial[]>();
  for (const t of trials) {
    const ofSession = sessions.get(t.sessionId);
    if (ofSession === undefined) sessions.set(t.sessionId, [t]);
    else ofSession.push(t);
  }
  const ordered = [...sessions.entries()]
    .map(([id, ts]) => ({ id, start: Math.min(...ts.map((t) => t.displayedAt)), trials: ts }))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fitted = new Set(level.opIds);
  const out: ReadPair[] = [];
  for (const session of ordered) {
    // The trials at each pair's two places. A trial with no place in a pair is left out.
    const places = new Map<number, Trial[]>();
    for (const t of session.trials) {
      if (!Number.isInteger(t.indexInSession) || t.indexInSession < 0) continue;
      const k = Math.floor(t.indexInSession / 2);
      const atPlace = places.get(k);
      if (atPlace === undefined) places.set(k, [t]);
      else atPlace.push(t);
    }
    for (const k of [...places.keys()].sort((x, y) => x - y)) {
      const atPlace = places.get(k)!;
      if (atPlace.length !== 2) continue;
      const [a, b] = atPlace as [Trial, Trial];
      if (a.indexInSession === b.indexInSession) continue;
      const treatment = a.arm === 'treatment' ? a : b.arm === 'treatment' ? b : undefined;
      const control = a.arm === 'control' ? a : b.arm === 'control' ? b : undefined;
      if (treatment === undefined || control === undefined) continue;
      const treatmentMs = treatment.keystrokes[0]?.t;
      const controlMs = control.keystrokes[0]?.t;
      if (!usable(treatmentMs) || !usable(controlMs)) continue;
      if (!fitted.has(treatment.opId) || !fitted.has(control.opId)) continue;
      const pair = { treatment: problemOf(treatment), control: problemOf(control) };
      const evidence = pairEvidence(level, pair, treatmentMs, controlMs, registry);
      if (!Number.isFinite(evidence.d) || !Number.isFinite(evidence.se)) continue;
      out.push({ evidence, completedAt: Math.max(a.completedAt, b.completedAt) });
    }
  }
  return out;
}

/**
 * The evidence of one experiment, read from the trial log (spec 14.4). trials are the
 * trials that carry the experiment's id, in any order. They are grouped by session, and the
 * trials with indexInSession 2k and 2k + 1 form pair k. A pair needs exactly those two, one
 * treatment and one control, each with a usable first keystroke, on an operation the level
 * model has a fit for. A damaged pair is dropped, it never fails the read. Pairs from
 * earlier sessions come first.
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
