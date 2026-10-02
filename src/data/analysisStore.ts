import { ANALYSIS_VERSION, type AnalysisSnapshot } from '../engine/analyse';
import { DERIVED_STORES, LATEST, type AzmDb } from './db';

/** Replaces the stored analysis and its findings in one transaction. */
export async function saveAnalysis(db: AzmDb, snapshot: AnalysisSnapshot): Promise<void> {
  const tx = db.transaction(DERIVED_STORES, 'readwrite');
  await Promise.all([
    tx.objectStore('modelSnapshots').clear(),
    tx.objectStore('findings').clear(),
    tx.objectStore('modelSnapshots').put({ id: LATEST, computedAt: snapshot.computedAt, snapshot }),
    ...snapshot.findings.map((f) => tx.objectStore('findings').put(f)),
    tx.done,
  ]);
}

/** The stored analysis, or null when there is none or it was made by an older engine. */
export async function loadAnalysis(db: AzmDb): Promise<AnalysisSnapshot | null> {
  const stored = await db.get('modelSnapshots', LATEST);
  if (stored === undefined || stored.snapshot.version !== ANALYSIS_VERSION) return null;
  return stored.snapshot;
}

/** Throws away all derived data. The log is untouched. */
export async function clearDerived(db: AzmDb): Promise<void> {
  const tx = db.transaction(DERIVED_STORES, 'readwrite');
  await Promise.all([...DERIVED_STORES.map((name) => tx.objectStore(name).clear()), tx.done]);
}
