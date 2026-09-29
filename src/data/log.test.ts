import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeSession, makeSnapshot, makeTrial } from '../test/fixtures';
import type { Session, Trial } from '../domain/types';
import { openDb } from './db';
import { getAllParamSnapshots, getAllSessions, getAllTrials, isQuotaError, saveRound } from './log';

const freshDb = () => openDb(`test-${crypto.randomUUID()}`);

describe('saveRound', () => {
  it('stores the snapshot, the session and the trials', async () => {
    const db = await freshDb();
    await saveRound(db, makeSnapshot(), makeSession(), [makeTrial()]);
    expect(await getAllTrials(db)).toEqual([makeTrial()]);
    expect(await getAllSessions(db)).toEqual([makeSession()]);
    expect(await getAllParamSnapshots(db)).toEqual([makeSnapshot()]);
  });

  it('refuses to write the same trial twice, and writes nothing from the failed call', async () => {
    const db = await freshDb();
    await saveRound(db, makeSnapshot(), makeSession(), [makeTrial()]);
    const later = makeSession({ id: 'session-2' });
    await expect(saveRound(db, makeSnapshot(), later, [makeTrial()])).rejects.toMatchObject({
      name: 'ConstraintError',
    });
    expect(await getAllTrials(db)).toHaveLength(1);
    expect((await getAllSessions(db)).map((s) => s.id)).toEqual(['session-1']);
  });

  it('refuses an invalid trial and writes nothing', async () => {
    const db = await freshDb();
    const bad = { ...makeTrial(), mode: 'bogus' } as unknown as Trial;
    await expect(saveRound(db, makeSnapshot(), makeSession(), [bad])).rejects.toThrow(
      'refusing to save an invalid trial at index 0',
    );
    expect(await db.getAll('trials')).toHaveLength(0);
    expect(await getAllSessions(db)).toHaveLength(0);
    expect(await getAllParamSnapshots(db)).toHaveLength(0);
  });

  it('refuses an invalid session and writes nothing', async () => {
    const db = await freshDb();
    const bad = { ...makeSession(), mode: 'bogus' } as unknown as Session;
    await expect(saveRound(db, makeSnapshot(), bad, [makeTrial()])).rejects.toThrow(
      'refusing to save an invalid session',
    );
    expect(await db.getAll('trials')).toHaveLength(0);
    expect(await getAllSessions(db)).toHaveLength(0);
  });

  it('updates the session when a round is flushed again', async () => {
    const db = await freshDb();
    await saveRound(db, makeSnapshot(), makeSession({ score: 1 }), [makeTrial()]);
    await saveRound(db, makeSnapshot(), makeSession({ score: 2, endedAt: 1727600120000 }), [
      makeTrial({ id: '01923cfb-fc00-7000-8000-000000000002', indexInSession: 1 }),
    ]);
    expect(await getAllSessions(db)).toEqual([makeSession({ score: 2, endedAt: 1727600120000 })]);
  });

  it('returns trials oldest first, whatever order they were written in', async () => {
    const db = await freshDb();
    const later = makeTrial({ id: '01923cfb-fc01-7000-8000-000000000000' });
    const earlier = makeTrial({ id: '01923cfb-fc00-7000-8000-000000000000' });
    await saveRound(db, makeSnapshot(), makeSession(), [later, earlier]);
    expect((await getAllTrials(db)).map((t) => t.id)).toEqual([earlier.id, later.id]);
  });

  it('indexes trials by mode', async () => {
    const db = await freshDb();
    await saveRound(db, makeSnapshot(), makeSession(), [makeTrial()]);
    expect(await db.getAllFromIndex('trials', 'mode', 'normal')).toHaveLength(1);
    expect(await db.getAllFromIndex('trials', 'mode', 'train')).toHaveLength(0);
  });
});

describe('isQuotaError', () => {
  it('recognises QuotaExceededError and nothing else', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new DOMException('dup', 'ConstraintError'))).toBe(false);
    expect(isQuotaError(new Error('QuotaExceededError'))).toBe(false);
  });
});
