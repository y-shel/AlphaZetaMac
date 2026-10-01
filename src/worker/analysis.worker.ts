import { analyse } from '../engine/analyse';
import type { AnalysisResponse, RecomputeRequest } from './protocol';

/** The analysis worker (spec 18). It never touches the DOM or storage: data in, snapshot out. */
const post = (message: AnalysisResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<RecomputeRequest>) => {
  const { id, input } = event.data;
  try {
    post({ type: 'result', id, snapshot: analyse(input) });
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  }
};
