import { operandAt } from '../range';
import type { Problem } from '../types';
import type { Atom } from './types';

function countCarries(a: number, b: number): number {
  let carries = 0;
  let carry = 0;
  while (a > 0 || b > 0) {
    carry = (a % 10) + (b % 10) + carry >= 10 ? 1 : 0;
    carries += carry;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return carries;
}

/** Column subtraction borrows at the first column where the top digit is smaller. */
function needsBorrow(top: number, bottom: number): boolean {
  while (bottom > 0) {
    if (top % 10 < bottom % 10) return true;
    top = Math.floor(top / 10);
    bottom = Math.floor(bottom / 10);
  }
  return false;
}

function additionCarries(p: Problem): number | null {
  if (p.opId !== 'add') return null;
  return countCarries(operandAt(p.operands, 0), operandAt(p.operands, 1));
}

export const carryAtoms: readonly Atom[] = [
  {
    id: 'carry_required',
    label: 'requires a carry',
    family: 'carry',
    applies: ({ problem }) => {
      const n = additionCarries(problem);
      return n === null ? null : n >= 1;
    },
  },
  {
    id: 'carry_multiple',
    label: 'requires more than one carry',
    family: 'carry',
    applies: ({ problem }) => {
      const n = additionCarries(problem);
      return n === null ? null : n >= 2;
    },
  },
  {
    id: 'borrow_required',
    label: 'requires a borrow',
    family: 'carry',
    applies: ({ problem }) =>
      problem.opId === 'sub'
        ? needsBorrow(operandAt(problem.operands, 0), operandAt(problem.operands, 1))
        : null,
  },
];
