import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { analyse } from '../engine/analyse';
import { defaultParams } from '../domain/operations/registry';
import { simulateTrials, typicalUser } from '../engine/__sim__/simUser';
import { simSessions } from '../engine/__sim__/simSessions';
import { clearDerived, loadAnalysis, saveAnalysis } from './analysisStore';
import { openDb } from './db';
import { makeSession, makeSnapshot, makeTrial } from '../test/fixtures';
import { saveRound } from './log';

function snapshotWithFinding() {
  const params = defaultParams();
  const { trials } = simulateTrials(typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.3 } }), { params, sessions: 10, trialsPerSession: 100, seed: 5 });
  return analyse({ trials, sessions: simSessions(trials, params) });
}

describe('analysis store', () => {
  it('saves and loads the latest snapshot, with its findings in their own store', async () => {
    const db = await openDb(`test-${crypto.randomUUID()}`);
    const snap = snapshotWithFinding();
    expect(snap.findings.length).toBeGreaterThan(0);
    await saveAnalysis(db, snap);
    expect(await loadAnalysis(db)).toEqual(snap);
    expect((await db.getAll('findings')).map((f) => f.id)).toEqual(snap.findings.map((f) => f.id).sort());
    await saveAnalysis(db, { ...snap, findings: [] });
    expect(await db.getAll('findings')).toEqual([]);
  });

  it('clears derived data and leaves the log alone', async () => {
    const db = await openDb(`test-${crypto.randomUUID()}`);
    await saveRound(db, makeSnapshot(), makeSession(), [makeTrial()]);
    await saveAnalysis(db, snapshotWithFinding());
    await clearDerived(db);
    expect(await loadAnalysis(db)).toBeNull();
    expect(await db.getAll('findings')).toEqual([]);
    expect(await db.count('trials')).toBe(1);
  });

  it('ignores a snapshot from another analysis version', async () => {
    const db = await openDb(`test-${crypto.randomUUID()}`);
    const snap = snapshotWithFinding();
    await db.put('modelSnapshots', { id: 'latest', computedAt: 0, snapshot: { ...snap, version: 0 as unknown as 1 } });
    expect(await loadAnalysis(db)).toBeNull();
  });
});

describe('database upgrade to version 2', () => {
  it('keeps the log and adds the derived stores', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('trials', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('paramSnapshots', { keyPath: 'id' });
      },
    });
    await v1.put('trials', makeTrial());
    v1.close();
    const db = await openDb(name);
    expect(db.version).toBe(2);
    expect(await db.count('trials')).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(['findings', 'modelSnapshots', 'paramSnapshots', 'sessions', 'trials']);
  });

  it('tells the app when it closes for a newer version', async () => {
    const name = `test-${crypto.randomUUID()}`;
    let told = false;
    await openDb(name, { onBlocking: () => (told = true) });
    const next = await openDB(name, 3);
    expect(told).toBe(true);
    next.close();
  });
});
