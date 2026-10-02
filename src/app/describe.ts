import { atoms } from '../domain/atoms/registry';
import { operations } from '../domain/operations/registry';
import type { Finding } from '../engine/findings/finding';

/** The operation an 'op_' atom stands for, if it is one. Registry lookup, no names. */
function scopeOf(atomId: string) {
  return operations.find((op) => `op_${op.id}` === atomId);
}

/** Plain words for a term: "A multiplication problem that shows a 7". */
export function describeTerm(atomIds: readonly string[]): string {
  const scope = atomIds.map(scopeOf).find((op) => op !== undefined);
  const rest: string[] = [];
  for (const id of atomIds.filter((id) => scopeOf(id) === undefined)) {
    const atom = atoms.find((a) => a.id === id);
    // A stored id can outlive its atom. Say so, rather than fail the whole dashboard.
    if (atom === undefined) return 'An unknown kind of problem';
    rest.push(atom.label);
  }
  const noun = scope === undefined ? 'A problem' : `A ${scope.label.toLowerCase()} problem`;
  return rest.length === 0 ? noun : `${noun} that ${rest.join(' and ')}`;
}

/** Term ids are atom ids joined by '&'. */
export function describeTermId(termId: string): string {
  return describeTerm(termId.split('&'));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

/**
 * A finding in the user's units (spec 12.3). Title "A problem that shows an 8", body "Each
 * one costs you about 440 ms. They are 33% of a typical round, about 1.7 problems off your
 * score."
 */
export function describeFinding(f: Finding): { title: string; body: string } {
  const title =
    f.terms.length === 1
      ? describeTermId(f.terms[0]!)
      : `Either ${f.terms.map((t) => describeTermId(t).replace(/^A /, 'a ')).join(', or ')}. The data cannot yet tell these apart`;
  const cost =
    f.tier === 'confirmed'
      ? `about ${pts(f.scorePoints)} problems off your score, somewhere between ${pts(Math.max(f.scorePointsLow, 0))} and ${pts(f.scorePointsHigh)}`
      : `about ${pts(f.scorePoints)} problems off your score`;
  const round = f.prevalenceEstimated ? 'a default round (you have no normal rounds yet, so this is an estimate)' : 'a typical round';
  return {
    title,
    body: `Each one costs you about ${Math.round(f.effectMs)} ms. They are ${pct(f.prevalence)} of ${round}, ${cost}.`,
  };
}
