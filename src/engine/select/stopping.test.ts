import { describe, expect, it } from 'vitest';
import { TEST_TAB_ITEMS, TEST_TAB_MIN_ITEMS } from '../constants';
import type { Obs } from '../features';
import { testProgress } from './stopping';

/** Low-noise observations over a spread of sizes, so the fit is tight. */
function obs(n: number, opIds: string[]): Obs[] {
  return Array.from({ length: n }, (_, i) => {
    const opId = opIds[i % opIds.length]!;
    const a = 2 + ((i * 37) % 200);
    const b = 2 + ((i * 11) % 9);
    const problem = opId === 'add' ? { opId, operands: [a, b], answer: a + b } : { opId, operands: [b, a], answer: a * b };
    return { problem, y: 6 + 0.4 * Math.log(a + b) + 0.001 * ((i * 7919) % 13), sessionId: 's' };
  });
}

describe('testProgress', () => {
  it('continues before TEST_TAB_MIN_ITEMS however tight the fit', () => {
    expect(testProgress(obs(TEST_TAB_MIN_ITEMS - 1, ['add']), ['add'])).toBe('continue');
  });

  it('converges at TEST_TAB_MIN_ITEMS when the fit is tight', () => {
    expect(testProgress(obs(TEST_TAB_MIN_ITEMS, ['add']), ['add'])).toBe('converged');
  });

  it('continues while an operation in the test has too few items to fit', () => {
    const o = obs(TEST_TAB_MIN_ITEMS, ['add']);
    o.push({ problem: { opId: 'mul', operands: [3, 4], answer: 12 }, y: 7, sessionId: 's' });
    expect(testProgress(o, ['add', 'mul'])).toBe('continue');
  });

  it('stops at TEST_TAB_ITEMS regardless', () => {
    expect(testProgress(obs(TEST_TAB_ITEMS, ['add']), ['add', 'mul'])).toBe('limit');
  });
});
