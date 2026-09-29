import type { GeneratorParams, Range } from './types';

export function getRange(params: GeneratorParams, key: string): Range {
  const range = params.ranges[key];
  if (range === undefined) throw new Error(`no range "${key}" in generator params`);
  return range;
}

export function operandAt(operands: readonly number[], i: number): number {
  const v = operands[i];
  if (v === undefined) throw new Error(`problem has no operand ${i}`);
  return v;
}
