import { TRIAL_SCHEMA_VERSION, type Keystroke, type Trial, type TrialMode } from '../../domain/types';
import type { CompletedRecord } from './round';

export interface TrialContext {
  sessionId: string;
  /** Set by the mode controller at write time. Experiment trials arrive with Plan 4. */
  mode: Exclude<TrialMode, 'experiment'>;
  paramsSnapshotId: string;
  /** Added to round clock times to get epoch ms. performance.timeOrigin in the browser. */
  timeOrigin: number;
  newId: (epochMs: number) => string;
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
      mode: ctx.mode,
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
