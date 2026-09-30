import { describe, expect, it } from 'vitest';
import type { Atom, AtomContext } from '../../domain/atoms/types';
import type { Problem } from '../../domain/types';
import { makeTrial } from '../../test/fixtures';
import { atomContexts, buildTerms, roundContexts } from './terms';

const p = (opId: string, a: number, b: number, answer: number): Problem => ({ opId, operands: [a, b], answer });
const ctx = (problem: Problem): AtomContext => ({ problem, prev: null, indexInSession: 0, roundLength: 1 });

/** A small registry: an operation scope, two plain atoms, and one that applies to add only. */
const isAdd: Atom = { id: 'op_add', label: 'is addition', family: 'operation', applies: ({ problem }) => problem.opId === 'add' };
const isMul: Atom = { id: 'op_mul', label: 'is multiplication', family: 'operation', applies: ({ problem }) => problem.opId === 'mul' };
const big: Atom = { id: 'big', label: 'is big', family: 'test', applies: ({ problem }) => problem.answer >= 50 };
const odd: Atom = { id: 'odd', label: 'is odd', family: 'test', applies: ({ problem }) => problem.answer % 2 === 1 };
const addOnly: Atom = {
  id: 'add_only',
  label: 'is an addition with an answer divisible by 4',
  family: 'test',
  applies: ({ problem }) => (problem.opId === 'add' ? problem.answer % 4 === 0 : null),
};

/** 200 problems with answer i: additions at even i, multiplications at odd i. */
function contexts(): AtomContext[] {
  return Array.from({ length: 200 }, (_, i) => ctx(p(i % 2 === 0 ? 'add' : 'mul', i, 1, i)));
}

describe('buildTerms', () => {
  it('keeps atoms inside the prevalence rule and conjunctions of kept atoms', () => {
    const { terms } = buildTerms(contexts(), [big, odd]);
    expect(terms.map((t) => t.id)).toEqual(['big', 'odd', 'big&odd']);
  });

  it('drops an atom outside 15 to 85 percent', () => {
    const rare: Atom = { id: 'rare', label: 'is rare', family: 'test', applies: ({ problem }) => problem.answer < 10 };
    expect(buildTerms(contexts(), [rare, big]).terms.map((t) => t.id)).toEqual(['big']);
  });

  it('measures prevalence over applicable problems only', () => {
    const { terms } = buildTerms(contexts(), [addOnly]);
    expect(terms[0]!.nApplicable).toBe(100);
    expect(terms[0]!.prevalence).toBeCloseTo(0.5, 12);
  });

  it('scopes a conjunction with an operation atom to that operation', () => {
    const { terms } = buildTerms(contexts(), [isAdd, isMul, big]);
    const scoped = terms.find((t) => t.id === 'big&op_add')!;
    expect(scoped.nApplicable).toBe(100);
    for (let i = 0; i < 200; i++) expect(scoped.values[i]).toBe(i % 2 === 0 ? (i >= 50 ? 1 : 0) : -1);
    // Two operation atoms never combine.
    expect(terms.some((t) => t.id === 'op_add&op_mul')).toBe(false);
  });

  it('drops a term identical to one already kept', () => {
    const same: Atom = { id: 'same', label: 'is big too', family: 'test', applies: ({ problem }) => problem.answer >= 50 };
    expect(buildTerms(contexts(), [big, same]).terms.map((t) => t.id)).toEqual(['big']);
  });

  it('lists a term short only of positive trials as a blind spot, with the trials it needs', () => {
    const few = contexts().slice(0, 40);
    const { terms, blindSpots } = buildTerms(few, [odd]);
    expect(terms).toEqual([]);
    expect(blindSpots.map((b) => b.id)).toEqual(['odd']);
    // 20 of 40 are odd and 30 are needed: 10 more at one in two is 20 more trials.
    expect(blindSpots[0]!.moreTrialsNeeded).toBe(20);
  });
});

describe('atomContexts', () => {
  it('finds the previous trial and the round length', () => {
    const a = makeTrial({ id: 'a', sessionId: 's', indexInSession: 0 });
    const b = makeTrial({ id: 'b', sessionId: 's', indexInSession: 1, prevTrialId: 'a' });
    const [ca, cb] = atomContexts([a, b], [a, b]);
    expect(ca!.prev).toBeNull();
    expect(cb!.prev).toBe(a);
    expect(cb!.roundLength).toBe(2);
  });
});

describe('roundContexts', () => {
  it('chains problems as one round', () => {
    const cs = roundContexts([p('add', 1, 2, 3), p('mul', 2, 3, 6)]);
    expect(cs[0]!.prev).toBeNull();
    expect(cs[1]!.prev?.opId).toBe('add');
    expect(cs.map((c) => [c.indexInSession, c.roundLength])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
});
