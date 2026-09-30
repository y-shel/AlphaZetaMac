import { describe, expect, it } from 'vitest';
import { defaultParams, operations } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { GeneratorParams, Problem } from '../../domain/types';
import { sizeOf } from '../features';
import { DOptimalDesign, sampleCandidates, testSpace } from './dOptimal';

describe('testSpace', () => {
  it('keeps lower bounds and raises each upper bound to testMax', () => {
    const space = testSpace(defaultParams());
    for (const op of operations)
      for (const spec of op.paramShape.ranges) expect(space.ranges[spec.key]).toEqual([spec.default[0], spec.testMax]);
  });

  it('keeps a user upper bound that is already above testMax', () => {
    const params = defaultParams();
    const big: GeneratorParams = { ...params, ranges: { ...params.ranges, addA: [5, 5000] } };
    expect(testSpace(big).ranges.addA).toEqual([5, 5000]);
  });
});

describe('sampleCandidates', () => {
  it('draws only enabled operations, with operands inside the space', () => {
    const params = defaultParams();
    const space = testSpace({ ...params, enabled: { ...params.enabled, mul: false, div: false } });
    const cands = sampleCandidates(space, createRng(1), 500);
    expect(cands).toHaveLength(500);
    for (const c of cands) {
      expect(['add', 'sub']).toContain(c.opId);
      const [a, b] = c.opId === 'add' ? c.operands : [c.operands[1]!, c.answer];
      expect(a).toBeGreaterThanOrEqual(2);
      expect(a).toBeLessThanOrEqual(300);
      expect(b).toBeGreaterThanOrEqual(2);
      expect(b).toBeLessThanOrEqual(300);
    }
  });

  it('spreads sizes: a good share of candidates are small', () => {
    const cands = sampleCandidates(testSpace(defaultParams()), createRng(2), 1000).filter((c) => c.opId === 'add');
    const small = cands.filter((c) => c.answer < 60).length / cands.length;
    expect(small).toBeGreaterThan(0.2);
  });
});

describe('DOptimalDesign', () => {
  const add = (a: number, b: number): Problem => ({ opId: 'add', operands: [a, b], answer: a + b });

  it('builds rows as [1, size, prior] in the operation column', () => {
    const design = new DOptimalDesign(['add', 'mul']);
    const x = design.row({ opId: 'mul', operands: [12, 34], answer: 408 });
    expect(Array.from(x)).toEqual([0, 0, 1, sizeOf({ opId: 'mul', operands: [12, 34], answer: 408 }), 0.3]);
  });

  it('prefers a problem unlike those already shown', () => {
    const design = new DOptimalDesign(['add']);
    for (let i = 0; i < 20; i++) design.add(add(50, 50));
    expect(design.choose([add(50, 51), add(3, 4)])).toEqual(add(3, 4));
  });

  it('prefers the operation that has been shown least', () => {
    const design = new DOptimalDesign(['add', 'mul']);
    for (let i = 0; i < 10; i++) {
      design.add(add(10 + i, 20));
      design.add(add(100 + i, 150));
    }
    const mul: Problem = { opId: 'mul', operands: [7, 8], answer: 56 };
    expect(design.choose([add(40, 41), mul])).toEqual(mul);
  });

  it('rejects an operation outside the design', () => {
    expect(() => new DOptimalDesign(['add']).row({ opId: 'mul', operands: [2, 3], answer: 6 })).toThrow(/mul/);
  });
});
