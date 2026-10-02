import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';

describe('openDb', () => {
  it('lets a newer version upgrade while an older connection is open', async () => {
    const name = `test-${crypto.randomUUID()}`;
    await openDb(name);
    const next = await openDB(name, 4);
    expect(next.version).toBe(4);
    next.close();
  });
});
