import type { ParamSnapshot, Session, Trial } from '../domain/types';
import type { AzmDb } from './db';
import { upgradeTrial } from './migrations';

/**
 * Writes a snapshot, a session and new trials in one transaction, so a flush is saved
 * whole or not at all. Trials use add, not put: the log is append-only, and writing the
 * same trial id twice is a bug that should fail loudly.
 */
export async function saveRound(
  db: AzmDb,
  snapshot: ParamSnapshot,
  session: Session,
  trials: readonly Trial[],
): Promise<void> {
  const tx = db.transaction(['paramSnapshots', 'sessions', 'trials'], 'readwrite');
  const trialStore = tx.objectStore('trials');
  await Promise.all([
    tx.objectStore('paramSnapshots').put(snapshot),
    tx.objectStore('sessions').put(session),
    ...trials.map((t) => trialStore.add(t)),
    tx.done,
  ]);
}

/** Every trial, oldest first (UUIDv7 keys sort by time), upgraded to the current schema. */
export async function getAllTrials(db: AzmDb): Promise<Trial[]> {
  const raw: unknown[] = await db.getAll('trials');
  return raw.map((t) => upgradeTrial(t));
}

export function getAllSessions(db: AzmDb): Promise<Session[]> {
  return db.getAll('sessions');
}

export function getAllParamSnapshots(db: AzmDb): Promise<ParamSnapshot[]> {
  return db.getAll('paramSnapshots');
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}
