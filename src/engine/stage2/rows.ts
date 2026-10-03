import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Trial } from '../../domain/types';
import { STAGE2_MAX_LAPSE_RESP } from '../constants';
import type { LevelRows } from '../features';
import { crossFit, type CrossFitResult } from '../stage1/crossFit';
import { ewmaWeights } from '../stage1/levelModel';

/**
 * The rows of the Stage 2 regression (spec 8.5, 10.1). One entry per row in each field, in
 * the same order: trials[r], residual[r], weight[r] and logT[r] all describe row r. Rows
 * are in time order, oldest first.
 */
export interface Stage2Rows {
  trials: readonly Trial[];
  /** Out-of-fold Stage 1 residual, after the session offset. Always finite. */
  residual: Float64Array;
  /** EWMA weight of the trial's position in the full level-trial sequence. */
  weight: Float64Array;
  /** Observed log first-key time. */
  logT: Float64Array;
  /** The row positions 0 to n - 1, for callers that fit on every row. */
  all: readonly number[];
}

// Declared with levelTrials, which builds it. Re-exported for existing callers.
export type { LevelRows };

export type Stage2RowsResult = { kind: 'ok'; rows: Stage2Rows } | { kind: 'insufficient-data'; reason: string };

/**
 * The Stage 2 rows of the level trials: cross-fitted residuals, less the trials with no
 * residual and the likely lapses (spec 8.4, 8.5). level.obs must be in time order, oldest
 * first. A cross-fit failure is passed through.
 */
export function stage2Rows(level: LevelRows, registry: readonly Operation[] = operations): Stage2RowsResult {
  const cf = crossFit(level.obs, registry);
  if (cf.kind !== 'ok') return cf;
  return { kind: 'ok', rows: selectRows(level, cf, ewmaWeights(level.obs.length)) };
}

/**
 * Keeps the level trials with a finite residual and a lapse responsibility of at most
 * STAGE2_MAX_LAPSE_RESP, in order. cf and weights have one entry per level trial, so a
 * kept row carries the weight of its position in the full sequence.
 */
export function selectRows(level: LevelRows, cf: Extract<CrossFitResult, { kind: 'ok' }>, weights: Float64Array): Stage2Rows {
  const idx: number[] = [];
  for (let i = 0; i < level.obs.length; i++) {
    // NaN > 0.5 is false, so a missing residual must be dropped explicitly.
    if (Number.isFinite(cf.residual[i]) && cf.lapseResp[i]! <= STAGE2_MAX_LAPSE_RESP) idx.push(i);
  }
  return {
    trials: idx.map((i) => level.trials[i]!),
    residual: Float64Array.from(idx, (i) => cf.residual[i]!),
    weight: Float64Array.from(idx, (i) => weights[i]!),
    logT: Float64Array.from(idx, (i) => level.obs[i]!.y),
    all: idx.map((_, r) => r),
  };
}

/** What the fold model predicted for row r as a log time, including its session offset. */
export function predictedLogT(rows: Stage2Rows, r: number): number {
  return rows.logT[r]! - rows.residual[r]!;
}

/** Row positions split by session parity, sessions in order of first appearance (spec 10.5). */
export function sessionHalves(rows: Stage2Rows): [number[], number[]] {
  const order = new Map<string, number>();
  const halves: [number[], number[]] = [[], []];
  rows.trials.forEach((t, r) => {
    if (!order.has(t.sessionId)) order.set(t.sessionId, order.size);
    halves[order.get(t.sessionId)! % 2]!.push(r);
  });
  return halves;
}
