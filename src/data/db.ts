import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ParamSnapshot, Session, Trial } from '../domain/types';

export const DB_NAME = 'alphazetamac';
export const DB_VERSION = 1;

interface AzmSchema extends DBSchema {
  trials: {
    key: string;
    value: Trial;
    indexes: { sessionId: string; completedAt: number; mode: string };
  };
  sessions: { key: string; value: Session; indexes: { startedAt: number } };
  paramSnapshots: { key: string; value: ParamSnapshot };
}

export type AzmDb = IDBPDatabase<AzmSchema>;

/** Stores that hold the log. Derived stores arrive in later plans and are not exported. */
export const LOG_STORES = ['trials', 'sessions', 'paramSnapshots'] as const;

export function openDb(name: string = DB_NAME): Promise<AzmDb> {
  return openDB<AzmSchema>(name, DB_VERSION, {
    // Release this connection when a newer version wants to upgrade, or the upgrade waits
    // forever behind an old tab.
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
    },
    upgrade(db) {
      const trials = db.createObjectStore('trials', { keyPath: 'id' });
      trials.createIndex('sessionId', 'sessionId');
      trials.createIndex('completedAt', 'completedAt');
      trials.createIndex('mode', 'mode');
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('startedAt', 'startedAt');
      db.createObjectStore('paramSnapshots', { keyPath: 'id' });
    },
  });
}
