import { describe, expect, it } from 'vitest';
import type { Problem } from '../../domain/types';
import { sizeOf } from '../features';
import { priorOffset } from '../prior/populationPrior';
import { levelDesign } from './design';

describe('levelDesign', () => {
  const design = levelDesign(['add', 'mul']);
  const mul: Problem = { opId: 'mul', operands: [12, 34], answer: 408 };

  it('lays out an intercept and a slope per operation, then the prior column', () => {
    expect(design.opIds).toEqual(['add', 'mul']);
    expect(design.k).toBe(5);
    expect(design.alpha('add')).toBe(0);
    expect(design.beta('add')).toBe(1);
    expect(design.alpha('mul')).toBe(2);
    expect(design.beta('mul')).toBe(3);
    expect(design.gamma).toBe(4);
  });

  it('builds the design row for a problem', () => {
    // Two two-digit factors give a prior offset that is not 0, so the prior column is checked.
    expect(priorOffset(mul)).not.toBe(0);
    const row = design.row(mul);
    expect(row).toBeInstanceOf(Float64Array);
    expect(Array.from(row)).toEqual([0, 0, 1, sizeOf(mul), priorOffset(mul)]);
  });

  it('knows which operations it holds and rejects the others', () => {
    expect(design.has('add')).toBe(true);
    expect(design.has('mul')).toBe(true);
    expect(design.has('sub')).toBe(false);
    expect(() => design.alpha('sub')).toThrow(/sub/);
    expect(() => design.beta('sub')).toThrow(/sub/);
    expect(() => design.row({ opId: 'sub', operands: [9, 4], answer: 5 })).toThrow(/sub/);
  });

  it('has only the prior column when there is no operation', () => {
    const empty = levelDesign([]);
    expect(empty.k).toBe(1);
    expect(empty.gamma).toBe(0);
  });
});
