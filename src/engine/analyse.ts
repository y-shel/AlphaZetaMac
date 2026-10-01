import { getAtom } from '../domain/atoms/registry';
import type { AtomContext } from '../domain/atoms/types';
import { createProblemSource, defaultParams, operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import { createRng } from '../domain/rng';
import type { Session, Trial } from '../domain/types';
import { predictStanding, typingGapMs, type Standing } from './anchor/standing';
import {
  DEFAULT_ROUND_SAMPLES,
  MIN_EFFECT_LOG_T,
  RECENT_NORMAL_SESSIONS,
  SCORE_TREND_HALF_LIFE,
  STAGE2_MAX_LAPSE_RESP,
  SUSIE_MIN_TRIALS,
} from './constants';
import { LEVEL_MODES, observations } from './features';
import { findingId, scorePoints, type Finding } from './findings/finding';
import { crossFit } from './stage1/crossFit';
import { ewmaWeights, fitLevelModel, predict, type LevelModel } from './stage1/levelModel';
import { fallbackRanking, type Observation } from './stage2/fallback';
import { suffStats, susie, type CredibleSet, type SusieFit } from './stage2/susie';
import { atomContexts, buildTerms, roundContexts, type BlindSpot, type Term } from './stage2/terms';

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
  const all = [...input.trials].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const computedAt = all.reduce((m, t) => Math.max(m, t.completedAt), 0);
  const eligible = all.filter((t) => LEVEL_MODES.includes(t.mode) && t.keystrokes.length > 0);
  const obs = observations(eligible);
  const fit = fitLevelModel(obs, undefined, registry);
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

  const cf = crossFit(obs, registry);
  if (cf.kind === 'ok') {
    const w = ewmaWeights(obs.length);
    const idx: number[] = [];
    for (let i = 0; i < obs.length; i++) {
      // NaN > 0.5 is false, so a missing residual must be dropped explicitly.
      if (Number.isFinite(cf.residual[i]) && cf.lapseResp[i]! <= STAGE2_MAX_LAPSE_RESP) idx.push(i);
    }
    const rowsTrials = idx.map((i) => eligible[i]!);
    const y = Float64Array.from(idx, (i) => cf.residual[i]!);
    const wy = Float64Array.from(idx, (i) => w[i]!);
    const pred = Float64Array.from(idx, (i) => obs[i]!.y - cf.residual[i]!);
    const matrix = buildTerms(atomContexts(rowsTrials, all));
    snapshot.nStage2 = idx.length;
    snapshot.blindSpots = matrix.blindSpots;
    // Session means of residuals before any session offset carry the day-to-day variation.
    const raw = level === null ? null : Float64Array.from(idx, (i) => obs[i]!.y - predict(level, obs[i]!.problem, registry));
    snapshot.score = scoreSeries(input.sessions, idx.map((i) => eligible[i]!.sessionId), raw, level);
    const rows = idx.map((_, r) => r);
    if (idx.length < SUSIE_MIN_TRIALS) {
      snapshot.stage2 = 'fallback';
      snapshot.observations = fallbackRanking(matrix.terms, y, wy, rows);
    } else {
      snapshot.stage2 = 'susie';
      const columns = matrix.terms.map((t) => t.values);
      const full = susie(suffStats(columns, y, wy, rows));
      const halves = replicationHalves(rowsTrials);
      const halfFits = halves.every((h) => h.length >= SUSIE_MIN_TRIALS)
        ? halves.map((h) => susie(suffStats(columns, y, wy, h)))
        : null;
      const round = typicalRound(input.sessions, all, eligible, registry);
      snapshot.findings = full.sets
        .filter((cs) => cs.mean >= MIN_EFFECT_LOG_T)
        .map((cs) => toFinding(cs, matrix.terms, halfFits, pred, round, computedAt))
        .filter((f): f is Finding => f !== null)
        .sort((a, b) => b.scorePoints - a.scorePoints);
    }
  } else {
    // The scores come from the sessions, so the series does not need a model. Without
    // cross-fitted rows there are no residuals and so no band.
    snapshot.score = scoreSeries(input.sessions, [], null, level);
  }
  return snapshot;
}

/** Row positions split by session parity, sessions in order of first appearance (spec 10.5). */
function replicationHalves(rowsTrials: readonly Trial[]): [number[], number[]] {
  const order = new Map<string, number>();
  const halves: [number[], number[]] = [[], []];
  rowsTrials.forEach((t, r) => {
    if (!order.has(t.sessionId)) order.set(t.sessionId, order.size);
    halves[order.get(t.sessionId)! % 2]!.push(r);
  });
  return halves;
}

function recovered(fit: SusieFit, terms: readonly Term[], ids: ReadonlySet<string>): boolean {
  return fit.sets.some((cs) => cs.mean >= MIN_EFFECT_LOG_T && cs.columns.some((j) => ids.has(terms[j]!.id)));
}

interface TypicalRound {
  roundSeconds: number;
  meanSecondsPerProblem: number;
  contexts: AtomContext[];
  estimated: boolean;
}

/**
 * What "a typical round" means for prevalence and pace (spec 12.3): the user's recent normal
 * rounds, or, with none, a default-settings round and the pace of whatever they have played.
 */
function typicalRound(sessions: readonly Session[], all: readonly Trial[], eligible: readonly Trial[], registry: readonly Operation[]): TypicalRound | null {
  const recent = sessions
    .filter((s) => s.mode === 'normal')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, RECENT_NORMAL_SESSIONS);
  const ids = new Set(recent.map((s) => s.id));
  const normal = all.filter((t) => t.mode === 'normal' && ids.has(t.sessionId));
  if (normal.length > 0) {
    return {
      roundSeconds: recent[0]!.durationS ?? 120,
      meanSecondsPerProblem: meanSeconds(normal),
      contexts: atomContexts(normal, all),
      estimated: false,
    };
  }
  if (eligible.length === 0) return null;
  return {
    roundSeconds: 120,
    meanSecondsPerProblem: meanSeconds(eligible),
    contexts: syntheticRound(registry),
    estimated: true,
  };
}

function meanSeconds(trials: readonly Trial[]): number {
  let s = 0;
  for (const t of trials) s += t.completedAt - t.displayedAt;
  return s / trials.length / 1000;
}

/** Contexts for a default-settings round, for users with no normal rounds. Fixed seed. */
function syntheticRound(registry: readonly Operation[]): AtomContext[] {
  const next = createProblemSource(defaultParams(registry), createRng(1), registry);
  return roundContexts(Array.from({ length: DEFAULT_ROUND_SAMPLES }, () => next()));
}

/** Share of a round's problems for which every atom of the term is true. */
function termPrevalence(term: Term, contexts: readonly AtomContext[]): number {
  if (contexts.length === 0) return 0;
  const atoms = term.atomIds.map((id) => getAtom(id));
  let hits = 0;
  for (const ctx of contexts) if (atoms.every((a) => a.applies(ctx) === true)) hits++;
  return hits / contexts.length;
}

function toFinding(
  cs: CredibleSet,
  terms: readonly Term[],
  halves: SusieFit[] | null,
  pred: Float64Array,
  round: TypicalRound | null,
  computedAt: number,
): Finding | null {
  if (round === null) return null;
  const members = cs.columns.map((j) => terms[j]!);
  const mass = cs.alpha.reduce((a, b) => a + b, 0);
  const prevalence = members.reduce((s, t, k) => s + cs.alpha[k]! * termPrevalence(t, round.contexts), 0) / mass;
  // A finding that cannot be stated in score points is not shown (spec 12.3).
  if (!(prevalence > 0)) return null;
  const lead = members[0]!;
  const typical: number[] = [];
  for (let r = 0; r < lead.values.length; r++) if (lead.values[r] === 1) typical.push(Math.exp(pred[r]!));
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
 * With no residual rows the scores and trend are still returned, with no band.
 * The band is the day-to-day variation of the level only. A single round's score also
 * carries within-round noise and lapses, so the series makes no claim about improvement.
 */
function scoreSeries(sessions: readonly Session[], rowSessions: readonly string[], resid: Float64Array | null, level: LevelModel | null): ScoreSeries | null {
  const normal = sessions.filter((s) => s.mode === 'normal' && s.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
  const latest = normal.at(-1);
  if (latest === undefined) return null;
  const same = normal.filter((s) => s.durationS === latest.durationS && s.paramsSnapshotId === latest.paramsSnapshotId);

  let sigmaSession: number | null = null;
  if (level !== null && resid !== null) {
    const sums = new Map<string, { s: number; n: number }>();
    rowSessions.forEach((id, r) => {
      const e = sums.get(id) ?? { s: 0, n: 0 };
      e.s += resid[r]!;
      e.n += 1;
      sums.set(id, e);
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
  return { points, durationS: latest.durationS ?? 120 };
}
