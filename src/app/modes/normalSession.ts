import { paramsSnapshotId } from '../../domain/params';
import type { GeneratorParams, ParamSnapshot, Session, Trial } from '../../domain/types';
import type { Round } from '../drill/round';
import { toTrials } from '../drill/toTrials';

export type SaveRound = (snapshot: ParamSnapshot, session: Session, trials: readonly Trial[]) => Promise<void>;

export interface NormalSessionDeps {
  sessionId: string;
  /** null when storage is unavailable. The round still runs. */
  save: SaveRound | null;
  timeOrigin: number;
  newId: (epochMs: number) => string;
}

/**
 * Moves a Normal round's completed trials into storage. Called at round end, and when the
 * tab is hidden mid-round. Never called from the keypress path.
 */
export class NormalSession {
  readonly snapshot: ParamSnapshot;
  private session: Session;
  private flushed = 0;
  private lastTrialId: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly round: Round;
  private readonly deps: NormalSessionDeps;

  constructor(round: Round, params: GeneratorParams, durationS: number, startedAt: number, deps: NormalSessionDeps) {
    this.round = round;
    this.deps = deps;
    this.snapshot = { id: paramsSnapshotId(params), params };
    this.session = {
      id: deps.sessionId,
      mode: 'normal',
      paramsSnapshotId: this.snapshot.id,
      durationS,
      startedAt: deps.timeOrigin + startedAt,
      endedAt: null,
      score: 0,
    };
  }

  /**
   * Saves trials completed since the last successful flush. Pass endedAt (round clock) at
   * round end. Calls run one at a time, in order. A failed call leaves its trials unsaved,
   * so the next call retries them.
   */
  flush(endedAt: number | null = null): Promise<void> {
    const run = this.queue.then(() => this.write(endedAt));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(endedAt: number | null): Promise<void> {
    const { save, timeOrigin, newId } = this.deps;
    if (save === null) return;
    const trials = toTrials(this.round.completed, this.round.keys, this.flushed, this.lastTrialId, {
      sessionId: this.session.id,
      mode: 'normal',
      paramsSnapshotId: this.snapshot.id,
      timeOrigin,
      newId,
    });
    const session: Session = {
      ...this.session,
      score: this.round.completed.length,
      endedAt: endedAt === null ? this.session.endedAt : timeOrigin + endedAt,
    };
    await save(this.snapshot, session, trials);
    this.session = session;
    this.flushed += trials.length;
    this.lastTrialId = trials.at(-1)?.id ?? this.lastTrialId;
  }
}
