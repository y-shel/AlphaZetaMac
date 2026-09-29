import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { paramsSnapshotId } from '../../domain/params';
import type { ParamSnapshot, Problem, Session, Trial } from '../../domain/types';
import { Round } from '../drill/round';
import { SessionWriter, type SaveRound, type SessionSpec } from './sessionWriter';

const onePlusOne: Problem = { opId: 'add', operands: [1, 1], answer: 2 };
const TIME_ORIGIN = 1_727_600_000_000;

interface Saved {
  snapshot: ParamSnapshot;
  session: Session;
  trials: Trial[];
}

const NORMAL: SessionSpec = { sessionMode: 'normal', trialMode: 'normal', durationS: 120 };

function setup(options: { failNext?: boolean; spec?: SessionSpec } = {}) {
  const saved: Saved[] = [];
  let failNext = options.failNext ?? false;
  const save: SaveRound = (snapshot, session, trials) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new DOMException('full', 'QuotaExceededError'));
    }
    saved.push({ snapshot, session, trials: [...trials] });
    return Promise.resolve();
  };
  let n = 0;
  const round = new Round(() => onePlusOne, 0);
  const session = new SessionWriter(round, defaultParams(), options.spec ?? NORMAL, 0, {
    sessionId: 'session-1',
    save,
    timeOrigin: TIME_ORIGIN,
    newId: () => `trial-${n++}`,
  });
  let clock = 0;
  const answer = (count: number) => {
    for (let i = 0; i < count; i++) round.key('2', (clock += 500));
  };
  return { saved, session, answer, allTrials: () => saved.flatMap((s) => s.trials) };
}

describe('SessionWriter', () => {
  it('writes every trial tagged normal, with the final score and end time', async () => {
    const { saved, session, answer } = setup();
    answer(3);
    await session.flush(90_000);
    expect(saved).toHaveLength(1);
    const [{ snapshot, session: s, trials }] = saved as [Saved];
    expect(trials.map((t) => t.mode)).toEqual(['normal', 'normal', 'normal']);
    expect(trials.map((t) => t.indexInSession)).toEqual([0, 1, 2]);
    expect(trials.map((t) => t.prevTrialId)).toEqual([null, 'trial-0', 'trial-1']);
    expect(snapshot).toEqual({ id: paramsSnapshotId(defaultParams()), params: defaultParams() });
    expect(s).toEqual({
      id: 'session-1',
      mode: 'normal',
      paramsSnapshotId: snapshot.id,
      durationS: 120,
      startedAt: TIME_ORIGIN,
      endedAt: TIME_ORIGIN + 90_000,
      score: 3,
    });
  });

  it('writes each trial exactly once across a mid-round flush and the final flush', async () => {
    const { saved, session, answer, allTrials } = setup();
    answer(2);
    await session.flush();
    expect(saved[0]!.session.endedAt).toBeNull();
    expect(saved[0]!.session.score).toBe(2);
    answer(2);
    await session.flush(120_000);
    expect(allTrials().map((t) => t.id)).toEqual(['trial-0', 'trial-1', 'trial-2', 'trial-3']);
    expect(allTrials()[2]!.prevTrialId).toBe('trial-1');
    expect(allTrials()[2]!.indexInSession).toBe(2);
  });

  it('does not duplicate trials when flushes overlap', async () => {
    const { session, answer, allTrials } = setup();
    answer(3);
    await Promise.all([session.flush(), session.flush(120_000)]);
    expect(allTrials()).toHaveLength(3);
  });

  it('keeps unsaved trials after a failed write, and the next flush saves them', async () => {
    const { session, answer, allTrials } = setup({ failNext: true });
    answer(2);
    await expect(session.flush()).rejects.toThrow('full');
    answer(1);
    await session.flush(120_000);
    expect(allTrials().map((t) => t.indexInSession)).toEqual([0, 1, 2]);
  });

  it('a flush after the round ended keeps the end time', async () => {
    const { saved, session, answer } = setup();
    answer(2);
    await session.flush(90_000);
    await session.flush();
    const last = saved.at(-1)!;
    expect(last.session.endedAt).toBe(TIME_ORIGIN + 90_000);
    expect(last.session.score).toBe(2);
  });

  it('does nothing when storage is unavailable', async () => {
    const round = new Round(() => onePlusOne, 0);
    const session = new SessionWriter(round, defaultParams(), NORMAL, 0, {
      sessionId: 's',
      save: null,
      timeOrigin: 0,
      newId: () => 'x',
    });
    round.key('2', 100);
    await expect(session.flush(120_000)).resolves.toBeUndefined();
  });

  it('writes a test session: trials tagged test, no duration', async () => {
    const { saved, session, answer } = setup({ spec: { sessionMode: 'test', trialMode: 'test', durationS: null } });
    answer(2);
    await session.flush(5_000);
    const [{ session: s, trials }] = saved as [Saved];
    expect(trials.map((t) => t.mode)).toEqual(['test', 'test']);
    expect(s).toMatchObject({ mode: 'test', durationS: null, score: 2, endedAt: TIME_ORIGIN + 5_000 });
  });
});
