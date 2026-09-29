import type { Atom } from './types';

/** Share of the round after which a problem counts as late. */
const LATE_FRACTION = 0.6;

export const sequenceAtoms: readonly Atom[] = [
  {
    id: 'prev_op_differs',
    label: 'follows a different operation',
    family: 'sequence',
    applies: ({ problem, prev }) => (prev === null ? null : prev.opId !== problem.opId),
  },
  {
    id: 'late_in_round',
    label: 'comes late in the round',
    family: 'sequence',
    applies: ({ indexInSession, roundLength }) =>
      roundLength <= 0 ? null : indexInSession > LATE_FRACTION * roundLength,
  },
];
