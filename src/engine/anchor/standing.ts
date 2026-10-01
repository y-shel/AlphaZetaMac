import { createProblemSource, defaultParams, operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { createRng } from '../../domain/rng';
import type { Trial } from '../../domain/types';
import { DEFAULT_ROUND_SAMPLES, LAPSE_MAX_MS } from '../constants';
import { predict, type LevelModel } from '../stage1/levelModel';
import { bandFor, type BandInfo } from './bands';

export interface Standing {
  /** Predicted score over a default-settings round. */
  overall: { score: number; band: BandInfo };
  /** Predicted score if a whole default round were this operation. */
  operations: { opId: string; score: number; band: BandInfo }[];
}

/** Median gap between keystrokes, ms: the typing time per extra digit. */
export function typingGapMs(trials: readonly Trial[]): number {
  const gaps: number[] = [];
  for (const t of trials) for (let k = 1; k < t.keystrokes.length; k++) gaps.push(t.keystrokes[k]!.t - t.keystrokes[k - 1]!.t);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

/**
 * Predicted default-settings scores (spec 15): 120 s over the mean predicted time per
 * problem, first key from the level model plus the user's typing gap per extra digit.
 */
export function predictStanding(level: LevelModel, gap: number, registry: readonly Operation[] = operations): Standing | null {
  const params = defaultParams(registry);
  const predictScore = (enabled: Record<string, boolean>): number | null => {
    if (!registry.some((op) => enabled[op.id] === true)) return null;
    const next = createProblemSource({ ...params, enabled }, createRng(1), registry);
    let total = 0;
    for (let i = 0; i < DEFAULT_ROUND_SAMPLES; i++) {
      const p = next();
      const firstKey = Math.min(Math.exp(predict(level, p, registry)), LAPSE_MAX_MS);
      total += firstKey + gap * (String(p.answer).length - 1);
    }
    return 120 / (total / DEFAULT_ROUND_SAMPLES / 1000);
  };
  const fitted = Object.fromEntries(registry.map((op) => [op.id, params.enabled[op.id] === true && level.opIds.includes(op.id)]));
  const overall = predictScore(fitted);
  if (overall === null) return null;
  const ops = registry
    .filter((op) => fitted[op.id] === true)
    .map((op) => {
      const score = predictScore(Object.fromEntries(registry.map((o) => [o.id, o.id === op.id])))!;
      return { opId: op.id, score, band: bandFor(score) };
    });
  return { overall: { score: overall, band: bandFor(overall) }, operations: ops };
}
