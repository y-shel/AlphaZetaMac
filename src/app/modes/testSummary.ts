import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { GeneratorParams } from '../../domain/types';
import type { Obs } from '../../engine/features';
import type { TestProgress } from '../../engine/select/stopping';
import { deriveParams, predictedLogTimes, quantile } from '../../engine/params/derive';
import { predictStanding, type Standing } from '../../engine/anchor/standing';
import { MIN_EFFECT_LOG_T, STAGE2_MAX_LAPSE_RESP } from '../../engine/constants';
import { fitLevelModel, predict } from '../../engine/stage1/levelModel';
import { fallbackRanking, type Observation } from '../../engine/stage2/fallback';
import { buildTerms, roundContexts } from '../../engine/stage2/terms';

export type TestSummary =
  | {
      kind: 'ok';
      /** Median predicted time to the first key, per fitted and enabled operation, for problems from the current settings. */
      typicalMs: { opId: string; ms: number }[];
      /** Derived settings (spec 11). */
      suggested: GeneratorParams;
      /** Community band per operation and overall (spec 15). null if the default operations were not fitted. */
      standing: Standing | null;
      /** Coarse first-pass diagnosis over single atoms (spec 22.2), slowest first, at most three. */
      diagnosis: Observation[];
    }
  | { kind: 'insufficient-data' };

const TYPICAL_SAMPLES = 500;

const DIAGNOSIS_SHOWN = 3;

/**
 * Everything the results screen shows, computed from this test's trials alone.
 * typingGapMs is the median gap between the user's keystrokes in this test.
 */
export function summariseTest(
  obs: readonly Obs[],
  current: GeneratorParams,
  typingGapMs: number,
  registry: readonly Operation[] = operations,
): TestSummary {
  const fit = fitLevelModel(obs, undefined, registry);
  if (fit.kind !== 'ok') return { kind: 'insufficient-data' };
  const { model } = fit;
  const shown = registry.filter((op) => current.enabled[op.id] === true && model.opIds.includes(op.id));
  if (shown.length === 0) return { kind: 'insufficient-data' };
  const typicalMs = shown.map((op) => {
    const enabled = Object.fromEntries(registry.map((o) => [o.id, o.id === op.id]));
    const logs = predictedLogTimes(model, { enabled, ranges: current.ranges }, 1, TYPICAL_SAMPLES, registry);
    return { opId: op.id, ms: Math.exp(quantile(logs, 0.5)) };
  });
  // In-sample residuals: a Test is one session of at most 100 items, too few to cross-fit.
  // That is why this is only a coarse first pass, shown with no claim that it is real.
  // An operation the model left out has no prediction, so its rows have no residual and
  // take no part in the diagnosis. Their lapse responsibility is NaN, which the row filter
  // rules out by name instead of leaning on NaN <= 0.5 being false.
  const fitted = new Set(model.opIds);
  const resid = obs.map((o) =>
    fitted.has(o.problem.opId) ? o.y - predict(model, o.problem, registry) - (model.sessionOffsets[o.sessionId] ?? 0) : NaN,
  );
  const rows = obs
    .map((_, i) => i)
    .filter((i) => Number.isFinite(resid[i]!) && Number.isFinite(fit.lapseResp[i]!) && fit.lapseResp[i]! <= STAGE2_MAX_LAPSE_RESP);
  const terms = buildTerms(roundContexts(obs.map((o) => o.problem))).terms;
  const diagnosis = fallbackRanking(terms, resid, new Float64Array(obs.length).fill(1), rows)
    .filter((o) => o.effectLogT >= MIN_EFFECT_LOG_T)
    .slice(0, DIAGNOSIS_SHOWN);
  return {
    kind: 'ok',
    typicalMs,
    suggested: deriveParams(model, current, undefined, undefined, registry).params,
    standing: predictStanding(model, typingGapMs, registry),
    diagnosis,
  };
}

/**
 * What the results screen says about how well the level was measured. Results come from
 * this test's trials alone, so a test that hit the item limit is only a rough measure.
 */
export function levelSentence(progress: Exclude<TestProgress, 'continue'>): string {
  return progress === 'converged' ? 'Your level is measured.' : 'Your level is roughly measured from this test.';
}
