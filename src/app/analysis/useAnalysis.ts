import { useEffect, useState } from 'react';
import { loadAnalysis, saveAnalysis } from '../../data/analysisStore';
import type { AzmDb } from '../../data/db';
import { AnalysisRunner, type AnalysisState, type WorkerLike } from './runner';

const createWorker = (): WorkerLike =>
  new Worker(new URL('../../worker/analysis.worker.ts', import.meta.url), { type: 'module' });

/**
 * One analysis runner for the app's lifetime, bound to the database. null while there is no
 * database: without a stored log there is nothing to analyse.
 */
export function useAnalysis(db: AzmDb | null, writable: boolean): { state: AnalysisState; runner: AnalysisRunner | null } {
  const [runner, setRunner] = useState<AnalysisRunner | null>(null);
  const [state, setState] = useState<AnalysisState>({ snapshot: null, running: false, error: null });

  useEffect(() => {
    if (db === null) return;
    let live = true;
    let created: AnalysisRunner | null = null;
    loadAnalysis(db)
      .catch(() => null)
      .then((initial) => {
        if (!live) return;
        created = new AnalysisRunner(
          {
            createWorker,
            dbName: db.name,
            save: writable ? (snapshot) => saveAnalysis(db, snapshot) : null,
            onChange: (next) => {
              if (live) setState(next);
            },
          },
          initial,
        );
        setState(created.current);
        setRunner(created);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      created?.dispose();
    };
  }, [db, writable]);

  return { state, runner };
}
