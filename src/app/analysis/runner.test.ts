import { describe, expect, it } from 'vitest';
import type { AnalysisSnapshot } from '../../engine/analyse';
import type { AnalysisResponse, RecomputeRequest } from '../../worker/protocol';
import { AnalysisRunner, type AnalysisState, type WorkerLike } from './runner';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: RecomputeRequest[] = [];
  terminated = false;
  postMessage(message: RecomputeRequest) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: AnalysisResponse) {
    this.onmessage?.({ data } as MessageEvent<AnalysisResponse>);
  }
}

const snap = (computedAt: number) => ({ computedAt }) as AnalysisSnapshot;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const workers: FakeWorker[] = [];
  const saved: AnalysisSnapshot[] = [];
  const states: AnalysisState[] = [];
  const runner = new AnalysisRunner({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    load: () => Promise.resolve({ trials: [], sessions: [] }),
    save: (s) => {
      saved.push(s);
      return Promise.resolve();
    },
    onChange: (s) => states.push(s),
  });
  return { runner, workers, saved, states };
}

describe('AnalysisRunner', () => {
  it('runs a request in a worker, keeps and saves the result', async () => {
    const { runner, workers, saved } = setup();
    runner.request();
    await flush();
    expect(runner.current.running).toBe(true);
    workers[0]!.reply({ type: 'result', id: workers[0]!.posted[0]!.id, snapshot: snap(1) });
    expect(runner.current).toEqual({ snapshot: snap(1), running: false, error: null });
    expect(saved).toEqual([snap(1)]);
    expect(workers[0]!.terminated).toBe(true);
  });

  it('cancels a run when a round starts, and runs again when it ends', async () => {
    const { runner, workers } = setup();
    runner.request();
    await flush();
    runner.roundStarted();
    expect(workers[0]!.terminated).toBe(true);
    expect(runner.current.running).toBe(false);
    runner.request();
    await flush();
    expect(workers).toHaveLength(1);
    runner.roundEnded();
    await flush();
    expect(workers).toHaveLength(2);
  });

  it('keeps the last good snapshot when a run fails', async () => {
    const { runner, workers } = setup();
    runner.request();
    await flush();
    workers[0]!.reply({ type: 'result', id: workers[0]!.posted[0]!.id, snapshot: snap(1) });
    runner.request();
    await flush();
    workers[1]!.reply({ type: 'error', id: workers[1]!.posted[0]!.id, message: 'boom' });
    expect(runner.current).toEqual({ snapshot: snap(1), running: false, error: 'boom' });
  });

  it('reports a worker crash as an error', async () => {
    const { runner, workers } = setup();
    runner.request();
    await flush();
    workers[0]!.onerror?.({ message: 'crashed' } as ErrorEvent);
    expect(runner.current.error).toBe('crashed');
  });

  it('ignores a result from a cancelled run', async () => {
    const { runner, workers } = setup();
    runner.request();
    await flush();
    const old = workers[0]!;
    runner.roundStarted();
    old.reply({ type: 'result', id: old.posted[0]!.id, snapshot: snap(9) });
    expect(runner.current.snapshot).toBeNull();
  });
});
