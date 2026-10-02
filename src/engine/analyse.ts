import { operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { Session, Trial } from '../domain/types';
import { predictStanding, type Standing } from './anchor/standing';
import {
  DEFAULT_ROUND_SECONDS,
  MIN_EFFECT_LOG_T,
  SCORE_TREND_HALF_LIFE,
  SUSIE_MIN_TRIALS,
} from './constants';
import { levelTrials } from './features';
import { findingId, scorePoints, type Finding } from './findings/finding';
import { referenceRound, termPrevalence, typingGapMs, type ReferenceRound } from './round/reference';
import { fitLevelModel, predict, type LevelModel } from './stage1/levelModel';
import type { Observation } from './stage2/fallback';
import { fitRows, rankFallback, stage2Matrix } from './stage2/matrix';
import { predictedLogT, sessionHalves, type Stage2Rows } from './stage2/rows';
import type { CredibleSet, SusieFit } from './stage2/susie';
import type { BlindSpot, Term } from './stage2/terms';

export const ANALYSIS_VERSION = 1;

export interface ScorePoint {
  sessionId: string;
  startedAt: number;
  score: number;
  /** EWMA of scores so far (SCORE_TREND_HALF_LIFE sessions). */
  trend: number;
  /**
   * trend × e^(∓1.96 σ_session). Both are null when σ_session cannot be estimated: too few
   * sessions or trials, or session means that vary no more than their sampling noise.
   */
  low: number | null;
  high: number | null;
}

export interface ScoreSeries {
  /** Normal rounds with the same duration and settings as the latest one, oldest first. */
  points: ScorePoint[];
  durationS: number;
}

export type { Standing };

export interface AnalysisSnapshot {
  version: typeof ANALYSIS_VERSION;
  /** completedAt of the newest trial, or 0 for an empty log. */
  computedAt: number;
  nTrials: number;
  /** Level-mode trials with a keystroke. */
  nEligible: number;
  /** Trials in the Stage 2 matrix. */
  nStage2: number;
  stage2: 'none' | 'fallback' | 'susie';
  level: LevelModel | null;
  findings: Finding[];
  observations: Observation[];
  blindSpots: BlindSpot[];
  score: ScoreSeries | null;
  standing: Standing | null;
}

export interface AnalysisInput {
  trials: readonly Trial[];
  sessions: readonly Session[];
}

/**
 * Everything the dashboard shows, from the trial log alone (invariant 2). Pure and
 * deterministic: the same log always gives the same snapshot.
 */
export function analyse(input: AnalysisInput, registry: readonly Operation[] = operations): AnalysisSnapshot {
  // Time order, oldest first. The id breaks a tie so the order never depends on arrival.
  const all = [...input.trials].sort((a, b) => a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const computedAt = all.reduce((m, t) => Math.max(m, t.completedAt), 0);
  const levelRows = levelTrials(all);
  const eligible = levelRows.trials;
  const fit = fitLevelModel(levelRows.obs, undefined, registry);
  const level = fit.kind === 'ok' ? fit.model : null;

  const snapshot: AnalysisSnapshot = {
    version: ANALYSIS_VERSION,
    computedAt,
    nTrials: all.length,
    nEligible: eligible.length,
    nStage2: 0,
    stage2: 'none',
    level,
    findings: [],
    observations: [],
    blindSpots: [],
    score: null,
    standing: level === null ? null : predictStanding(level, typingGapMs(eligible), registry),
  };

  const stage2 = stage2Matrix(levelRows, all, registry);
  if (stage2.kind === 'ok') {
    const { matrix } = stage2;
    const { rows } = matrix;
    snapshot.nStage2 = rows.trials.length;
    snapshot.blindSpots = matrix.blindSpots;
    snapshot.score = scoreSeries(input.sessions, rows, level, registry);
    const full = rows.trials.length < SUSIE_MIN_TRIALS ? null : fitRows(matrix);
    if (full === null || stage2Method(full) === 'fallback') {
      snapshot.stage2 = 'fallback';
      snapshot.observations = rankFallback(matrix);
    } else {
      snapshot.stage2 = 'susie';
      const halves = sessionHalves(rows);
      const halfFits = halves.every((h) => h.length >= SUSIE_MIN_TRIALS) ? halves.map((h) => fitRows(matrix, h)) : null;
      const round = referenceRound(input.sessions, all, eligible, registry);
      snapshot.findings = full.sets
        .filter((cs) => cs.mean >= MIN_EFFECT_LOG_T)
        .map((cs) => toFinding(cs, matrix.terms, halfFits, rows, round, computedAt))
        .filter((f): f is Finding => f !== null)
        .sort((a, b) => b.scorePoints - a.scorePoints);
    }
  } else {
    // The scores come from the sessions, so the series does not need a model. Without
    // cross-fitted rows there are no residuals and so no band.
    snapshot.score = scoreSeries(input.sessions, null, level, registry);
  }
  return snapshot;
}

/**
 * Which Stage 2 method a full SuSiE fit supports. A fit that ran out of sweeps is not
 * trusted: its sets are not reported, and the fallback ranking is shown instead (spec 19).
 */
export function stage2Method(fit: SusieFit): 'susie' | 'fallback' {
  return fit.converged ? 'susie' : 'fallback';
}

function recovered(fit: SusieFit, terms: readonly Term[], ids: ReadonlySet<string>): boolean {
  return fit.sets.some((cs) => cs.mean >= MIN_EFFECT_LOG_T && cs.columns.some((j) => ids.has(terms[j]!.id)));
}

function toFinding(
  cs: CredibleSet,
  terms: readonly Term[],
  halves: SusieFit[] | null,
  rows: Stage2Rows,
  round: ReferenceRound | null,
  computedAt: number,
): Finding | null {
  if (round === null) return null;
  const members = cs.columns.map((j) => terms[j]!);
  const mass = cs.alpha.reduce((a, b) => a + b, 0);
  const prevalence = members.reduce((s, t, k) => s + cs.alpha[k]! * termPrevalence(t.atomIds, round.contexts), 0) / mass;
  // A finding that cannot be stated in score points is not shown (spec 12.3).
  if (!(prevalence > 0)) return null;
  const lead = members[0]!;
  const typical: number[] = [];
  for (let r = 0; r < lead.values.length; r++) if (lead.values[r] === 1) typical.push(Math.exp(predictedLogT(rows, r)));
  typical.sort((a, b) => a - b);
  const typicalMs = typical[Math.floor(typical.length / 2)] ?? 0;
  const ids = new Set(members.map((t) => t.id));
  const replicated = halves !== null && halves.every((h) => recovered(h, terms, ids));
  const pts = (e: number) => scorePoints(e, prevalence, round.roundSeconds, round.meanSecondsPerProblem);
  return {
    id: findingId(members.map((t) => t.id)),
    terms: members.map((t) => t.id),
    tier: replicated ? 'confirmed' : 'suspected',
    effectLogT: cs.mean,
    effectSdLogT: cs.sd,
    effectMs: typicalMs * (Math.exp(cs.mean) - 1),
    prevalence,
    prevalenceEstimated: round.estimated,
    scorePoints: pts(cs.mean),
    scorePointsLow: pts(cs.mean - 1.96 * cs.sd),
    scorePointsHigh: pts(cs.mean + 1.96 * cs.sd),
    nTrials: lead.nPositive,
    discoveredAt: computedAt,
    ...(replicated ? { confirmedAt: computedAt } : {}),
    replicated,
    shiftEvents: [],
  };
}

/**
 * Normal-round scores with an EWMA trend and a band from the session-to-session variance of
 * the level (spec 13 panel 1). σ_session² = var(session mean residual) − mean(σ²/n_s).
 * When that difference is not above 0 the session sd is not estimable, so there is no band.
 * The residuals here are the rows' log times less the level model's prediction, before any
 * session offset, so their session means carry the day-to-day variation.
 * With no rows the scores and trend are still returned, with no band.
 * The band is the day-to-day variation of the level only. A single round's score also
 * carries within-round noise and lapses, so the series makes no claim about improvement.
 */
function scoreSeries(sessions: readonly Session[], rows: Stage2Rows | null, level: LevelModel | null, registry: readonly Operation[]): ScoreSeries | null {
  const normal = sessions.filter((s) => s.mode === 'normal' && s.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
  const latest = normal.at(-1);
  if (latest === undefined) return null;
  const same = normal.filter((s) => s.durationS === latest.durationS && s.paramsSnapshotId === latest.paramsSnapshotId);

  let sigmaSession: number | null = null;
  if (level !== null && rows !== null) {
    const sums = new Map<string, { s: number; n: number }>();
    rows.trials.forEach((t, r) => {
      const e = sums.get(t.sessionId) ?? { s: 0, n: 0 };
      e.s += rows.logT[r]! - predict(level, { opId: t.opId, operands: t.operands, answer: t.answer }, registry);
      e.n += 1;
      sums.set(t.sessionId, e);
    });
    const groups = [...sums.values()].filter((g) => g.n >= 10);
    if (groups.length >= 3) {
      const means = groups.map((g) => g.s / g.n);
      const m = means.reduce((a, b) => a + b, 0) / means.length;
      const v = means.reduce((a, b) => a + (b - m) ** 2, 0) / (means.length - 1);
      const noise = groups.reduce((a, g) => a + (level.sigma * level.sigma) / g.n, 0) / groups.length;
      if (v - noise > 0) sigmaSession = Math.sqrt(v - noise);
    }
  }

  const points: ScorePoint[] = [];
  let num = 0;
  let den = 0;
  const decay = Math.pow(0.5, 1 / SCORE_TREND_HALF_LIFE);
  for (const s of same) {
    num = num * decay + s.score;
    den = den * decay + 1;
    const trend = num / den;
    points.push({
      sessionId: s.id,
      startedAt: s.startedAt,
      score: s.score,
      trend,
      low: sigmaSession === null ? null : trend * Math.exp(-1.96 * sigmaSession),
      high: sigmaSession === null ? null : trend * Math.exp(1.96 * sigmaSession),
    });
  }
  return { points, durationS: latest.durationS ?? DEFAULT_ROUND_SECONDS };
}
