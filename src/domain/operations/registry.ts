import type { GeneratorParams, Problem, Range, Rng } from '../types';
import { add } from './add';
import { div } from './div';
import { mul } from './mul';
import { sub } from './sub';
import type { Operation } from './types';

/** The only place operations are listed. Everything else iterates this. */
export const operations: readonly Operation[] = [add, sub, mul, div];

export function getOperation(id: string, registry: readonly Operation[] = operations): Operation {
  const op = registry.find((o) => o.id === id);
  if (op === undefined) throw new Error(`unknown operation "${id}"`);
  return op;
}

export function defaultParams(registry: readonly Operation[] = operations): GeneratorParams {
  const enabled: Record<string, boolean> = {};
  const ranges: Record<string, Range> = {};
  for (const op of registry) {
    enabled[op.id] = true;
    for (const spec of op.paramShape.ranges) ranges[spec.key] = spec.default;
  }
  return { enabled, ranges };
}

/**
 * Returns a function that draws the next problem: an enabled operation chosen uniformly,
 * then that operation's generator. The enabled list is worked out once, here, so the
 * per-problem call does no filtering.
 */
export function createProblemSource(
  params: GeneratorParams,
  rng: Rng,
  registry: readonly Operation[] = operations,
): () => Problem {
  const enabled = registry.filter((op) => params.enabled[op.id] === true);
  if (enabled.length === 0) throw new Error('no operation is enabled');
  return () => {
    const op = enabled[Math.floor(rng.next() * enabled.length)];
    if (op === undefined) throw new Error('rng returned a value outside [0, 1)');
    return op.generate(params, rng);
  };
}
