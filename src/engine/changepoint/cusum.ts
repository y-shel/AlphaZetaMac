import { CUSUM_BURN_IN, CUSUM_H, CUSUM_K } from '../constants';

export interface Shift {
  /** Position in the stream where the alarm fired. */
  at: number;
  /** Position where the change is placed: where the alarming sum last left zero. */
  changeAt: number;
  /** 1 when the values rose, -1 when they fell. */
  direction: 1 | -1;
}

/**
 * A self-starting two-sided CUSUM (spec 16). Each value is standardised against the mean of
 * the values since the last restart and the given sigma, so no estimate of the level is
 * needed. It starts after CUSUM_BURN_IN values and restarts after each alarm.
 *
 * It never throws. A NaN value or a NaN sigma makes both sums NaN, and nothing is reported
 * from there to the end of the stream. Shifts found before it are kept. A sigma of 0 does
 * the same at the first value equal to the mean so far, which is 0 / 0, and a value that
 * differs from the mean alarms at once. Callers should pass finite values and a positive
 * sigma.
 */
export function detectShifts(x: ArrayLike<number>, sigma: number): Shift[] {
  const shifts: Shift[] = [];
  let sum = 0;
  let n = 0;
  let up = 0;
  let down = 0;
  let upStart = 0;
  let downStart = 0;
  for (let i = 0; i < x.length; i++) {
    if (n >= CUSUM_BURN_IN) {
      // sqrt(n / (n + 1)) makes the standardised value unit variance under no change.
      const z = ((x[i]! - sum / n) / sigma) * Math.sqrt(n / (n + 1));
      if (up === 0) upStart = i;
      if (down === 0) downStart = i;
      up = Math.max(0, up + z - CUSUM_K);
      down = Math.max(0, down - z - CUSUM_K);
      if (up > CUSUM_H || down > CUSUM_H) {
        const direction = up > CUSUM_H ? 1 : -1;
        shifts.push({ at: i, changeAt: direction === 1 ? upStart : downStart, direction });
        // What came before the change says nothing about the new level.
        sum = 0;
        n = 0;
        up = 0;
        down = 0;
        continue;
      }
    }
    sum += x[i]!;
    n++;
  }
  return shifts;
}
