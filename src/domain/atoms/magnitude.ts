import { baseOpId, factPair } from './problemFacts';
import type { Atom } from './types';

export const magnitudeAtoms: readonly Atom[] = [
  {
    id: 'two_digit_multiplier',
    label: 'multiplies two numbers of two digits or more',
    family: 'magnitude',
    applies: ({ problem }) => {
      if (baseOpId(problem) !== 'mul') return null;
      const [a, b] = factPair(problem);
      return a >= 10 && b >= 10;
    },
  },
  {
    id: 'answer_three_digits',
    label: 'has an answer of three digits or more',
    family: 'magnitude',
    applies: ({ problem }) => problem.answer >= 100,
  },
];
