import type { AnalysisSnapshot } from '../engine/analyse';

/** Main thread to worker. The worker reads the log itself, so only the database name crosses (spec 18). */
export interface RecomputeRequest {
  type: 'recompute';
  id: number;
  dbName: string;
}

/** Worker to main thread. */
export type AnalysisResponse =
  | { type: 'result'; id: number; snapshot: AnalysisSnapshot }
  | { type: 'error'; id: number; message: string };
