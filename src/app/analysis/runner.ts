import type { AnalysisInput, AnalysisSnapshot } from '../../engine/analyse';
import type { AnalysisResponse, RecomputeRequest } from '../../worker/protocol';

/** What the runner needs from a Worker. A fake in tests. */
export interface WorkerLike {
  postMessage(message: RecomputeRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface AnalysisState {
  snapshot: AnalysisSnapshot | null;
  running: boolean;
  /** Set when the last run failed. The last good snapshot stays (spec 19). */
  error: string | null;
}

export interface RunnerDeps {
  createWorker: () => WorkerLike;
  /** Reads the log. */
  load: () => Promise<AnalysisInput>;
  /** Stores a snapshot. null when storage is unavailable: snapshots then live in memory only. */
  save: ((snapshot: AnalysisSnapshot) => Promise<void>) | null;
  onChange: (state: AnalysisState) => void;
}

/**
 * Runs analysis in the worker, off the main thread (spec 18). A round in progress always
 * wins: starting one cancels any run, and a request made during a round waits for its end.
 */
export class AnalysisRunner {
  private state: AnalysisState;
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private inRound = false;
  private pending = false;
  /** True from the start of a run until its worker exists, so only one start is in flight. */
  private loading = false;
  private disposed = false;
  private readonly deps: RunnerDeps;

  constructor(deps: RunnerDeps, initial: AnalysisSnapshot | null = null) {
    this.deps = deps;
    this.state = { snapshot: initial, running: false, error: null };
  }

  get current(): AnalysisState {
    return this.state;
  }

  /** Asks for a fresh analysis. Runs now, or when the current round ends. */
  request(): void {
    if (this.disposed) return;
    this.pending = true;
    if (!this.inRound) void this.start();
  }

  roundStarted(): void {
    this.inRound = true;
    if (this.worker !== null) {
      // Cancel and reschedule (spec 18). The drill never waits.
      this.stopWorker();
      this.pending = true;
      this.set({ running: false });
    }
  }

  roundEnded(): void {
    this.inRound = false;
    this.request();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWorker();
  }

  private async start(): Promise<void> {
    if (this.disposed || this.loading || this.worker !== null || !this.pending) return;
    this.loading = true;
    this.pending = false;
    const id = this.nextId++;
    this.set({ running: true, error: null });
    let input: AnalysisInput;
    try {
      input = await this.deps.load();
    } catch (e) {
      this.loading = false;
      this.set({ running: false, error: message(e) });
      return;
    }
    this.loading = false;
    if (this.disposed) return;
    // A round may have started while the log was loading.
    if (this.inRound) {
      this.pending = true;
      this.set({ running: false });
      return;
    }
    const worker = this.deps.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.id !== id || this.worker !== worker) return;
      this.stopWorker();
      if (data.type === 'error') {
        this.set({ running: false, error: data.message });
      } else {
        this.set({ running: false, snapshot: data.snapshot });
        this.deps.save?.(data.snapshot).catch((e: unknown) => this.set({ error: message(e) }));
      }
      if (this.pending && !this.inRound) void this.start();
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      this.stopWorker();
      this.set({ running: false, error: event.message || 'The analysis worker crashed.' });
    };
    worker.postMessage({ type: 'recompute', id, input });
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private set(patch: Partial<AnalysisState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.deps.onChange(this.state);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
