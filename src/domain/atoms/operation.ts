import { operations } from '../operations/registry';
import type { Atom } from './types';

/** One atom per registered operation, so a new operation gets its atom for free. */
export const operationAtoms: readonly Atom[] = operations.map((op) => ({
  id: `op_${op.id}`,
  label: `is ${op.label.toLowerCase()}`,
  family: 'operation',
  applies: (ctx) => ctx.problem.opId === op.id,
}));
