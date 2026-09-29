import { TRIAL_SCHEMA_VERSION, type ParamSnapshot, type Session, type Trial } from '../domain/types';

/** A valid normal-mode trial. Override any field. */
export function makeTrial(over: Partial<Exclude<Trial, { mode: 'experiment' }>> = {}): Trial {
  return {
    id: '01923cfb-fc00-7000-8000-000000000001',
    schemaVersion: TRIAL_SCHEMA_VERSION,
    sessionId: 'session-1',
    mode: 'normal',
    opId: 'add',
    operands: [2, 3],
    answer: 5,
    displayedAt: 1727600000000,
    keystrokes: [{ k: '5', t: 812 }],
    completedAt: 1727600000812,
    indexInSession: 0,
    prevTrialId: null,
    paramsSnapshotId: 'ps-00000000000000',
    ...over,
  };
}

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    mode: 'normal',
    paramsSnapshotId: 'ps-00000000000000',
    durationS: 120,
    startedAt: 1727600000000,
    endedAt: null,
    score: 1,
    ...over,
  };
}

export function makeSnapshot(over: Partial<ParamSnapshot> = {}): ParamSnapshot {
  return {
    id: 'ps-00000000000000',
    params: { enabled: { add: true }, ranges: { addA: [2, 100], addB: [2, 100] } },
    ...over,
  };
}
