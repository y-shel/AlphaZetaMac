import { getRange, operandAt } from '../range';
import { randInt } from '../rng';
import type { Operation } from './types';

/** Addition in reverse: draw a and b from the addition ranges, show (a + b) – a. */
export const sub: Operation = {
  id: 'sub',
  label: 'Subtraction',
  symbol: '–',
  derivesFrom: 'add',
  paramShape: { ranges: [] },
  render: (operands) => `${operandAt(operands, 0)} – ${operandAt(operands, 1)}`,
  generate(params, rng) {
    const a = randInt(rng, getRange(params, 'addA'));
    const b = randInt(rng, getRange(params, 'addB'));
    return { opId: 'sub', operands: [a + b, a], answer: b };
  },
  // operands[0] is a + b, so this is log(a + b) as spec 7.1 requires.
  sizeMetric: (p) => Math.log(operandAt(p.operands, 0)),
};
