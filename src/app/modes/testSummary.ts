import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { GeneratorParams } from '../../domain/types';
import type { Obs } from '../../engine/features';
import type { TestProgress } from '../../engine/select/stopping';
import { deriveParams, predictedLogTimes, quantile } from '../../engine/params/derive';
import { fitLevelModel } from '../../engine/stage1/levelModel';

export type TestSummary =
  | {
      kind: 'ok';
      /** Median predicted time to the first key, per fitted and enabled operation, for problems from the current settings. */
      typicalMs: { opId: string; ms: number }[];
      /** Derived settings (spec 11). */
      suggested: GeneratorParams;
    }
  | { kind: 'insufficient-data' };

const TYPICAL_SAMPLES = 500;

/** Everything the results screen shows, computed from this test's trials alone. */
export function summariseTest(obs: readonly Obs[], current: GeneratorParams, registry: readonly Operation[] = operations): TestSummary {
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
  return { kind: 'ok', typicalMs, suggested: deriveParams(model, current, undefined, undefined, registry).params };
}

/**
 * What the results screen says about how well the level was measured. Results come from
 * this test's trials alone, so a test that hit the item limit is only a rough measure.
 */
export function levelSentence(progress: Exclude<TestProgress, 'continue'>): string {
  return progress === 'converged' ? 'Your level is measured.' : 'Your level is roughly measured from this test.';
}
