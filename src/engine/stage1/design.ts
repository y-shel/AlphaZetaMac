import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Problem } from '../../domain/types';
import { sizeOf } from '../features';
import { priorOffset } from '../prior/populationPrior';

/**
 * The column layout of the Stage 1 level model (spec 8.2): for each operation in order,
 * its intercept then its size slope, and the prior coefficient last. The fit, the stored
 * covariance and the Test tab's item choice (spec 22.2) all read the layout from here.
 */
export interface LevelDesign {
  /** The operations in the design, in column order. */
  readonly opIds: readonly string[];
  /** The column count. */
  readonly k: number;
  /** The column of the prior coefficient. */
  readonly gamma: number;
  has(opId: string): boolean;
  /** The intercept column of an operation. Throws for an operation outside the design. */
  alpha(opId: string): number;
  /** The size slope column of an operation. Throws for an operation outside the design. */
  beta(opId: string): number;
  /**
   * The design row for a problem: 1 in its operation's intercept column, its size in the
   * slope column, its prior offset in the prior column. Throws for an operation outside
   * the design.
   */
  row(problem: Problem): Float64Array;
}

export function levelDesign(opIds: readonly string[], registry: readonly Operation[] = operations): LevelDesign {
  const col = new Map(opIds.map((id, j) => [id, 2 * j]));
  const k = 2 * opIds.length + 1;
  const alpha = (opId: string): number => {
    const c = col.get(opId);
    if (c === undefined) throw new Error(`operation "${opId}" is not in this design`);
    return c;
  };
  return {
    opIds,
    k,
    gamma: k - 1,
    has: (opId) => col.has(opId),
    alpha,
    beta: (opId) => alpha(opId) + 1,
    row(problem) {
      const c = alpha(problem.opId);
      const x = new Float64Array(k);
      x[c] = 1;
      x[c + 1] = sizeOf(problem, registry);
      x[k - 1] = priorOffset(problem);
      return x;
    },
  };
}
