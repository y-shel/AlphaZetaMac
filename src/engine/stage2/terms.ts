import { atoms as atomRegistry } from '../../domain/atoms/registry';
import type { Atom, AtomContext } from '../../domain/atoms/types';
import { MAX_CONJUNCTION_DEPTH, TERM_MAX_PREVALENCE, TERM_MIN_POSITIVE_TRIALS, TERM_MIN_PREVALENCE } from '../constants';

// The context builders live in the domain. They are re-exported for existing callers.
export { atomContexts, roundContexts } from '../../domain/atoms/contexts';

/** 1 true, 0 false, -1 not applicable. */
export type TermValues = Int8Array;

export interface Term {
  /** Atom ids joined by '&', sorted. */
  id: string;
  atomIds: readonly string[];
  values: TermValues;
  nApplicable: number;
  nPositive: number;
  /** nPositive / nApplicable. */
  prevalence: number;
}

/** A term that fails only for want of positive trials, and roughly how many more trials it needs. */
export interface BlindSpot {
  id: string;
  atomIds: readonly string[];
  nPositive: number;
  moreTrialsNeeded: number;
}

export interface TermMatrix {
  terms: Term[];
  blindSpots: BlindSpot[];
}

export function atomValues(atom: Atom, contexts: readonly AtomContext[]): TermValues {
  return Int8Array.from(contexts, (ctx) => {
    const v = atom.applies(ctx);
    return v === null ? -1 : v ? 1 : 0;
  });
}

function makeTerm(atomIds: readonly string[], values: TermValues): Term {
  let nApplicable = 0;
  let nPositive = 0;
  for (const v of values) {
    if (v < 0) continue;
    nApplicable++;
    nPositive += v;
  }
  return { id: [...atomIds].sort().join('&'), atomIds, values, nApplicable, nPositive, prevalence: nApplicable === 0 ? 0 : nPositive / nApplicable };
}

/** Operation atoms are scopes, not effects: Stage 1 already fits a level per operation. */
function isScope(t: Term, registry: readonly Atom[]): boolean {
  return t.atomIds.length === 1 && registry.find((a) => a.id === t.atomIds[0])?.family === SCOPE_FAMILY;
}

const SCOPE_FAMILY = 'operation';

function passes(t: Term): boolean {
  return t.prevalence >= TERM_MIN_PREVALENCE && t.prevalence <= TERM_MAX_PREVALENCE && t.nPositive >= TERM_MIN_POSITIVE_TRIALS;
}

function sameValues(a: TermValues, b: TermValues): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function blindSpot(t: Term): BlindSpot | null {
  // In range on prevalence but short of positives: it will pass with more play.
  if (t.nPositive >= TERM_MIN_POSITIVE_TRIALS || t.prevalence < TERM_MIN_PREVALENCE || t.prevalence > TERM_MAX_PREVALENCE) return null;
  const perTrial = t.nPositive / Math.max(t.values.length, 1);
  return {
    id: t.id,
    atomIds: t.atomIds,
    nPositive: t.nPositive,
    moreTrialsNeeded: Math.ceil((TERM_MIN_POSITIVE_TRIALS - t.nPositive) / Math.max(perTrial, 1e-9)),
  };
}

/**
 * The Stage 2 design matrix (spec 10.1). Atoms passing the prevalence rule, then depth-2
 * conjunctions of passing atoms that pass it too. A conjunction is not applicable where
 * either parent is not. A term identical to one already kept adds nothing and is dropped.
 */
export function buildTerms(contexts: readonly AtomContext[], registry: readonly Atom[] = atomRegistry): TermMatrix {
  const kept: Term[] = [];
  const blindSpots: BlindSpot[] = [];
  const consider = (t: Term) => {
    if (passes(t)) {
      if (!kept.some((k) => sameValues(k.values, t.values))) kept.push(t);
    } else {
      const b = blindSpot(t);
      if (b !== null) blindSpots.push(b);
    }
  };
  for (const atom of registry) consider(makeTerm([atom.id], atomValues(atom, contexts)));
  const parents = kept.slice();
  if (MAX_CONJUNCTION_DEPTH >= 2) {
    for (let a = 0; a < parents.length; a++)
      for (let b = a + 1; b < parents.length; b++) {
        const pa = parents[a]!;
        const pb = parents[b]!;
        const values = new Int8Array(contexts.length);
        const scopeA = isScope(pa, registry);
        const scopeB = isScope(pb, registry);
        if (scopeA && scopeB) continue;
        for (let i = 0; i < values.length; i++) {
          const x = pa.values[i]!;
          const y = pb.values[i]!;
          if (x < 0 || y < 0) values[i] = -1;
          // An operation atom scopes the other: the term compares, within that operation,
          // problems with the other atom against problems without it.
          else if (scopeA) values[i] = x === 1 ? y : -1;
          else if (scopeB) values[i] = y === 1 ? x : -1;
          else values[i] = x & y;
        }
        consider(makeTerm([...pa.atomIds, ...pb.atomIds], values));
      }
  }
  blindSpots.sort((x, y) => x.moreTrialsNeeded - y.moreTrialsNeeded);
  return { terms: kept, blindSpots };
}
