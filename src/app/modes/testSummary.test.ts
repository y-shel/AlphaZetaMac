import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../../engine/__sim__/simUser';
import { observations } from '../../engine/features';
import { levelSentence, summariseTest } from './testSummary';

describe('summariseTest', () => {
  it('gives a typical time per operation and suggested settings', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 100, seed: 1, mode: 'test' });
    const summary = summariseTest(observations(sim.trials), defaultParams(), 120);
    if (summary.kind !== 'ok') throw new Error('expected a summary');
    expect(summary.typicalMs.map((t) => t.opId)).toEqual(['add', 'sub', 'mul', 'div']);
    for (const { ms } of summary.typicalMs) {
      expect(ms).toBeGreaterThan(500);
      expect(ms).toBeLessThan(10_000);
    }
    expect(summary.suggested.enabled).toEqual(defaultParams().enabled);
  });

  it('reports insufficient data for too few answers', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 5, seed: 2, mode: 'test' });
    expect(summariseTest(observations(sim.trials), defaultParams(), 120).kind).toBe('insufficient-data');
  });
});

describe('levelSentence', () => {
  it('claims no more than this test measured', () => {
    expect(levelSentence('converged')).toBe('Your level is measured.');
    expect(levelSentence('limit')).toBe('Your level is roughly measured from this test.');
  });
});

describe('summariseTest: standing and first-pass diagnosis', () => {
  it('bands each operation and shows at most three slow-side atoms', () => {
    const user = typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.4 }, lapseRate: 0 });
    const sim = simulateTrials(user, { params: defaultParams(), sessions: 1, trialsPerSession: 100, seed: 2, mode: 'test' });
    const summary = summariseTest(observations(sim.trials), defaultParams(), 120);
    if (summary.kind !== 'ok') throw new Error('expected a summary');
    expect(summary.standing!.operations.map((o) => o.opId)).toEqual(['add', 'sub', 'mul', 'div']);
    expect(summary.diagnosis.length).toBeLessThanOrEqual(3);
    expect(summary.diagnosis.map((o) => o.termId)).toContain('contains_8');
    for (const o of summary.diagnosis) expect(o.effectLogT).toBeGreaterThanOrEqual(0.05);
  });
});

describe('summariseTest: an operation that was not fitted', () => {
  it('summarises the fitted operations when every division answer starts too late to count', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 100, seed: 1, mode: 'test' });
    // Every division answer starts after LAPSE_MAX_MS (15 s), so division has no usable answers.
    const trials = sim.trials.map((t) => (t.opId === 'div' ? { ...t, keystrokes: t.keystrokes.map((k) => ({ ...k, t: k.t + 16_000 })) } : t));
    expect(trials.some((t) => t.opId === 'div')).toBe(true);
    const summary = summariseTest(observations(trials), defaultParams(), 120);
    if (summary.kind !== 'ok') throw new Error('expected a summary');
    expect(summary.typicalMs.map((t) => t.opId)).toEqual(['add', 'sub', 'mul']);
    expect(summary.standing!.operations.map((o) => o.opId)).toEqual(['add', 'sub', 'mul']);
    for (const o of summary.diagnosis) expect(Number.isFinite(o.effectLogT)).toBe(true);
  });

  it('summarises the fitted operations when one operation has only a handful of answers', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: 100, seed: 3, mode: 'test' });
    let kept = 0;
    const trials = sim.trials.filter((t) => t.opId !== 'add' || kept++ < 4);
    expect(trials.filter((t) => t.opId === 'add')).toHaveLength(4);
    const summary = summariseTest(observations(trials), defaultParams(), 120);
    if (summary.kind !== 'ok') throw new Error('expected a summary');
    expect(summary.typicalMs.map((t) => t.opId)).toEqual(['sub', 'mul', 'div']);
    expect(summary.standing!.operations.map((o) => o.opId)).toEqual(['sub', 'mul', 'div']);
  });
});
