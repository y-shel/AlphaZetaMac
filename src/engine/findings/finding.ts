import { cyrb53 } from '../../domain/hash';

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
  /** Plan 4 fills this. */
  shiftEvents: string[];
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
