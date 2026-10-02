import { TRIAL_SCHEMA_VERSION, type Experiment, type ParamSnapshot, type Session, type Trial } from '../domain/types';
import { LOG_STORES, type AzmDb } from './db';
import { upgradeTrial } from './migrations';
import { isExperiment, isParamSnapshot, isSession, isTrial } from './validate';

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
    if (!isTrial(t) || t.schemaVersion !== TRIAL_SCHEMA_VERSION) throw new Error(`refusing to save an invalid trial at index ${i}`);
  });
  const tx = db.transaction(LOG_STORES, 'readwrite');
  const trialStore = tx.objectStore('trials');
  const pending: Promise<unknown>[] = [];
  try {
    pending.push(tx.done);
    pending.push(tx.objectStore('paramSnapshots').put(snapshot));
    pending.push(tx.objectStore('sessions').put(session));
    for (const t of trials) pending.push(trialStore.add(t));
    await Promise.all(pending);
  } catch (e) {
    // Requests already queued reject after the abort. Nothing awaits them, so mark them handled.
    for (const p of pending) p.catch(() => undefined);
    // An aborted transaction can reject a request with a bare AbortError.
    // The transaction's own error is the real cause, such as QuotaExceededError.
    // A request that throws synchronously leaves queued puts that would auto-commit.
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    throw tx.error ?? e;
  }
}

/** Every trial, oldest first (UUIDv7 keys sort by time), upgraded to the current schema. */
export async function getAllTrials(db: AzmDb): Promise<Trial[]> {
  const raw: unknown[] = await db.getAll('trials');
  return raw.map((t) => upgradeTrial(t));
}

/** Stores an experiment definition. Add, never overwrite: a definition is immutable. */
export async function saveExperiment(db: AzmDb, experiment: Experiment): Promise<void> {
  if (!isExperiment(experiment)) throw new Error('refusing to save an invalid experiment');
  await db.add('experiments', experiment);
}

export function getAllExperiments(db: AzmDb): Promise<Experiment[]> {
  return db.getAll('experiments');
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
