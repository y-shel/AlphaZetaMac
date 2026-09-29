import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Problem } from '../../domain/types';
import {
  HALF_LIFE_TRIALS,
  LAPSE_EM_ITERATIONS,
  LAPSE_MAX_MS,
  LAPSE_MAX_RATE,
  LAPSE_PRIOR_WEIGHT,
  MIN_SIGMA,
  RIDGE_LAMBDA,
  SESSION_SHRINKAGE_TAU,
  STAGE1_MIN_OP_TRIALS,
} from '../constants';
import { sizeOf, type Obs } from '../features';
import { priorOffset } from '../prior/populationPrior';
import { sandwichCov, weightedRidge } from './ridge';

/**
 * The Stage 1 level model (spec 8.2): y = alpha_o + beta_o · size + gamma · prior + noise.
 * Plain data, so it can be stored, compared and rebuilt.
 */
export interface LevelModel {
  /** Fitted operations, in registry order. */
  opIds: readonly string[];
  alpha: Readonly<Record<string, number>>;
  beta: Readonly<Record<string, number>>;
  gamma: number;
  /** Residual sd of log first-key time, after session offsets. */
  sigma: number;
  lapseRate: number;
  /**
   * Covariance of [alpha, beta for each of opIds in order, then gamma], row-major.
   * It describes noise within the sessions seen. It does not include day-to-day variation
   * of the level itself.
   */
  cov: readonly number[];
  /** Shrunk per-session offsets (spec 8.3), keyed by session id. */
  sessionOffsets: Readonly<Record<string, number>>;
  nObs: number;
}

export type LevelFit =
  | {
      kind: 'ok';
      model: LevelModel;
      /** Lapse responsibility per input, NaN for inputs whose operation was not fitted. */
      lapseResp: Float64Array;
    }
  | { kind: 'insufficient-data'; reason: string };

/** w_i = 0.5 ^ (rank_i / HALF_LIFE_TRIALS), where rank 0 is the last of n trials (spec 8.3). */
export function ewmaWeights(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.pow(0.5, (n - 1 - i) / HALF_LIFE_TRIALS);
  return w;
}

/** Predicted log first-key time, without any session offset. Throws for an unfitted operation. */
export function predict(model: LevelModel, problem: Problem, registry: readonly Operation[] = operations): number {
  const a = model.alpha[problem.opId];
  const b = model.beta[problem.opId];
  if (a === undefined || b === undefined) throw new Error(`the level model has no fit for "${problem.opId}"`);
  return a + b * sizeOf(problem, registry) + model.gamma * priorOffset(problem);
}

/** Standard error of alpha_o + beta_o · size, from the covariance. */
export function predictionSe(model: LevelModel, opId: string, size: number): number {
  const j = model.opIds.indexOf(opId);
  if (j < 0) throw new Error(`the level model has no fit for "${opId}"`);
  const k = 2 * model.opIds.length + 1;
  const ia = 2 * j;
  const ib = ia + 1;
  const v = model.cov[ia * k + ia]! + 2 * size * model.cov[ia * k + ib]! + size * size * model.cov[ib * k + ib]!;
  return Math.sqrt(Math.max(v, 0));
}

export function gammaSe(model: LevelModel): number {
  const k = 2 * model.opIds.length + 1;
  return Math.sqrt(Math.max(model.cov[(k - 1) * k + (k - 1)]!, 0));
}

/**
 * Probability that an observation is a lapse (spec 8.4): the fitted normal on the log
 * scale against a uniform on [0, LAPSE_MAX_MS] ms. On the log scale that uniform has
 * density e^y / LAPSE_MAX_MS. A time above LAPSE_MAX_MS is a lapse outright.
 */
export function lapseResponsibility(y: number, resid: number, sigma: number, lapseRate: number): number {
  const ms = Math.exp(y);
  if (ms > LAPSE_MAX_MS) return 1;
  const lapse = lapseRate * (ms / LAPSE_MAX_MS);
  const z = resid / sigma;
  const normal = ((1 - lapseRate) * Math.exp(-0.5 * z * z)) / (sigma * Math.sqrt(2 * Math.PI));
  return lapse / (lapse + normal);
}

/**
 * Fits the level model (spec 8.3, 8.4). obs must be in time order, oldest first.
 * weights defaults to ewmaWeights(obs.length); cross-fitting passes its own.
 * Operations with fewer than STAGE1_MIN_OP_TRIALS observations are left out.
 */
export function fitLevelModel(
  obs: readonly Obs[],
  weights: ArrayLike<number> = ewmaWeights(obs.length),
  registry: readonly Operation[] = operations,
): LevelFit {
  const counts = new Map<string, number>();
  for (const o of obs) counts.set(o.problem.opId, (counts.get(o.problem.opId) ?? 0) + 1);
  const opIds = registry.map((op) => op.id).filter((id) => (counts.get(id) ?? 0) >= STAGE1_MIN_OP_TRIALS);
  if (opIds.length === 0) return { kind: 'insufficient-data', reason: `no operation has ${STAGE1_MIN_OP_TRIALS} trials` };
  const col = new Map(opIds.map((id, j) => [id, 2 * j]));
  const k = 2 * opIds.length + 1;

  const idx: number[] = [];
  const rows: Float64Array[] = [];
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i]!;
    const c = col.get(o.problem.opId);
    if (c === undefined) continue;
    const row = new Float64Array(k);
    row[c] = 1;
    row[c + 1] = sizeOf(o.problem, registry);
    row[k - 1] = priorOffset(o.problem);
    idx.push(i);
    rows.push(row);
  }
  const n = rows.length;
  const y = Float64Array.from(idx, (i) => obs[i]!.y);
  const w = Float64Array.from(idx, (i) => weights[i]!);
  const sessionIds = [...new Set(idx.map((i) => obs[i]!.sessionId))];
  const sessionOf = new Map(sessionIds.map((s, j) => [s, j]));
  const sess = Int32Array.from(idx, (i) => sessionOf.get(obs[i]!.sessionId)!);

  const r = new Float64Array(n);
  const offsets = new Float64Array(sessionIds.length);
  const target = new Float64Array(n);
  const wt = new Float64Array(n);
  const resid = new Float64Array(n);
  let lapseRate = LAPSE_PRIOR_WEIGHT;
  let sigma = 1;

  // Ridge on y minus session offsets, weights w · (1 − r). Leaves resid and sigma set.
  const solve = () => {
    for (let i = 0; i < n; i++) {
      target[i] = y[i]! - offsets[sess[i]!]!;
      wt[i] = w[i]! * (1 - r[i]!);
    }
    const fit = weightedRidge(rows, target, wt, k, RIDGE_LAMBDA);
    if (fit === null) return null;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      const row = rows[i]!;
      for (let c = 0; c < k; c++) pred += row[c]! * fit.coef[c]!;
      resid[i] = target[i]! - pred;
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += wt[i]! * resid[i]! * resid[i]!;
      den += wt[i]!;
    }
    sigma = Math.max(Math.sqrt(num / den), MIN_SIGMA);
    return fit;
  };

  for (let iter = 0; iter < LAPSE_EM_ITERATIONS; iter++) {
    if (solve() === null) return { kind: 'insufficient-data', reason: 'the fit is numerically singular' };
    // Session offsets: n_s · mean / (n_s + tau), counting each trial by (1 − r).
    // raw is the residual before any offset.
    const raw = Float64Array.from(resid, (e, i) => e + offsets[sess[i]!]!);
    const sum = new Float64Array(sessionIds.length);
    const cnt = new Float64Array(sessionIds.length);
    for (let i = 0; i < n; i++) {
      const s = sess[i]!;
      sum[s] = sum[s]! + (1 - r[i]!) * raw[i]!;
      cnt[s] = cnt[s]! + (1 - r[i]!);
    }
    for (let s = 0; s < sessionIds.length; s++) offsets[s] = sum[s]! / (cnt[s]! + SESSION_SHRINKAGE_TAU);
    let total = 0;
    for (let i = 0; i < n; i++) {
      r[i] = lapseResponsibility(y[i]!, raw[i]! - offsets[sess[i]!]!, sigma, lapseRate);
      total += r[i]!;
    }
    lapseRate = Math.min(Math.max(total / n, 0), LAPSE_MAX_RATE);
  }
  const fit = solve();
  if (fit === null) return { kind: 'insufficient-data', reason: 'the fit is numerically singular' };

  const cov = sandwichCov(rows, wt, resid, fit.inv, k);
  const alpha: Record<string, number> = {};
  const beta: Record<string, number> = {};
  opIds.forEach((id, j) => {
    alpha[id] = fit.coef[2 * j]!;
    beta[id] = fit.coef[2 * j + 1]!;
  });
  const sessionOffsets: Record<string, number> = {};
  sessionIds.forEach((s, j) => (sessionOffsets[s] = offsets[j]!));
  const lapseResp = new Float64Array(obs.length).fill(Number.NaN);
  idx.forEach((i, j) => (lapseResp[i] = r[j]!));
  return {
    kind: 'ok',
    model: { opIds, alpha, beta, gamma: fit.coef[k - 1]!, sigma, lapseRate, cov: Array.from(cov), sessionOffsets, nObs: n },
    lapseResp,
  };
}
