import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getRange } from '../range';
import { createRng } from '../rng';
import type { GeneratorParams, Problem, Range } from '../types';
import { createProblemSource, defaultParams, getOperation, operations } from './registry';

const within = (n: number | undefined, [lo, hi]: Range) => n !== undefined && n >= lo && n <= hi;
const PROPERTY_RUNS = { seed: 20260929, numRuns: 2000 };

describe('operation registry', () => {
  it('holds add, sub, mul, div in that order', () => {
    expect(operations.map((o) => o.id)).toEqual(['add', 'sub', 'mul', 'div']);
  });

  it('points every derivesFrom at a registered operation', () => {
    for (const op of operations) {
      const parent = op.derivesFrom;
      if (parent !== undefined) expect(() => getOperation(parent)).not.toThrow();
    }
  });

  it('uses each range key once across the registry', () => {
    const keys = operations.flatMap((o) => o.paramShape.ranges.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('defaults to the Zetamac settings', () => {
    expect(defaultParams()).toEqual({
      enabled: { add: true, sub: true, mul: true, div: true },
      ranges: { addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100] },
    });
  });

  it('throws on an unknown operation id', () => {
    expect(() => getOperation('pow')).toThrow('unknown operation "pow"');
  });
});

describe('render and sizeMetric', () => {
  const cases: [Problem, string, number][] = [
    [{ opId: 'add', operands: [12, 34], answer: 46 }, '12 + 34', Math.log(46)],
    [{ opId: 'sub', operands: [46, 12], answer: 34 }, '46 – 12', Math.log(46)],
    [{ opId: 'mul', operands: [7, 8], answer: 56 }, '7 × 8', Math.log(56)],
    [{ opId: 'div', operands: [56, 7], answer: 8 }, '56 ÷ 7', Math.log(56)],
  ];
  it.each(cases)('%o renders as %s', (problem, text, size) => {
    const op = getOperation(problem.opId);
    expect(op.render(problem.operands)).toBe(text);
    expect(op.sizeMetric(problem)).toBeCloseTo(size, 12);
  });
});

const rangeFrom = (floor: number) =>
  fc
    .tuple(fc.integer({ min: floor, max: 500 }), fc.integer({ min: floor, max: 500 }))
    .map(([x, y]): Range => (x <= y ? [x, y] : [y, x]));

const paramsArb: fc.Arbitrary<GeneratorParams> = fc
  .record({ addA: rangeFrom(0), addB: rangeFrom(0), mulA: rangeFrom(1), mulB: rangeFrom(0) })
  .map((ranges) => ({ enabled: { add: true, sub: true, mul: true, div: true }, ranges }));

describe('generation properties', () => {
  it('addition draws from its ranges and answers the sum', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const p = getOperation('add').generate(params, createRng(seed));
        const [a, b] = p.operands;
        return within(a, getRange(params, 'addA')) && within(b, getRange(params, 'addB')) && p.answer === a! + b!;
      }),
      PROPERTY_RUNS,
    );
  });

  it('subtraction never goes negative and inverts an addition', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const p = getOperation('sub').generate(params, createRng(seed));
        const [total, a] = p.operands;
        return (
          p.answer >= 0 &&
          total! - a! === p.answer &&
          within(a, getRange(params, 'addA')) &&
          within(p.answer, getRange(params, 'addB'))
        );
      }),
      PROPERTY_RUNS,
    );
  });

  it('multiplication draws from its ranges and answers the product', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const p = getOperation('mul').generate(params, createRng(seed));
        const [a, b] = p.operands;
        return within(a, getRange(params, 'mulA')) && within(b, getRange(params, 'mulB')) && p.answer === a! * b!;
      }),
      PROPERTY_RUNS,
    );
  });

  it('division always gives a whole answer and inverts a multiplication', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const p = getOperation('div').generate(params, createRng(seed));
        const [product, a] = p.operands;
        return (
          Number.isInteger(p.answer) &&
          a !== 0 &&
          product! / a! === p.answer &&
          within(a, getRange(params, 'mulA')) &&
          within(p.answer, getRange(params, 'mulB'))
        );
      }),
      PROPERTY_RUNS,
    );
  });
});

describe('createProblemSource', () => {
  it('only draws enabled operations, and draws all of them', () => {
    const params = { ...defaultParams(), enabled: { add: false, sub: true, mul: false, div: true } };
    const next = createProblemSource(params, createRng(5));
    const seen = new Set(Array.from({ length: 500 }, () => next().opId));
    expect([...seen].sort()).toEqual(['div', 'sub']);
  });

  it('throws when nothing is enabled', () => {
    const params = { ...defaultParams(), enabled: { add: false, sub: false, mul: false, div: false } };
    expect(() => createProblemSource(params, createRng(1))).toThrow('no operation is enabled');
  });

  it('reproduces the golden sequence for the defaults and seed 20260929', () => {
    const next = createProblemSource(defaultParams(), createRng(20260929));
    const seq = Array.from({ length: 12 }, () => {
      const p = next();
      return `${getOperation(p.opId).render(p.operands)} = ${p.answer}`;
    });
    expect(seq).toEqual([
      '104 – 74 = 30',
      '96 – 61 = 35',
      '3 × 65 = 195',
      '63 + 94 = 157',
      '6 × 23 = 138',
      '174 – 87 = 87',
      '660 ÷ 10 = 66',
      '84 + 55 = 139',
      '22 + 88 = 110',
      '84 + 73 = 157',
      '3 × 14 = 42',
      '77 – 55 = 22',
    ]);
  });
});
