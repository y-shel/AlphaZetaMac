import {
  TRIAL_MODES,
  type GeneratorParams,
  type Keystroke,
  type ParamSnapshot,
  type Session,
  type Trial,
} from '../domain/types';

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const isString = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isSafeInteger(x);
const isIntArray = (x: unknown): x is number[] => Array.isArray(x) && x.every(isInt);

export function isKeystroke(x: unknown): x is Keystroke {
  if (!isRecord(x) || !isFiniteNumber(x.t)) return false;
  return x.k === 'Backspace' || x.k === 'Delete' || (typeof x.k === 'string' && /^[0-9]$/.test(x.k));
}

/** Checks the shape of a current-version trial. Extra fields are allowed. */
export function isTrial(x: unknown): x is Trial {
  if (!isRecord(x)) return false;
  const core =
    isString(x.id) &&
    isInt(x.schemaVersion) &&
    isString(x.sessionId) &&
    isString(x.opId) &&
    isIntArray(x.operands) &&
    isInt(x.answer) &&
    isFiniteNumber(x.displayedAt) &&
    isFiniteNumber(x.completedAt) &&
    Array.isArray(x.keystrokes) &&
    x.keystrokes.every(isKeystroke) &&
    isInt(x.indexInSession) &&
    (x.prevTrialId === null || isString(x.prevTrialId)) &&
    isString(x.paramsSnapshotId);
  if (!core) return false;
  if (x.mode === 'experiment') {
    return isString(x.experimentId) && (x.arm === 'treatment' || x.arm === 'control');
  }
  return (
    (TRIAL_MODES as readonly unknown[]).includes(x.mode) &&
    x.experimentId === undefined &&
    x.arm === undefined
  );
}

export function isSession(x: unknown): x is Session {
  return (
    isRecord(x) &&
    isString(x.id) &&
    (x.mode === 'normal' || x.mode === 'test' || x.mode === 'train') &&
    isString(x.paramsSnapshotId) &&
    (x.durationS === null || isInt(x.durationS)) &&
    isFiniteNumber(x.startedAt) &&
    (x.endedAt === null || isFiniteNumber(x.endedAt)) &&
    isInt(x.score)
  );
}

export function isGeneratorParams(x: unknown): x is GeneratorParams {
  if (!isRecord(x) || !isRecord(x.enabled) || !isRecord(x.ranges)) return false;
  const enabledOk = Object.values(x.enabled).every((v) => typeof v === 'boolean');
  const rangesOk = Object.values(x.ranges).every(
    (r) => Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]) && r[0] <= r[1],
  );
  return enabledOk && rangesOk;
}

export function isParamSnapshot(x: unknown): x is ParamSnapshot {
  return isRecord(x) && isString(x.id) && isGeneratorParams(x.params);
}
