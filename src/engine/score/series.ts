import type { Session } from '../../domain/types';
import { DEFAULT_ROUND_SECONDS, SCORE_BAND_MIN_ROUNDS, SCORE_TREND_HALF_LIFE } from '../constants';

export interface ScorePoint {
  sessionId: string;
  startedAt: number;
  score: number;
  /** EWMA of scores so far (SCORE_TREND_HALF_LIFE sessions). */
  trend: number;
  /**
   * trend × e^(∓q s), where the next round is likely to land. Both are null when the series
   * has fewer than SCORE_BAND_MIN_ROUNDS rounds, or no round with a score above 0 to measure.
   */
  low: number | null;
  high: number | null;
}

export interface ScoreSeries {
  /** Normal rounds with the same duration and settings as the latest one, oldest first. */
  points: ScorePoint[];
  durationS: number;
}

/** 0.975 quantiles of Student's t for 1 to 30 degrees of freedom. Beyond 30 the last one is used. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * Half-width of the band on the log scale, or null with too few rounds. s is the root mean
 * square of log(score / trend before that round), so it measures how far a round lands from
 * where the trend stood. The t quantile keeps the band honest when there are few rounds.
 */
function bandHalfWidth(scores: readonly number[], trends: readonly number[]): number | null {
  if (scores.length < SCORE_BAND_MIN_ROUNDS) return null;
  let sumSq = 0;
  let n = 0;
  for (let i = 1; i < scores.length; i++) {
    // A round with a score of 0 has no log. It is left out of the spread.
    if (scores[i]! <= 0 || trends[i - 1]! <= 0) continue;
    const gap = Math.log(scores[i]! / trends[i - 1]!);
    sumSq += gap * gap;
    n++;
  }
  if (n === 0) return null;
  return T975[Math.min(n, T975.length) - 1]! * Math.sqrt(sumSq / n);
}

/**
 * Normal-round scores with an EWMA trend and a band that says where the next round is likely
 * to land (spec 13 panel 1). The band comes from the scores alone: how far each round landed
 * from where the trend stood just before it. So it carries the day-to-day variation, the
 * noise within a round and the lapses together, and needs no model.
 * The series makes no claim about improvement.
 */
export function scoreSeries(sessions: readonly Session[]): ScoreSeries | null {
  const normal = sessions.filter((s) => s.mode === 'normal' && s.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
  const latest = normal.at(-1);
  if (latest === undefined) return null;
  const same = normal.filter((s) => s.durationS === latest.durationS && s.paramsSnapshotId === latest.paramsSnapshotId);

  const trends: number[] = [];
  let num = 0;
  let den = 0;
  const decay = Math.pow(0.5, 1 / SCORE_TREND_HALF_LIFE);
  for (const s of same) {
    num = num * decay + s.score;
    den = den * decay + 1;
    trends.push(num / den);
  }
  const half = bandHalfWidth(
    same.map((s) => s.score),
    trends,
  );
  const points = same.map((s, i): ScorePoint => {
    const trend = trends[i]!;
    return {
      sessionId: s.id,
      startedAt: s.startedAt,
      score: s.score,
      trend,
      low: half === null ? null : trend * Math.exp(-half),
      high: half === null ? null : trend * Math.exp(half),
    };
  });
  return { points, durationS: latest.durationS ?? DEFAULT_ROUND_SECONDS };
}
