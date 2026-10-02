import { paramsSnapshotId } from '../../domain/params';
import type { GeneratorParams, Session, Trial } from '../../domain/types';

/** The sessions the app would have written for simulated trials: normal rounds of 120 s. */
export function simSessions(trials: readonly Trial[], params: GeneratorParams): Session[] {
  const byId = new Map<string, Session>();
  for (const t of trials) {
    const s = byId.get(t.sessionId) ?? {
      id: t.sessionId,
      mode: 'normal' as const,
      paramsSnapshotId: paramsSnapshotId(params),
      durationS: 120,
      startedAt: t.displayedAt,
      endedAt: t.completedAt,
      score: 0,
    };
    s.score += 1;
    s.endedAt = t.completedAt;
    byId.set(t.sessionId, s);
  }
  return [...byId.values()];
}
