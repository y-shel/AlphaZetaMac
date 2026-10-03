import { defaultParams, operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { DEFAULT_ROUND_SECONDS, LAPSE_MAX_MS, STANDING_SAMPLES } from '../constants';
import { sampleProblems } from '../round/reference';
import { predict, type LevelModel } from '../stage1/levelModel';
import { bandFor, type BandInfo } from './bands';

export interface Standing {
  /**
   * Predicted score over a default-settings round. null unless every operation that default
   * settings enable is fitted: a score over some of them is not a default-settings score.
   */
  overall: { score: number; band: BandInfo } | null;
  /** Predicted score if a whole default round were this operation. */
  operations: { opId: string; score: number; band: BandInfo }[];
}

// typingGapMs lives with the reference round. It is re-exported so existing imports keep working.
export { typingGapMs } from '../round/reference';

/**
 * Predicted default-settings scores (spec 15): 120 s over the mean time per problem, the
 * expected first key from the level model plus the user's typing gap per extra digit.
 *
 * A score counts problems per round, so it follows the mean time, not the median. The level
 * model predicts the mean of log time, and e to that is the median. For a lognormal time the
 * mean is the median times e^(sigma^2 / 2). A lapse is uniform on 0 to LAPSE_MAX_MS
 * (spec 8.4), so it takes half of that on average.
 */
export function predictStanding(level: LevelModel, gap: number, registry: readonly Operation[] = operations): Standing | null {
  const params = defaultParams(registry);
  const predictScore = (enabled: Record<string, boolean>): number | null => {
    if (!registry.some((op) => enabled[op.id] === true)) return null;
    let total = 0;
    for (const p of sampleProblems({ ...params, enabled }, 1, STANDING_SAMPLES, registry)) {
      const attentive = Math.min(Math.exp(predict(level, p, registry) + (level.sigma * level.sigma) / 2), LAPSE_MAX_MS);
      const firstKey = (1 - level.lapseRate) * attentive + (level.lapseRate * LAPSE_MAX_MS) / 2;
      total += firstKey + gap * (String(p.answer).length - 1);
    }
    return DEFAULT_ROUND_SECONDS / (total / STANDING_SAMPLES / 1000);
  };
  const fitted = Object.fromEntries(registry.map((op) => [op.id, params.enabled[op.id] === true && level.opIds.includes(op.id)]));
  if (!registry.some((op) => fitted[op.id] === true)) return null;
  const complete = registry.every((op) => params.enabled[op.id] !== true || fitted[op.id] === true);
  const overall = complete ? predictScore(fitted) : null;
  const ops = registry
    .filter((op) => fitted[op.id] === true)
    .map((op) => {
      const score = predictScore(Object.fromEntries(registry.map((o) => [o.id, o.id === op.id])))!;
      return { opId: op.id, score, band: bandFor(score) };
    });
  return { overall: overall === null ? null : { score: overall, band: bandFor(overall) }, operations: ops };
}
