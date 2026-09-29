import { digitsOf, factPair } from './problemFacts';
import type { Atom } from './types';

export const structureAtoms: readonly Atom[] = [
  {
    id: 'tie',
    label: 'is a tie, like 7 + 7',
    family: 'structure',
    applies: ({ problem }) => {
      const [a, b] = factPair(problem);
      return a === b;
    },
  },
  {
    id: 'near_tie',
    label: 'is a near tie, like 7 + 8',
    family: 'structure',
    applies: ({ problem }) => {
      const [a, b] = factPair(problem);
      return Math.abs(a - b) <= 1;
    },
  },
  {
    id: 'shares_digit',
    label: 'has operands that share a digit',
    family: 'structure',
    applies: ({ problem }) => {
      const [x = 0, y = 0] = problem.operands;
      const right = digitsOf(y);
      return [...digitsOf(x)].some((d) => right.includes(d));
    },
  },
  {
    id: 'operand_round',
    label: 'has an operand that is a multiple of 10',
    family: 'structure',
    applies: ({ problem }) => problem.operands.some((n) => n !== 0 && n % 10 === 0),
  },
];
