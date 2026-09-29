import { carryAtoms } from './carry';
import { digitAtoms } from './digits';
import { magnitudeAtoms } from './magnitude';
import { operationAtoms } from './operation';
import { sequenceAtoms } from './sequence';
import { structureAtoms } from './structure';
import type { Atom } from './types';

/** The only place atoms are listed. Everything else iterates this. */
export const atoms: readonly Atom[] = [
  ...operationAtoms,
  ...carryAtoms,
  ...structureAtoms,
  ...digitAtoms,
  ...magnitudeAtoms,
  ...sequenceAtoms,
];

export function getAtom(id: string): Atom {
  const atom = atoms.find((a) => a.id === id);
  if (atom === undefined) throw new Error(`unknown atom "${id}"`);
  return atom;
}
