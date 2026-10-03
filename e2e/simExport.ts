import { defaultParams } from '../src/domain/operations/registry';
import { paramsSnapshotId } from '../src/domain/params';
import type { Session } from '../src/domain/types';
import { simulateTrials, typicalUser, type SimUser } from '../src/engine/__sim__/simUser';

/** An export file of simulated normal rounds at default settings, as the app would write it. */
export function simulatedExport(user: Partial<SimUser>, sessions: number, seed: number) {
  const params = defaultParams();
  const snapshotId = paramsSnapshotId(params);
  const { trials } = simulateTrials(typicalUser(user), { params, sessions, trialsPerSession: 100, seed });
  const byId = new Map<string, Session>();
  for (const t of trials) {
    const s = byId.get(t.sessionId) ?? {
      id: t.sessionId,
      mode: t.mode === 'test' ? ('test' as const) : ('normal' as const),
      paramsSnapshotId: snapshotId,
      durationS: t.mode === 'test' ? null : 120,
      startedAt: t.displayedAt,
      endedAt: t.completedAt,
      score: 0,
    };
    s.score += 1;
    s.endedAt = t.completedAt;
    byId.set(t.sessionId, s);
  }
  return {
    format: 'alphazetamac-export',
    formatVersion: 2,
    exportedAt: 0,
    settings: null,
    trials,
    sessions: [...byId.values()],
    experiments: [],
    paramSnapshots: [{ id: snapshotId, params }],
  };
}
