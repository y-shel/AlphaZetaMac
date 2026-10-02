import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { GeneratorParams, Problem, Range, Rng } from '../../domain/types';
import { MIN_PIVOT_RATIO, TEST_CANDIDATES, TEST_DESIGN_RIDGE } from '../constants';
import { levelDesign, type LevelDesign } from '../stage1/design';
import { cholesky, cholSolve } from '../stage1/linalg';

/**
 * The parameter space the Test tab samples from: the user's enabled operations, each range
 * from the user's lower bound up to the registry's testMax, or the user's own upper bound
 * if that is higher.
 */
export function testSpace(params: GeneratorParams, registry: readonly Operation[] = operations): GeneratorParams {
  const ranges: Record<string, Range> = { ...params.ranges };
  for (const op of registry)
    for (const spec of op.paramShape.ranges) {
      const [lo, hi] = params.ranges[spec.key] ?? spec.default;
      ranges[spec.key] = [lo, Math.max(hi, spec.testMax)];
    }
  return { enabled: params.enabled, ranges };
}

/**
 * Draws candidate problems spread over the size scale. Each candidate first draws an upper
 * bound for every range, log-uniform between the range's ends, then asks the operation to
 * generate a problem within [lo, that bound]. Sizes then spread from small to large instead
 * of piling up near the top, as uniform operands would.
 */
export function sampleCandidates(
  space: GeneratorParams,
  rng: Rng,
  count: number = TEST_CANDIDATES,
  registry: readonly Operation[] = operations,
): Problem[] {
  const enabled = registry.filter((op) => space.enabled[op.id] === true);
  if (enabled.length === 0) throw new Error('no operation is enabled');
  const out: Problem[] = [];
  for (let i = 0; i < count; i++) {
    const op = enabled[Math.floor(rng.next() * enabled.length)]!;
    const ranges: Record<string, Range> = {};
    for (const [key, [lo, hi]] of Object.entries(space.ranges)) {
      const a = Math.max(lo, 1);
      const top = Math.round(Math.exp(Math.log(a) + rng.next() * (Math.log(Math.max(hi, a)) - Math.log(a))));
      ranges[key] = [lo, Math.min(Math.max(top, lo), hi)];
    }
    out.push(op.generate({ enabled: space.enabled, ranges }, rng));
  }
  return out;
}

/**
 * Greedy sequential D-optimal design for the level model (spec 22.2). Its rows are the
 * level model's own design rows, from levelDesign, so the two cannot drift apart.
 * Selection depends only on which problems were shown, never on the answers.
 */
export class DOptimalDesign {
  readonly opIds: readonly string[];
  private readonly k: number;
  private readonly m: Float64Array;
  private readonly design: LevelDesign;

  constructor(opIds: readonly string[], registry: readonly Operation[] = operations) {
    this.opIds = opIds;
    this.design = levelDesign(opIds, registry);
    this.k = this.design.k;
    this.m = new Float64Array(this.k * this.k);
    for (let i = 0; i < this.k; i++) this.m[i * this.k + i] = TEST_DESIGN_RIDGE;
  }

  row(problem: Problem): Float64Array {
    return this.design.row(problem);
  }

  /** Records a shown problem. */
  add(problem: Problem): void {
    const x = this.row(problem);
    const k = this.k;
    for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) this.m[r * k + c] = this.m[r * k + c]! + x[r]! * x[c]!;
  }

  /** The candidate maximising xᵀ M⁻¹ x. Ties go to the earliest. */
  choose(candidates: readonly Problem[]): Problem {
    const l = cholesky(this.m, this.k, MIN_PIVOT_RATIO);
    if (l === null) throw new Error('the design matrix is singular');
    let best: Problem | undefined;
    let bestScore = -Infinity;
    for (const p of candidates) {
      const x = this.row(p);
      const v = cholSolve(l, this.k, x);
      let s = 0;
      for (let i = 0; i < this.k; i++) s += x[i]! * v[i]!;
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best === undefined) throw new Error('no candidates');
    return best;
  }
}
