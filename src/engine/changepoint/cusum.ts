import { CUSUM_BURN_IN, CUSUM_H, CUSUM_K, CUSUM_MIN_OTHER_ROWS, CUSUM_MIN_TERM_ROWS } from '../constants';
import { termRows, type Stage2Matrix } from '../stage2/matrix';

/** One session's evidence about a term: how much slower its rows were than the session's other rows. */
export interface SessionContrast {
  sessionId: string;
  /** completedAt of the session's first Stage 2 row. */
  at: number;
  /** Mean residual on the term's rows in the session minus the mean on its other rows. */
  d: number;
  /** Variance of d: sigma squared times (1 / term rows + 1 / other rows). */
  v: number;
}

export interface Shift {
  /** Position in the contrast list where the alarm fired. */
  at: number;
  /** Position where the change is placed: where the alarming sum last left zero. */
  changeAt: number;
  /** 1 when the contrasts rose, -1 when they fell. */
  direction: 1 | -1;
}

/**
 * The term's contrast in each session (spec 16), in order of the sessions' first appearance
 * in the rows. A session with fewer than CUSUM_MIN_TERM_ROWS rows where the term holds, or
 * fewer than CUSUM_MIN_OTHER_ROWS other rows, is left out. sigma is the level model's.
 * Measuring against the session's other rows cancels the day's overall speed.
 */
export function sessionContrasts(matrix: Stage2Matrix, termId: string, sigma: number): SessionContrast[] {
  const { rows } = matrix;
  const inTerm = new Set(termRows(matrix, termId));
  interface Tally {
    at: number;
    termSum: number;
    termN: number;
    otherSum: number;
    otherN: number;
  }
  // A Map keeps its keys in the order they were first set.
  const bySession = new Map<string, Tally>();
  for (let r = 0; r < rows.trials.length; r++) {
    const trial = rows.trials[r]!;
    let tally = bySession.get(trial.sessionId);
    if (tally === undefined) {
      tally = { at: trial.completedAt, termSum: 0, termN: 0, otherSum: 0, otherN: 0 };
      bySession.set(trial.sessionId, tally);
    }
    if (inTerm.has(r)) {
      tally.termSum += rows.residual[r]!;
      tally.termN++;
    } else {
      tally.otherSum += rows.residual[r]!;
      tally.otherN++;
    }
  }
  const out: SessionContrast[] = [];
  for (const [sessionId, t] of bySession) {
    if (t.termN < CUSUM_MIN_TERM_ROWS || t.otherN < CUSUM_MIN_OTHER_ROWS) continue;
    out.push({ sessionId, at: t.at, d: t.termSum / t.termN - t.otherSum / t.otherN, v: sigma * sigma * (1 / t.termN + 1 / t.otherN) });
  }
  return out;
}

/**
 * A self-starting, precision-weighted, two-sided CUSUM over session contrasts (spec 16).
 * Each contrast is standardised against the precision-weighted mean of the contrasts since
 * the last restart, so no estimate of the level is needed. It starts after CUSUM_BURN_IN
 * contrasts and restarts after each alarm.
 *
 * It never throws. An empty list gives no shifts. A contrast whose d is not finite, or
 * whose v is not finite and above 0, is skipped: it raises no alarm, changes no sum and
 * does not count toward the burn-in. Positions in the result still count it.
 */
export function detectShifts(contrasts: readonly { d: number; v: number }[]): Shift[] {
  const shifts: Shift[] = [];
  // Since the last restart: the sum of 1 / v, the sum of d / v, and the contrasts taken in.
  let w = 0;
  let s = 0;
  let n = 0;
  let up = 0;
  let down = 0;
  let upStart = 0;
  let downStart = 0;
  for (let i = 0; i < contrasts.length; i++) {
    const { d, v } = contrasts[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(v) || v <= 0) continue;
    if (n >= CUSUM_BURN_IN) {
      // The mean so far has variance 1 / w, so the difference has variance v + 1 / w.
      const z = (d - s / w) / Math.sqrt(v + 1 / w);
      if (up === 0) upStart = i;
      if (down === 0) downStart = i;
      up = Math.max(0, up + z - CUSUM_K);
      down = Math.max(0, down - z - CUSUM_K);
      if (up > CUSUM_H || down > CUSUM_H) {
        const direction = up > CUSUM_H ? 1 : -1;
        shifts.push({ at: i, changeAt: direction === 1 ? upStart : downStart, direction });
        // What came before the change says nothing about the new level.
        w = 0;
        s = 0;
        n = 0;
        up = 0;
        down = 0;
        continue;
      }
    }
    w += 1 / v;
    s += d / v;
    n++;
  }
  return shifts;
}
