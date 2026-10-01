import type { AnalysisInput, AnalysisSnapshot } from '../engine/analyse';

/** Main thread to worker. Plan 3 needs only a full recompute (spec 18). */
export interface RecomputeRequest {
  type: 'recompute';
  id: number;
  input: AnalysisInput;
}

/** Worker to main thread. */
export type AnalysisResponse =
  | { type: 'result'; id: number; snapshot: AnalysisSnapshot }
  | { type: 'error'; id: number; message: string };
