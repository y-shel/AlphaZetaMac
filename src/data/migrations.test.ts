import { describe, expect, it } from 'vitest';
import { makeTrial } from '../test/fixtures';
import { upgradeTrial, type Migration } from './migrations';

describe('upgradeTrial', () => {
  it('returns a current-version trial unchanged', () => {
    const trial = makeTrial();
    expect(upgradeTrial(trial)).toEqual(trial);
  });

  it('applies migrations in order and bumps schemaVersion', () => {
    const addNote: Migration = (t) => ({ ...t, note: 'v2' });
    const upgraded = upgradeTrial(makeTrial(), [addNote], 2);
    expect(upgraded.schemaVersion).toBe(2);
    expect((upgraded as unknown as { note: string }).note).toBe('v2');
  });

  it('rejects a trial from a newer schema', () => {
    expect(() => upgradeTrial({ ...makeTrial(), schemaVersion: 2 })).toThrow('unsupported trial schemaVersion 2');
  });

  it('rejects a trial with no schemaVersion', () => {
    expect(() => upgradeTrial({ id: 'x' })).toThrow('no schemaVersion');
  });

  it('rejects when a migration is missing', () => {
    expect(() => upgradeTrial(makeTrial(), [], 2)).toThrow('no migration from trial schemaVersion 1');
  });

  it('rejects a trial that is still invalid after migrating', () => {
    const breakIt: Migration = (t) => ({ ...t, mode: 'bogus' });
    expect(() => upgradeTrial(makeTrial(), [breakIt], 2)).toThrow('does not match the current schema');
  });
});
