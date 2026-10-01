import { describe, expect, it } from 'vitest';
import { makeTrial } from '../../test/fixtures';
import type { Problem } from '../types';
import { atomContexts, roundContexts } from './contexts';

const p = (opId: string, a: number, b: number, answer: number): Problem => ({ opId, operands: [a, b], answer });

describe('atomContexts', () => {
  it('finds the previous trial and the round length', () => {
    const a = makeTrial({ id: 'a', sessionId: 's', indexInSession: 0 });
    const b = makeTrial({ id: 'b', sessionId: 's', indexInSession: 1, prevTrialId: 'a' });
    const [ca, cb] = atomContexts([a, b], [a, b]);
    expect(ca!.prev).toBeNull();
    expect(cb!.prev).toBe(a);
    expect(ca!.roundLength).toBe(2);
    expect(cb!.roundLength).toBe(2);
    expect(cb!.indexInSession).toBe(1);
    expect(cb!.problem).toEqual({ opId: b.opId, operands: b.operands, answer: b.answer });
  });

  it('gives no previous trial when prevTrialId names a trial that is not in all', () => {
    const a = makeTrial({ id: 'a', sessionId: 's', indexInSession: 0 });
    const b = makeTrial({ id: 'b', sessionId: 's', indexInSession: 1, prevTrialId: 'gone' });
    const [, cb] = atomContexts([a, b], [a, b]);
    expect(cb!.prev).toBeNull();
  });
});

describe('roundContexts', () => {
  it('chains problems as one round and numbers them', () => {
    const add = p('add', 1, 2, 3);
    const cs = roundContexts([add, p('mul', 2, 3, 6)]);
    expect(cs[0]!.prev).toBeNull();
    expect(cs[1]!.prev?.opId).toBe('add');
    expect(cs[0]!.problem).toBe(add);
    expect(cs.map((c) => [c.indexInSession, c.roundLength])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('gives an empty list for no problems', () => {
    expect(roundContexts([])).toEqual([]);
  });
});
