import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeSession, makeSnapshot, makeTrial } from '../test/fixtures';
import { openDb } from './db';
import { exportAll, importExport, parseExport } from './exportImport';
import { getAllExperiments, getAllSessions, getAllTrials, saveExperiment, saveRound } from './log';

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
    expect(counts).toEqual({ trials: 2, sessions: 1, paramSnapshots: 1, experiments: 0 });
    expect(await getAllTrials(target)).toEqual(await getAllTrials(source));
    expect(await getAllSessions(target)).toEqual(await getAllSessions(source));
  });

  it('is idempotent: importing the same file twice adds nothing the second time', async () => {
    const text = JSON.stringify(await exportAll(await seeded(), null, 0));
    const target = await freshDb();
    await importExport(target, parsed(text));
    expect(await importExport(target, parsed(text))).toEqual({ trials: 0, sessions: 0, paramSnapshots: 0, experiments: 0 });
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
    formatVersion: 2,
    exportedAt: 0,
    settings: null,
    trials: [makeTrial()],
    sessions: [makeSession()],
    paramSnapshots: [makeSnapshot()],
    experiments: [{ id: 'e1', terms: ['contains_8'], createdAt: 1 }],
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
    ['a newer format version', { ...valid, formatVersion: 3 }, 'Export format version 3 is not supported.'],
    ['missing arrays', { ...valid, sessions: undefined }, 'The file is missing trials, sessions or parameter snapshots.'],
    [
      'one bad trial',
      { ...valid, trials: [makeTrial(), { ...makeTrial(), mode: 'bogus' }] },
      'Trial 1 is invalid: trial does not match the current schema.',
    ],
    ['one bad session', { ...valid, sessions: [{ id: 'x' }] }, 'Session 0 is invalid.'],
    ['one bad experiment', { ...valid, experiments: [valid.experiments[0], { id: 'e2', terms: [], createdAt: 1 }] }, 'Experiment 1 is invalid.'],
    ['experiments that are not an array', { ...valid, experiments: 'x' }, 'The file is missing experiments.'],
    ['one bad snapshot', { ...valid, paramSnapshots: [{ id: 'x' }] }, 'Parameter snapshot 0 is invalid.'],
  ])('given %s', (_, input, expected) => {
    expect(reason(input)).toBe(expected);
  });
});

describe('experiments in the export', () => {
  const experiment = { id: 'e1', terms: ['contains_8'], createdAt: 7 };

  it('round-trips experiments', async () => {
    const source = await seeded();
    await saveExperiment(source, experiment);
    const file = await exportAll(source, null, 0);
    expect(file.formatVersion).toBe(2);
    expect(file.experiments).toEqual([experiment]);
    const target = await freshDb();
    const counts = await importExport(target, parsed(JSON.stringify(file)));
    expect(counts.experiments).toBe(1);
    expect(await getAllExperiments(target)).toEqual([experiment]);
  });

  it('adds no experiment when the same file is imported twice', async () => {
    const source = await freshDb();
    await saveExperiment(source, experiment);
    const text = JSON.stringify(await exportAll(source, null, 0));
    const target = await freshDb();
    await importExport(target, parsed(text));
    expect((await importExport(target, parsed(text))).experiments).toBe(0);
    expect(await getAllExperiments(target)).toHaveLength(1);
  });

  it('imports a version 1 file with no experiments', async () => {
    const source = await seeded();
    const v1 = JSON.stringify({ ...(await exportAll(source, null, 0)), formatVersion: 1, experiments: undefined });
    const file = parsed(v1);
    expect(file.experiments).toEqual([]);
    const target = await freshDb();
    const counts = await importExport(target, file);
    expect(counts).toEqual({ trials: 2, sessions: 1, paramSnapshots: 1, experiments: 0 });
  });
});
