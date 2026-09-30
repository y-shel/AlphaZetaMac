import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../data/settings';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { ParamSnapshot, Trial } from '../../domain/types';
import { respond, typicalUser } from '../../engine/__sim__/simUser';
import { TEST_TAB_ITEMS, TEST_TAB_MIN_ITEMS } from '../../engine/constants';
import { logTime, type Obs } from '../../engine/features';
import { testSpace } from '../../engine/select/dOptimal';
import { roundObservations, TestSelector, testController } from './testMode';

describe('TestSelector', () => {
  it('draws only enabled operations, inside the test space', () => {
    const params = defaultParams();
    const selector = new TestSelector({ ...params, enabled: { ...params.enabled, mul: false, div: false } }, createRng(1));
    for (let i = 0; i < 50; i++) {
      const p = selector.next();
      expect(['add', 'sub']).toContain(p.opId);
      selector.prepare([]);
    }
    expect(selector.opIds).toEqual(['add', 'sub']);
    expect(selector.space.ranges.addA).toEqual([2, 300]);
  });

  it('works without prepare, choosing on the spot', () => {
    const selector = new TestSelector(defaultParams(), createRng(2));
    expect(() => {
      selector.next();
      selector.next();
    }).not.toThrow();
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const s = new TestSelector(defaultParams(), createRng(3));
      return Array.from({ length: 10 }, () => {
        s.prepare([]);
        return s.next();
      });
    };
    expect(run()).toEqual(run());
  });

  it('keeps going until the answers make it stop, then reports why', () => {
    const selector = new TestSelector(defaultParams(), createRng(4));
    const rng = createRng(5);
    const user = typicalUser({ sigma: 0.1, sessionSd: 0, lapseRate: 0 });
    const obs: Obs[] = [];
    selector.prepare(obs);
    while (selector.progress === 'continue') {
      const problem = selector.next();
      obs.push({ problem, y: logTime(respond(user, problem, 0, rng).firstKeyMs), sessionId: 's' });
      selector.prepare(obs);
    }
    expect(obs.length).toBeGreaterThanOrEqual(TEST_TAB_MIN_ITEMS);
    expect(obs.length).toBeLessThanOrEqual(TEST_TAB_ITEMS);
    expect(selector.progress).toBe('converged');
  });
});

describe('testController', () => {
  it('counts items in the banner, has no deadline, and writes test trials', async () => {
    let n = 0;
    const saved: Trial[] = [];
    const c = testController(
      defaultSettings(),
      (_snapshot, session, trials) => {
        expect(session).toMatchObject({ mode: 'test', durationS: null });
        saved.push(...trials);
        return Promise.resolve();
      },
      { startedAt: 1000, epochOffset: 1_727_600_000_000, seed: 7, newId: () => `id-${n++}` },
    );
    expect(c.deadline).toBe(Infinity);
    expect(c.status(0)).toBe(`1 / ${TEST_TAB_ITEMS}`);
    expect(c.over(0)).toBe(false);
    let t = 2000;
    for (const k of String(c.round.problem.answer)) c.round.key(k, (t += 300));
    c.afterComplete?.();
    expect(c.status(0)).toBe(`2 / ${TEST_TAB_ITEMS}`);
    expect(c.observations()).toHaveLength(1);
    await c.writer.flush(t);
    expect(saved.map((tr) => tr.mode)).toEqual(['test']);
  });

  it("stores the user's own params as the snapshot, from which the test space can be rebuilt", async () => {
    const settings = defaultSettings();
    const snapshots: ParamSnapshot[] = [];
    const c = testController(
      settings,
      (snapshot) => {
        snapshots.push(snapshot);
        return Promise.resolve();
      },
      { startedAt: 0, epochOffset: 0, seed: 9, newId: () => 'x' },
    );
    let t = 1000;
    for (const k of String(c.round.problem.answer)) c.round.key(k, (t += 300));
    await c.writer.flush(t);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.params).toEqual(settings.params);
    expect(testSpace(snapshots[0]!.params)).toEqual(c.selector.space);
  });
});

describe('roundObservations', () => {
  it('uses the first keystroke time of each completed problem', () => {
    const c = testController(defaultSettings(), null, { startedAt: 0, epochOffset: 0, seed: 8, newId: () => 'x' });
    const answer = String(c.round.problem.answer);
    c.round.key(answer.startsWith('1') ? '2' : '1', 700);
    c.round.key('Backspace', 800);
    let t = 900;
    for (const k of answer) c.round.key(k, (t += 100));
    expect(roundObservations(c.round, 's')).toEqual([{ problem: c.round.completed[0]!.problem, y: logTime(700), sessionId: 's' }]);
  });
});
