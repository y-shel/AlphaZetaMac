import { EPROCESS_ALPHA, EPROCESS_BET_CAP, EXPERIMENT_CLIP_LOG_T, EXPERIMENT_MARGIN_Z, EXPERIMENT_RULE_OUT_LOG_T } from '../constants';

/** One matched pair as the test sees it. */
export interface PairEvidence {
  /** Difference of Stage 1 residuals, treatment minus control, in log time. */
  d: number;
  /** Standard error of the level model's predicted difference for this pair. */
  se: number;
}

export type ExperimentOutcome = 'confirmed' | 'ruled-out' | 'open';

export interface ExperimentState {
  outcome: ExperimentOutcome;
  /** Pairs given. */
  pairs: number;
  /** The pair that decided it, counted from 1, or null while open. Later pairs are not used. */
  decidedAtPair: number | null;
  confirmE: number;
  ruleOutE: number;
}

/** A log-time difference clipped to the fixed bound and rescaled to [0, 1] (spec 14.2). */
export function toUnit(d: number): number {
  const c = EXPERIMENT_CLIP_LOG_T;
  return (Math.min(Math.max(d, -c), c) + c) / (2 * c);
}

/**
 * A one-sided betting e-process on values in [0, 1]. direction 1 tests "the mean is at most
 * m" and bets that it is above. direction -1 tests "the mean is at least m" and bets below.
 * Each bet is computed from earlier values only, so the e-value is valid at every stopping
 * time (spec 14.2).
 */
export class BettingEProcess {
  private logE = 0;
  private n = 0;
  private sum = 0;
  private sumSq = 0;
  private readonly m: number;
  private readonly direction: 1 | -1;

  constructor(m: number, direction: 1 | -1) {
    this.m = m;
    this.direction = direction;
  }

  add(x: number): void {
    // Plug-in estimates with half an observation of prior. The prior is a constant, so the
    // first bet is fixed before any value is seen. It is 0 when m is 0.5.
    const mu = (0.5 + this.sum) / (this.n + 1);
    const variance = (0.25 + this.sumSq - 2 * mu * this.sum + this.n * mu * mu) / (this.n + 1);
    const edge = this.direction * (mu - this.m);
    const largest = EPROCESS_BET_CAP / (this.direction === 1 ? this.m : 1 - this.m);
    const bet = Math.min(Math.max(edge / (variance + edge * edge), 0), largest);
    this.logE += Math.log(1 + bet * this.direction * (x - this.m));
    this.n += 1;
    this.sum += x;
    this.sumSq += x * x;
  }

  get eValue(): number {
    return Math.exp(this.logE);
  }
}

/**
 * Runs the confirming and the ruling-out process over the pairs in order and stops at the
 * first that reaches 1 / EPROCESS_ALPHA. The confirming process sees d minus the margin for
 * the level model's own error, the ruling-out process d plus it. Both nulls are statements
 * about the mean of the clipped, rescaled values the processes see, not of the raw
 * differences. Throws on a pair whose d is not finite or whose se is negative or not finite.
 */
export function evaluatePairs(pairs: readonly PairEvidence[]): ExperimentState {
  const confirm = new BettingEProcess(toUnit(0), 1);
  const ruleOut = new BettingEProcess(toUnit(EXPERIMENT_RULE_OUT_LOG_T), -1);
  const threshold = 1 / EPROCESS_ALPHA;
  for (let i = 0; i < pairs.length; i++) {
    const { d, se } = pairs[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(se) || se < 0) throw new Error(`pair ${i + 1} has no usable evidence`);
    const margin = EXPERIMENT_MARGIN_Z * se;
    confirm.add(toUnit(d - margin));
    ruleOut.add(toUnit(d + margin));
    const outcome: ExperimentOutcome = confirm.eValue >= threshold ? 'confirmed' : ruleOut.eValue >= threshold ? 'ruled-out' : 'open';
    if (outcome !== 'open') {
      return { outcome, pairs: pairs.length, decidedAtPair: i + 1, confirmE: confirm.eValue, ruleOutE: ruleOut.eValue };
    }
  }
  return { outcome: 'open', pairs: pairs.length, decidedAtPair: null, confirmE: confirm.eValue, ruleOutE: ruleOut.eValue };
}
