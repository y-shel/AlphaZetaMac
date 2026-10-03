import { cyrb53 } from '../../domain/hash';
import type { ExperimentOutcome } from '../confirm/eprocess';

export type Tier = 'confirmed' | 'suspected' | 'insufficient-data';

/** A weakness the engine can state in score points (spec 12.1). */
export interface Finding {
  /** 'f-' plus a hash of the sorted term ids, so the same terms keep the same id across rebuilds. */
  id: string;
  /** More than one means a credible set: the data cannot yet tell these apart. */
  terms: string[];
  tier: Tier;
  /** Posterior mean extra log time on problems with the term. */
  effectLogT: number;
  /** Posterior sd of effectLogT. */
  effectSdLogT: number;
  /** effectLogT in ms at the user's current speed on these problems. */
  effectMs: number;
  /** Share of a typical round this affects (spec 12.3). */
  prevalence: number;
  /** True when there are no normal rounds and prevalence is from default settings instead. */
  prevalenceEstimated: boolean;
  /** Problems off the score per round (spec 12.3). */
  scorePoints: number;
  /** scorePoints at the ends of a 95% interval on effectLogT. */
  scorePointsLow: number;
  scorePointsHigh: number;
  /** Trials in which the leading term holds. */
  nTrials: number;
  /** completedAt of the newest trial in the analysis that produced this finding. */
  discoveredAt: number;
  confirmedAt?: number;
  experimentId?: string;
  /** Recovered on both interleaved halves (spec 10.5). */
  replicated: boolean;
  /** False when a term has a sequence atom, which matched pairs cannot test (spec 14.1). */
  testable: boolean;
  /**
   * The newest experiment on this set of terms and where it stands, or null when there is
   * none (spec 14.3). pairs is all the pairs it has in the log. decidedAtPair is the deciding
   * pair's number once it is decided, and null while it is open. Pairs after it are in pairs only.
   *
   * - 'confirmed': the tier is confirmed, and experimentId and confirmedAt are this experiment's.
   * - 'open': a test is under way. The tier is discovery's, or suspected if an earlier
   *   experiment on the set ruled it out.
   * - 'ruled-out': a finding that was just ruled out is hidden and listed in the snapshot's
   *   ruledOut instead. So on a finding that is shown, 'ruled-out' means enough new play
   *   has come in since, discovery still reports the set, and a retest is due. The tier is
   *   suspected, whatever replication says, until a later experiment confirms it.
   */
  experiment: { id: string; outcome: ExperimentOutcome; pairs: number; decidedAtPair: number | null } | null;
}

export function findingId(terms: readonly string[]): string {
  return `f-${cyrb53([...terms].sort().join('|')).toString(16).padStart(14, '0')}`;
}

/**
 * Problems off the score per round (spec 12.3):
 * roundSeconds × prevalence × (1 − e^(−effect)) / meanSecondsPerProblem.
 */
export function scorePoints(effectLogT: number, prevalence: number, roundSeconds: number, meanSecondsPerProblem: number): number {
  return (roundSeconds * prevalence * (1 - Math.exp(-effectLogT))) / meanSecondsPerProblem;
}
