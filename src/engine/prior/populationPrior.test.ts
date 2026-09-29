import { describe, expect, it } from 'vitest';
import { getAtom } from '../../domain/atoms/registry';
import type { Problem } from '../../domain/types';
import { POPULATION_PRIOR, priorOffset } from './populationPrior';

const p = (opId: string, operands: number[], answer: number): Problem => ({ opId, operands, answer });

describe('populationPrior', () => {
  it('names only registered atoms', () => {
    for (const id of Object.keys(POPULATION_PRIOR)) expect(() => getAtom(id)).not.toThrow();
  });

  it.each([
    ['no feature', p('add', [21, 34], 55), 0],
    ['one carry', p('add', [27, 34], 61), 0.13],
    ['two carries', p('add', [58, 67], 125), 0.2],
    ['a borrow', p('sub', [61, 27], 34), 0.18],
    ['an addition tie', p('add', [4, 4], 8), -0.15],
    ['a tie with a carry', p('add', [7, 7], 14), -0.02],
    ['a division tie', p('div', [49, 7], 7), -0.15],
    ['two two-digit factors', p('mul', [12, 34], 408), 0.3],
    ['a round operand', p('mul', [3, 40], 120), -0.1],
    ['a round operand and a carry', p('add', [40, 67], 107), 0.03],
  ])('%s', (_, problem, expected) => {
    expect(priorOffset(problem)).toBeCloseTo(expected, 12);
  });
});
