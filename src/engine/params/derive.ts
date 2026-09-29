import { createProblemSource, operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { createRng } from '../../domain/rng';
import type { GeneratorParams, Range } from '../../domain/types';
import { DEFAULT_DIFFICULTY_PCTILE, DERIVE_SAMPLES } from '../constants';
import { predict, type LevelModel } from '../stage1/levelModel';

const SEARCH_STEPS = 40;

/** The q-quantile of values, by linear interpolation. values is sorted in place. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) throw new Error('quantile of nothing');
  values.sort((a, b) => a - b);
  const pos = q * (values.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  return i + 1 < values.length ? values[i]! * (1 - frac) + values[i + 1]! * frac : values[i]!;
}

/**
 * Predicted log times of `samples` problems drawn from params with a fixed seed. The same
 * seed gives the same draws, so as a range grows each drawn operand can only grow. That is
 * what makes the binary search below well behaved.
 */
export function predictedLogTimes(
  model: LevelModel,
  params: GeneratorParams,
  seed: number,
  samples: number = DERIVE_SAMPLES,
  registry: readonly Operation[] = operations,
): number[] {
  const next = createProblemSource(params, createRng(seed), registry);
  const out: number[] = [];
  for (let i = 0; i < samples; i++) out.push(predict(model, next(), registry));
  return out;
}

/** Human-looking bound: a multiple of 5 below 50, of 10 from 50 up (spec 11). */
export function roundBound(n: number): number {
  return n < 50 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10;
}

export interface DerivedParams {
  /** Rounded, ready to use. */
  params: GeneratorParams;
  /** Before rounding. */
  raw: GeneratorParams;
  /** The target log time: the pctile-th percentile of predicted log times under the current params. */
  target: number;
}

/**
 * Zetamac parameters from the level model (spec 11). For each operation that owns ranges,
 * scales its upper bounds together so that the median predicted log time of it and the
 * operations derived from it hits the target. Lower bounds stay. Upper bounds stay within
 * [lower bound, max(current upper bound, testMax)]. Operations the model has not fitted,
 * or that are off, keep their ranges.
 */
export function deriveParams(
  model: LevelModel,
  current: GeneratorParams,
  pctile: number = DEFAULT_DIFFICULTY_PCTILE,
  seed = 1,
  registry: readonly Operation[] = operations,
): DerivedParams {
  const usable = (op: Operation) => current.enabled[op.id] === true && model.opIds.includes(op.id);
  const overallEnabled = Object.fromEntries(registry.map((op) => [op.id, usable(op)]));
  if (!registry.some(usable)) throw new Error('the model fits none of the enabled operations');
  const target = quantile(predictedLogTimes(model, { ...current, enabled: overallEnabled }, seed, DERIVE_SAMPLES, registry), pctile);

  const raw: Record<string, Range> = { ...current.ranges };
  for (const owner of registry) {
    const specs = owner.paramShape.ranges;
    if (specs.length === 0) continue;
    const group = registry.filter((op) => (op.derivesFrom ?? op.id) === owner.id && usable(op));
    if (group.length === 0) continue;
    const enabled = Object.fromEntries(registry.map((op) => [op.id, group.includes(op)]));
    const cur = specs.map((spec) => current.ranges[spec.key] ?? spec.default);
    const rangesAt = (scale: number): Record<string, Range> => {
      const out: Record<string, Range> = { ...current.ranges };
      specs.forEach((spec, i) => {
        const [lo, hi] = cur[i]!;
        const cap = Math.max(hi, spec.testMax);
        out[spec.key] = [lo, Math.min(cap, Math.max(lo, Math.round(hi * scale)))];
      });
      return out;
    };
    const medianAt = (scale: number) =>
      quantile(predictedLogTimes(model, { enabled, ranges: rangesAt(scale) }, seed + 1, DERIVE_SAMPLES, registry), 0.5);
    // Scale 0 puts every upper bound at its lower bound. maxScale puts every one at its cap.
    const maxScale = Math.max(...specs.map((spec, i) => Math.max(cur[i]![1], spec.testMax) / Math.max(cur[i]![1], 1)));
    let lo = 0;
    let hi = maxScale;
    if (medianAt(hi) <= target) lo = hi;
    else if (medianAt(lo) >= target) hi = lo;
    else
      for (let step = 0; step < SEARCH_STEPS; step++) {
        const mid = (lo + hi) / 2;
        if (medianAt(mid) < target) lo = mid;
        else hi = mid;
      }
    Object.assign(raw, Object.fromEntries(specs.map((spec) => [spec.key, rangesAt((lo + hi) / 2)[spec.key]!])));
  }

  const rounded: Record<string, Range> = { ...raw };
  for (const op of registry)
    for (const spec of op.paramShape.ranges) {
      const r = raw[spec.key];
      if (r === undefined || r === current.ranges[spec.key]) continue;
      const [lo, hi] = r;
      rounded[spec.key] = [lo, Math.max(lo, roundBound(hi))];
    }
  return { params: { enabled: current.enabled, ranges: rounded }, raw: { enabled: current.enabled, ranges: raw }, target };
}
