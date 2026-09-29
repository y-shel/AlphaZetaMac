import { getRange, operandAt } from '../range';
import { randInt } from '../rng';
import type { Operation } from './types';

export const add: Operation = {
  id: 'add',
  label: 'Addition',
  symbol: '+',
  paramShape: {
    ranges: [
      { key: 'addA', label: 'first addend', default: [2, 100], floor: 0 },
      { key: 'addB', label: 'second addend', default: [2, 100], floor: 0 },
    ],
  },
  render: (operands) => `${operandAt(operands, 0)} + ${operandAt(operands, 1)}`,
  generate(params, rng) {
    const a = randInt(rng, getRange(params, 'addA'));
    const b = randInt(rng, getRange(params, 'addB'));
    return { opId: 'add', operands: [a, b], answer: a + b };
  },
  sizeMetric: (p) => Math.log(operandAt(p.operands, 0) + operandAt(p.operands, 1)),
};
