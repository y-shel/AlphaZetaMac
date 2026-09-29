import { digitsOf } from './problemFacts';
import type { Atom } from './types';

function containsDigit(digit: string): Atom {
  return {
    id: `contains_${digit}`,
    label: `shows a ${digit}`,
    family: 'digits',
    applies: ({ problem }) => problem.operands.some((n) => digitsOf(n).includes(digit)),
  };
}

export const digitAtoms: readonly Atom[] = [containsDigit('7'), containsDigit('8'), containsDigit('9')];
