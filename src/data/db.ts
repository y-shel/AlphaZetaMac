import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ParamSnapshot, Session, Trial } from '../domain/types';
import type { AnalysisSnapshot } from '../engine/analyse';
import type { Finding } from '../engine/findings/finding';

export const DB_NAME = 'alphazetamac';
export const DB_VERSION = 2;

/** The one analysis snapshot kept, under this key. Derived data is a cache (invariant 2). */
export const LATEST = 'latest';

export interface StoredAnalysis {
  id: typeof LATEST;
  computedAt: number;
  snapshot: AnalysisSnapshot;
}

interface AzmSchema extends DBSchema {
  trials: {
    key: string;
    value: Trial;
    indexes: { sessionId: string; completedAt: number; mode: string };
  };
  sessions: { key: string; value: Session; indexes: { startedAt: number } };
  paramSnapshots: { key: string; value: ParamSnapshot };
  modelSnapshots: { key: string; value: StoredAnalysis; indexes: { computedAt: number } };
  findings: { key: string; value: Finding; indexes: { tier: string; discoveredAt: number } };
}

export type AzmDb = IDBPDatabase<AzmSchema>;

/** Stores that hold the log. Only these are exported. */
export const LOG_STORES = ['trials', 'sessions', 'paramSnapshots'] as const;
/** Stores that hold derived data. Always safe to clear and rebuild. */
export const DERIVED_STORES = ['modelSnapshots', 'findings'] as const;

export interface OpenDbOptions {
  /** Called when another tab needs a newer version and this connection has closed for it. */
  onBlocking?: () => void;
}

export function openDb(name: string = DB_NAME, options: OpenDbOptions = {}): Promise<AzmDb> {
  return openDB<AzmSchema>(name, DB_VERSION, {
    // Release this connection when a newer version wants to upgrade, or the upgrade waits
    // forever behind an old tab. The handle is dead after this, so tell the app.
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      options.onBlocking?.();
    },
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const trials = db.createObjectStore('trials', { keyPath: 'id' });
        trials.createIndex('sessionId', 'sessionId');
        trials.createIndex('completedAt', 'completedAt');
        trials.createIndex('mode', 'mode');
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('startedAt', 'startedAt');
        db.createObjectStore('paramSnapshots', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        const models = db.createObjectStore('modelSnapshots', { keyPath: 'id' });
        models.createIndex('computedAt', 'computedAt');
        const findings = db.createObjectStore('findings', { keyPath: 'id' });
        findings.createIndex('tier', 'tier');
        findings.createIndex('discoveredAt', 'discoveredAt');
      }
    },
  });
}
