import type { Problem, Trial } from '../types';

export interface AtomContext {
  problem: Problem;
  prev: Trial | null;
  indexInSession: number;
  roundLength: number;
}

export interface Atom {
  id: string;
  /** A sentence fragment: "requires a borrow". */
  label: string;
  family: string;
  /** null means the atom does not apply to this problem, which is not the same as false. */
  applies(ctx: AtomContext): boolean | null;
}
