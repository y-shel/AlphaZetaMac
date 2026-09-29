import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { CROSS_FIT_FOLDS, STAGE1_MIN_TRIALS } from '../constants';
import type { Obs } from '../features';
import { ewmaWeights, fitLevelModel, lapseResponsibility, predict } from './levelModel';

export type CrossFitResult =
  | {
      kind: 'ok';
      /** Out-of-fold residual per input, after its session offset. NaN when its operation was not fitted in that fold. */
      residual: Float64Array;
      /** Out-of-fold lapse responsibility per input, NaN likewise. */
      lapseResp: Float64Array;
    }
  | { kind: 'insufficient-data'; reason: string };

/**
 * Out-of-fold Stage 1 residuals (spec 8.5). Trial i is in fold i mod CROSS_FIT_FOLDS, so
 * folds interleave in time. Each fold is predicted by a model fitted on the others, with
 * the EWMA weights of the full sequence. obs must be in time order, oldest first.
 */
export function crossFit(obs: readonly Obs[], registry: readonly Operation[] = operations): CrossFitResult {
  if (obs.length < STAGE1_MIN_TRIALS) {
    return { kind: 'insufficient-data', reason: `cross-fitting needs ${STAGE1_MIN_TRIALS} trials, there are ${obs.length}` };
  }
  const w = ewmaWeights(obs.length);
  const residual = new Float64Array(obs.length).fill(Number.NaN);
  const lapseResp = new Float64Array(obs.length).fill(Number.NaN);
  for (let f = 0; f < CROSS_FIT_FOLDS; f++) {
    const train: Obs[] = [];
    const trainW: number[] = [];
    obs.forEach((o, i) => {
      if (i % CROSS_FIT_FOLDS !== f) {
        train.push(o);
        trainW.push(w[i]!);
      }
    });
    const fit = fitLevelModel(train, trainW, registry);
    if (fit.kind !== 'ok') return fit;
    const { model } = fit;
    for (let i = f; i < obs.length; i += CROSS_FIT_FOLDS) {
      const o = obs[i]!;
      if (!model.opIds.includes(o.problem.opId)) continue;
      const e = o.y - predict(model, o.problem, registry) - (model.sessionOffsets[o.sessionId] ?? 0);
      residual[i] = e;
      lapseResp[i] = lapseResponsibility(o.y, e, model.sigma, model.lapseRate);
    }
  }
  return { kind: 'ok', residual, lapseResp };
}
