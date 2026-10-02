import type { Session } from '../../domain/types';
import { DEFAULT_ROUND_SECONDS, SCORE_BAND_MIN_ROUNDS, SCORE_TREND_HALF_LIFE } from '../constants';

export interface ScorePoint {
  sessionId: string;
  startedAt: number;
  score: number;
  /** EWMA of the counted scores so far (SCORE_TREND_HALF_LIFE sessions). */
  trend: number;
  /**
   * Where this round was likely to land given the rounds before it: the trend at the point
   * before, × e^(∓q s). Both are null on the first point and when the series has no band.
   */
  low: number | null;
  high: number | null;
}

export interface ScoreSeries {
  /**
   * Normal rounds with the same duration and settings as the latest one, oldest first.
   * Rounds that were cut short are not among them.
   */
  points: ScorePoint[];
  durationS: number;
  /** Rounds of the series that were cut short, and so are in neither the points nor the band. */
  leftOut: number;
  /** Where the next round is likely to land: the last trend × e^(∓q s). null with no band. */
  next: { low: number; high: number } | null;
}

/** 0.975 quantiles of Student's t for 1 to 30 degrees of freedom. Beyond 30 the last one is used. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * A root mean square gap at or below this is rounding error, not spread. A test for exactly 0
 * does not work: six rounds of 40 leave a trend of 39.99999999999999, so the gap is not 0.
 */
const NO_SPREAD = 1e-9;

/**
 * Half-width of the band on the log scale, or null when there is none. s is the root mean
 * square of log(score / trend before that round), so it measures how far a round lands from
 * where the trend stood. The t quantile keeps the band honest when there are few rounds.
 * Scores that are all the same have no measured spread, so they give no band, not one of
 * zero width.
 */
function bandHalfWidth(scores: readonly number[], trends: readonly number[]): number | null {
  if (scores.length < SCORE_BAND_MIN_ROUNDS) return null;
  let sumSq = 0;
  for (let i = 1; i < scores.length; i++) {
    // A counted score is above 0, and so is every trend. This keeps a 0 from the log anyway.
    if (!(scores[i]! > 0 && trends[i - 1]! > 0)) return null;
    const gap = Math.log(scores[i]! / trends[i - 1]!);
    sumSq += gap * gap;
  }
  const n = scores.length - 1;
  const s = Math.sqrt(sumSq / n);
  // Identical scores leave a trend that differs from them only by rounding in the EWMA.
  // Whole scores that differ at all give an s far above this.
  if (!(s > NO_SPREAD)) return null;
  return T975[Math.min(n, T975.length) - 1]! * s;
}

/**
 * Normal-round scores with an EWMA trend and a band that says where a round is likely to
 * land (spec 13 panel 1). The band comes from the scores alone: how far each round landed
 * from where the trend stood just before it. So it carries the day-to-day variation, the
 * noise within a round and the lapses together, and needs no model.
 *
 * A round is cut short when its score is below half the median score of the series, the
 * median being the upper middle of the sorted scores. Such a round is a round the user walked
 * away from, not a sample of how they play, so it is left out of the points, the trend and
 * the band. With a median of 0 no round is left out and there is no band.
 *
 * Each point's band is centred on the trend before it, so a point can fall outside its own
 * band. `next` is the same band centred on the last trend.
 * The series makes no claim about improvement.
 */
export function scoreSeries(sessions: readonly Session[]): ScoreSeries | null {
  const normal = sessions.filter((s) => s.mode === 'normal' && s.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
  const latest = normal.at(-1);
  if (latest === undefined) return null;
  const same = normal.filter((s) => s.durationS === latest.durationS && s.paramsSnapshotId === latest.paramsSnapshotId);

  const sorted = same.map((s) => s.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const counted = median > 0 ? same.filter((s) => s.score >= median / 2) : same;

  const trends: number[] = [];
  let num = 0;
  let den = 0;
  const decay = Math.pow(0.5, 1 / SCORE_TREND_HALF_LIFE);
  for (const s of counted) {
    num = num * decay + s.score;
    den = den * decay + 1;
    trends.push(num / den);
  }
  const half =
    median > 0
      ? bandHalfWidth(
          counted.map((s) => s.score),
          trends,
        )
      : null;
  const around = (centre: number, h: number) => ({ low: centre * Math.exp(-h), high: centre * Math.exp(h) });
  const points = counted.map((s, i): ScorePoint => {
    const band = half === null || i === 0 ? null : around(trends[i - 1]!, half);
    return {
      sessionId: s.id,
      startedAt: s.startedAt,
      score: s.score,
      trend: trends[i]!,
      low: band === null ? null : band.low,
      high: band === null ? null : band.high,
    };
  });
  return {
    points,
    durationS: latest.durationS ?? DEFAULT_ROUND_SECONDS,
    leftOut: same.length - counted.length,
    next: half === null ? null : around(trends.at(-1)!, half),
  };
}
