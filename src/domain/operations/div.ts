import { getRange, operandAt } from '../range';
import { randInt } from '../rng';
import type { Operation } from './types';

/** Multiplication in reverse: draw a and b from the multiplication ranges, show (a × b) ÷ a. */
export const div: Operation = {
  id: 'div',
  label: 'Division',
  symbol: '÷',
  derivesFrom: 'mul',
  paramShape: { ranges: [] },
  render: (operands) => `${operandAt(operands, 0)} ÷ ${operandAt(operands, 1)}`,
  generate(params, rng) {
    const a = randInt(rng, getRange(params, 'mulA'));
    const b = randInt(rng, getRange(params, 'mulB'));
    return { opId: 'div', operands: [a * b, a], answer: b };
  },
  // operands[0] is a × b, so this is log(a · b) as spec 7.1 requires.
  sizeMetric: (p) => Math.log(operandAt(p.operands, 0)),
};
