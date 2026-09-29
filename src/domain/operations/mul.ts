import { getRange, operandAt } from '../range';
import { randInt } from '../rng';
import type { Operation } from './types';

export const mul: Operation = {
  id: 'mul',
  label: 'Multiplication',
  symbol: '×',
  paramShape: {
    ranges: [
      { key: 'mulA', label: 'first factor', default: [2, 12], floor: 1 },
      { key: 'mulB', label: 'second factor', default: [2, 100], floor: 0 },
    ],
  },
  render: (operands) => `${operandAt(operands, 0)} × ${operandAt(operands, 1)}`,
  generate(params, rng) {
    const a = randInt(rng, getRange(params, 'mulA'));
    const b = randInt(rng, getRange(params, 'mulB'));
    return { opId: 'mul', operands: [a, b], answer: a * b };
  },
  sizeMetric: (p) => Math.log(operandAt(p.operands, 0) * operandAt(p.operands, 1)),
};
