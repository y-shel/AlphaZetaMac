import { describe, expect, it } from 'vitest';
import { atomContexts, roundContexts } from '../../domain/atoms/contexts';
import type { AtomContext } from '../../domain/atoms/types';
import { atoms } from '../../domain/atoms/registry';
import { createProblemSource, defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { Trial } from '../../domain/types';
import { makeSession, makeTrial } from '../../test/fixtures';
import { DEFAULT_ROUND_SAMPLES, DEFAULT_ROUND_SECONDS, RECENT_NORMAL_SESSIONS } from '../constants';
import { medianGapMs, referenceRound, sampleProblems, termPrevalence, typingGapMs } from './reference';

/** A trial whose keys land at the given times. */
function typed(times: readonly number[]): Trial {
  return makeTrial({ keystrokes: times.map((t) => ({ k: '1', t })) });
}

/** A trial of one session that took `ms` from display to completion. */
function timed(id: string, sessionId: string, ms: number, over: Parameters<typeof makeTrial>[0] = {}): Trial {
  return makeTrial({ id, sessionId, displayedAt: 1000, completedAt: 1000 + ms, ...over });
}

describe('sampleProblems', () => {
  it('is deterministic for a seed', () => {
    expect(sampleProblems(defaultParams(), 7, 50)).toEqual(sampleProblems(defaultParams(), 7, 50));
    expect(sampleProblems(defaultParams(), 7, 50)).not.toEqual(sampleProblems(defaultParams(), 8, 50));
  });

  it('equals drawing count times from createProblemSource with the same seed', () => {
    const next = createProblemSource(defaultParams(), createRng(7));
    const direct = Array.from({ length: 50 }, () => next());
    const sampled = sampleProblems(defaultParams(), 7, 50);
    expect(sampled).toHaveLength(50);
    expect(sampled).toEqual(direct);
  });

  it('draws nothing for a count of 0', () => {
    expect(sampleProblems(defaultParams(), 7, 0)).toEqual([]);
  });
});

describe('medianGapMs', () => {
  it('is 0 for an empty list', () => {
    expect(medianGapMs([])).toBe(0);
  });

  it('takes the upper middle for an even count', () => {
    expect(medianGapMs([100, 200, 300, 400])).toBe(300);
  });

  it('takes the middle for an odd count', () => {
    expect(medianGapMs([100, 200, 300])).toBe(200);
  });

  it('does not depend on input order', () => {
    expect(medianGapMs([400, 100, 300, 200])).toBe(300);
    expect(medianGapMs([300, 400, 200, 100])).toBe(300);
    // Numeric order, not string order.
    expect(medianGapMs([1000, 90, 200])).toBe(200);
  });
});

describe('typingGapMs', () => {
  it('is 0 when no trial has two keystrokes', () => {
    expect(typingGapMs([])).toBe(0);
    expect(typingGapMs([typed([900]), typed([])])).toBe(0);
  });

  it('is the median gap over several trials', () => {
    // Gaps of 100, 300, 200 and 400. The upper middle is 300.
    expect(typingGapMs([typed([1000, 1100, 1400]), typed([500, 700, 1100])])).toBe(300);
    // Gaps of 100, 300 and 200.
    expect(typingGapMs([typed([1000, 1100, 1400]), typed([500, 700])])).toBe(200);
  });
});

describe('referenceRound', () => {
  it('uses only the most recent normal sessions', () => {
    // Seven normal sessions, oldest first, and one newer test session. Session k took k seconds per problem.
    const sessions = [
      ...Array.from({ length: 7 }, (_, k) => makeSession({ id: `s${k}`, startedAt: 1000 * k, durationS: k === 6 ? 60 : 120 })),
      makeSession({ id: 'test', mode: 'test', startedAt: 99000, durationS: null }),
    ];
    const all = [
      ...Array.from({ length: 7 }, (_, k) => [
        timed(`t${k}a`, `s${k}`, 1000 * (k + 1), { operands: [k + 2, 3], answer: k + 5 }),
        timed(`t${k}b`, `s${k}`, 1000 * (k + 1), { operands: [k + 2, 4], answer: k + 6 }),
      ]).flat(),
      timed('tt', 'test', 50000, { mode: 'test' }),
    ];
    const round = referenceRound(sessions, all, all)!;
    expect(RECENT_NORMAL_SESSIONS).toBe(5);
    // roundSeconds comes from the latest normal session.
    expect(round.roundSeconds).toBe(60);
    expect(round.estimated).toBe(false);
    // Sessions s2 to s6 took 3, 4, 5, 6 and 7 seconds per problem.
    expect(round.meanSecondsPerProblem).toBeCloseTo((3 + 4 + 5 + 6 + 7) / 5, 12);
    const recent = all.filter((t) => ['s2', 's3', 's4', 's5', 's6'].includes(t.sessionId));
    expect(round.contexts).toHaveLength(10);
    expect(round.contexts).toEqual(atomContexts(recent, all));
  });

  it('falls back to the default round length when the latest session has none', () => {
    const sessions = [makeSession({ id: 's0', durationS: null })];
    const all = [timed('t0', 's0', 2000)];
    expect(referenceRound(sessions, all, all)!.roundSeconds).toBe(DEFAULT_ROUND_SECONDS);
  });

  it('is a default round, flagged estimated, with no normal sessions but eligible trials', () => {
    const sessions = [makeSession({ id: 'test', mode: 'test', durationS: null })];
    const all = [timed('t0', 'test', 2000, { mode: 'test' }), timed('t1', 'test', 4000, { mode: 'test' })];
    const round = referenceRound(sessions, all, all)!;
    expect(round.estimated).toBe(true);
    expect(round.roundSeconds).toBe(DEFAULT_ROUND_SECONDS);
    expect(DEFAULT_ROUND_SECONDS).toBe(120);
    expect(round.meanSecondsPerProblem).toBeCloseTo(3, 12);
    expect(round.contexts).toHaveLength(DEFAULT_ROUND_SAMPLES);
    expect(round.contexts).toEqual(roundContexts(sampleProblems(defaultParams(), 1, DEFAULT_ROUND_SAMPLES)));
  });

  it('is null with nothing eligible', () => {
    expect(referenceRound([], [], [])).toBeNull();
    const train = [timed('t0', 'tr', 2000, { mode: 'train' })];
    expect(referenceRound([makeSession({ id: 'tr', mode: 'train' })], train, [])).toBeNull();
  });
});

describe('termPrevalence', () => {
  const problems = sampleProblems(defaultParams(), 3, 400);
  const contexts = roundContexts(problems);

  it('is the share of contexts where every atom is true', () => {
    let checked = 0;
    for (const a of atoms) {
      const hits = contexts.filter((c) => a.applies(c) === true).length;
      expect(termPrevalence([a.id], contexts)).toBe(hits / contexts.length);
      for (const b of atoms) {
        const both = contexts.filter((c) => a.applies(c) === true && b.applies(c) === true).length;
        expect(termPrevalence([a.id, b.id], contexts)).toBe(both / contexts.length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // The check above is not all zeros: some atom is true somewhere and not everywhere.
    const shares = atoms.map((a) => termPrevalence([a.id], contexts));
    expect(shares.some((s) => s > 0 && s < 1)).toBe(true);
  });

  it('is 0 for no contexts', () => {
    expect(termPrevalence([atoms[0]!.id], [])).toBe(0);
  });

  it('counts an atom that is not applicable to a context as not true', () => {
    // An atom that is not applicable somewhere answers null there, not false.
    const found = atoms
      .map((a) => ({ a, na: contexts.filter((c: AtomContext) => a.applies(c) === null), yes: contexts.filter((c) => a.applies(c) === true) }))
      .find((x) => x.na.length > 0 && x.yes.length > 0);
    expect(found).toBeDefined();
    const { a, na, yes } = found!;
    expect(termPrevalence([a.id], na)).toBe(0);
    expect(termPrevalence([a.id], [yes[0]!, na[0]!])).toBe(0.5);
  });
});
