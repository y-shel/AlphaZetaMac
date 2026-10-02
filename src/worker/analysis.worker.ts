import { openDb } from '../data/db';
import { getAllExperiments, getAllSessions, getAllTrials } from '../data/log';
import { analyse } from '../engine/analyse';
import type { AnalysisResponse, RecomputeRequest } from './protocol';

/**
 * The analysis worker (spec 18). It opens the database, reads the log and closes it, so the
 * main thread never copies the log. It does not write: the main thread stores the snapshot.
 */
const post = (message: AnalysisResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<RecomputeRequest>) => {
  const { id, dbName } = event.data;
  void run(id, dbName);
};

async function run(id: number, dbName: string): Promise<void> {
  try {
    const db = await openDb(dbName);
    let input;
    try {
      input = {
        trials: await getAllTrials(db),
        sessions: await getAllSessions(db),
        experiments: await getAllExperiments(db),
      };
    } finally {
      // An open connection would block a version upgrade in another tab.
      db.close();
    }
    post({ type: 'result', id, snapshot: analyse(input) });
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  }
}
