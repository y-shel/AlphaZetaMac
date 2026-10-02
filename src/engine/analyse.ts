import { operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { Session, Trial } from '../domain/types';
import { predictStanding, type Standing } from './anchor/standing';
import { MIN_EFFECT_LOG_T, SUSIE_MIN_TRIALS } from './constants';
import { levelTrials } from './features';
import { findingId, scorePoints, type Finding } from './findings/finding';
import { scoreSeries, type ScorePoint, type ScoreSeries } from './score/series';
import { referenceRound, termPrevalence, typingGapMs, type ReferenceRound } from './round/reference';
import { fitLevelModel, type LevelModel } from './stage1/levelModel';
import type { Observation } from './stage2/fallback';
import { fitRows, rankFallback, stage2Matrix } from './stage2/matrix';
import { predictedLogT, sessionHalves, type Stage2Rows } from './stage2/rows';
import type { CredibleSet, SusieFit } from './stage2/susie';
import type { BlindSpot, Term } from './stage2/terms';

export const ANALYSIS_VERSION = 2;

export type { ScorePoint, ScoreSeries };
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
    // The scores come from the sessions, so the series needs no model.
    score: scoreSeries(input.sessions),
    standing: level === null ? null : predictStanding(level, typingGapMs(eligible), registry),
  };

  const stage2 = stage2Matrix(levelRows, all, registry);
  if (stage2.kind === 'ok') {
    const { matrix } = stage2;
    const { rows } = matrix;
    snapshot.nStage2 = rows.trials.length;
    snapshot.blindSpots = matrix.blindSpots;
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
