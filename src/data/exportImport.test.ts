import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeSession, makeSnapshot, makeTrial } from '../test/fixtures';
import { openDb } from './db';
import { exportAll, importExport, parseExport } from './exportImport';
import { getAllSessions, getAllTrials, saveRound } from './log';

const freshDb = () => openDb(`test-${crypto.randomUUID()}`);

async function seeded() {
  const db = await freshDb();
  await saveRound(db, makeSnapshot(), makeSession(), [
    makeTrial(),
    makeTrial({ id: '01923cfb-fc00-7000-8000-000000000002', indexInSession: 1 }),
  ]);
  return db;
}

function parsed(text: string) {
  const result = parseExport(text);
  if (!result.ok) throw new Error(result.reason);
  return result.file;
}

describe('export then import', () => {
  it('round-trips every store losslessly', async () => {
    const source = await seeded();
    const text = JSON.stringify(await exportAll(source, { durationS: 60 }, 1727600999000));
    const target = await freshDb();
    const counts = await importExport(target, parsed(text));
    expect(counts).toEqual({ trials: 2, sessions: 1, paramSnapshots: 1 });
    expect(await getAllTrials(target)).toEqual(await getAllTrials(source));
    expect(await getAllSessions(target)).toEqual(await getAllSessions(source));
  });

  it('is idempotent: importing the same file twice adds nothing the second time', async () => {
    const text = JSON.stringify(await exportAll(await seeded(), null, 0));
    const target = await freshDb();
    await importExport(target, parsed(text));
    expect(await importExport(target, parsed(text))).toEqual({ trials: 0, sessions: 0, paramSnapshots: 0 });
    expect(await getAllTrials(target)).toHaveLength(2);
  });

  it('keeps the existing record when an imported id is already present', async () => {
    const target = await seeded();
    const file = parsed(JSON.stringify(await exportAll(target, null, 0)));
    file.trials[0] = { ...file.trials[0]!, answer: 999 };
    await importExport(target, file);
    expect((await getAllTrials(target))[0]!.answer).toBe(5);
  });

  it('carries the settings it was given', async () => {
    const file = await exportAll(await freshDb(), { durationS: 60 }, 5);
    expect(file.settings).toEqual({ durationS: 60 });
    expect(file.exportedAt).toBe(5);
  });
});

describe('parseExport rejects the whole file', () => {
  const valid = {
    format: 'alphazetamac-export',
    formatVersion: 1,
    exportedAt: 0,
    settings: null,
    trials: [makeTrial()],
    sessions: [makeSession()],
    paramSnapshots: [makeSnapshot()],
  };
  const reason = (x: unknown) => {
    const r = parseExport(typeof x === 'string' ? x : JSON.stringify(x));
    return r.ok ? 'accepted' : r.reason;
  };

  it('accepts a valid file', () => {
    expect(reason(valid)).toBe('accepted');
  });

  it.each([
    ['text that is not JSON', 'not json', 'The file is not valid JSON.'],
    ['another format', { ...valid, format: 'zetamac' }, 'The file is not an AlphaZetaMac export.'],
    ['a newer format version', { ...valid, formatVersion: 2 }, 'Export format version 2 is not supported.'],
    ['missing arrays', { ...valid, sessions: undefined }, 'The file is missing trials, sessions or parameter snapshots.'],
    [
      'one bad trial',
      { ...valid, trials: [makeTrial(), { ...makeTrial(), mode: 'bogus' }] },
      'Trial 1 is invalid: trial does not match the current schema.',
    ],
    ['one bad session', { ...valid, sessions: [{ id: 'x' }] }, 'Session 0 is invalid.'],
    ['one bad snapshot', { ...valid, paramSnapshots: [{ id: 'x' }] }, 'Parameter snapshot 0 is invalid.'],
  ])('given %s', (_, input, expected) => {
    expect(reason(input)).toBe(expected);
  });
});
