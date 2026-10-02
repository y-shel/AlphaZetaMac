export type Range = readonly [min: number, max: number];

export interface GeneratorParams {
  enabled: Readonly<Record<string, boolean>>;
  ranges: Readonly<Record<string, Range>>;
}

export interface ParamSnapshot {
  id: string;
  params: GeneratorParams;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

export interface Problem {
  opId: string;
  operands: readonly number[];
  answer: number;
}

export type TrialMode = 'normal' | 'test' | 'train' | 'calibration' | 'experiment';
export const TRIAL_MODES: readonly TrialMode[] = ['normal', 'test', 'train', 'calibration', 'experiment'];
export type Arm = 'treatment' | 'control';

/** What a problem is tagged with when it is drawn. Written onto its trial (invariant 5). */
export type TrialTag = { mode: Exclude<TrialMode, 'experiment'> } | { mode: 'experiment'; experimentId: string; arm: Arm };

export interface Keystroke {
  /** A digit '0'..'9', 'Backspace', or 'Delete'. */
  k: string;
  /** ms since the trial's displayedAt. */
  t: number;
}

export const TRIAL_SCHEMA_VERSION = 1;

interface TrialCore {
  id: string;
  schemaVersion: number;
  sessionId: string;
  opId: string;
  operands: number[];
  answer: number;
  displayedAt: number;
  keystrokes: Keystroke[];
  completedAt: number;
  indexInSession: number;
  prevTrialId: string | null;
  paramsSnapshotId: string;
}

/** experimentId and arm are set if and only if mode is 'experiment' (spec 6.1). */
export type Trial = TrialCore &
  (
    | { mode: Exclude<TrialMode, 'experiment'>; experimentId?: undefined; arm?: undefined }
    | { mode: 'experiment'; experimentId: string; arm: Arm }
  );

export type SessionMode = 'normal' | 'test' | 'train' | 'experiment';
export const SESSION_MODES: readonly SessionMode[] = ['normal', 'test', 'train', 'experiment'];

export interface Session {
  id: string;
  mode: SessionMode;
  paramsSnapshotId: string;
  durationS: number | null;
  startedAt: number;
  endedAt: number | null;
  score: number;
}

/**
 * An experiment on one suspected finding (spec 14). An immutable definition and part of
 * the log: its state is read back from the trials that carry its id. terms is the finding's
 * set of terms, each the atom ids joined by '&', and terms[0] is the leading term.
 */
export interface Experiment {
  id: string;
  terms: string[];
  createdAt: number;
}
