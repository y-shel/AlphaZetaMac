import { TRIAL_SCHEMA_VERSION, type Keystroke, type Trial, type TrialMode, type TrialTag } from '../../domain/types';
import type { CompletedRecord } from './round';

export interface TrialContext {
  sessionId: string;
  /** The default for records with no tag of their own. */
  mode: Exclude<TrialMode, 'experiment'>;
  paramsSnapshotId: string;
  /** Added to round clock times to get epoch ms: Date.now() - performance.now(), taken when the round starts. */
  timeOrigin: number;
  newId: (epochMs: number) => string;
}

function tagFields(tag: TrialTag) {
  return tag.mode === 'experiment'
    ? { mode: tag.mode, experimentId: tag.experimentId, arm: tag.arm }
    : { mode: tag.mode };
}

/** Builds Trial objects for records[from ..]. prevTrialId is the id of record from - 1. */
export function toTrials(
  records: readonly CompletedRecord[],
  keys: readonly Keystroke[],
  from: number,
  prevTrialId: string | null,
  ctx: TrialContext,
): Trial[] {
  const trials: Trial[] = [];
  let prev = prevTrialId;
  for (let i = from; i < records.length; i++) {
    const r = records[i]!;
    const displayedAt = ctx.timeOrigin + r.displayedAt;
    const trial: Trial = {
      id: ctx.newId(displayedAt),
      schemaVersion: TRIAL_SCHEMA_VERSION,
      sessionId: ctx.sessionId,
      ...tagFields(r.tag ?? { mode: ctx.mode }),
      opId: r.problem.opId,
      operands: [...r.problem.operands],
      answer: r.problem.answer,
      displayedAt,
      keystrokes: keys.slice(r.keyStart, r.keyEnd),
      completedAt: ctx.timeOrigin + r.completedAt,
      indexInSession: i,
      prevTrialId: prev,
      paramsSnapshotId: ctx.paramsSnapshotId,
    };
    trials.push(trial);
    prev = trial.id;
  }
  return trials;
}
