import type { ParamSnapshot, Session, Trial } from '../domain/types';
import type { AzmDb } from './db';
import { upgradeTrial } from './migrations';
import { isParamSnapshot, isSession, isTrial } from './validate';

/**
 * Writes a snapshot, a session and new trials in one transaction, so a flush is saved
 * whole or not at all. Trials use add, not put: the log is append-only, and writing the
 * same trial id twice is a bug that should fail loudly. Rows are validated first, because
 * one bad row would make getAllTrials throw for the whole log.
 */
export async function saveRound(
  db: AzmDb,
  snapshot: ParamSnapshot,
  session: Session,
  trials: readonly Trial[],
): Promise<void> {
  if (!isParamSnapshot(snapshot)) throw new Error('refusing to save an invalid snapshot');
  if (!isSession(session)) throw new Error('refusing to save an invalid session');
  trials.forEach((t, i) => {
    if (!isTrial(t)) throw new Error(`refusing to save an invalid trial at index ${i}`);
  });
  const tx = db.transaction(['paramSnapshots', 'sessions', 'trials'], 'readwrite');
  const trialStore = tx.objectStore('trials');
  try {
    await Promise.all([
      tx.objectStore('paramSnapshots').put(snapshot),
      tx.objectStore('sessions').put(session),
      ...trials.map((t) => trialStore.add(t)),
      tx.done,
    ]);
  } catch (e) {
    // An aborted transaction can reject a request with a bare AbortError.
    // The transaction's own error is the real cause, such as QuotaExceededError.
    throw tx.error ?? e;
  }
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
