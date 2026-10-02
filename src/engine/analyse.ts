import { operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { Experiment, Session, Trial } from '../domain/types';
import { predictStanding, type Standing } from './anchor/standing';
import { detectShifts, sessionContrasts } from './changepoint/cusum';
import { experimentState } from './confirm/experiment';
import { isTestable } from './confirm/pairs';
import { MIN_EFFECT_LOG_T, REFUTED_RETRY_TRIALS, SUSIE_MIN_TRIALS } from './constants';
import { levelTrials } from './features';
import { findingId, scorePoints, shiftId, type Finding, type ShiftEvent } from './findings/finding';
import { scoreSeries, type ScorePoint, type ScoreSeries } from './score/series';
import { referenceRound, termPrevalence, typingGapMs, type ReferenceRound } from './round/reference';
import { fitLevelModel, type LevelModel } from './stage1/levelModel';
import type { Observation } from './stage2/fallback';
import { fitRows, rankFallback, stage2Matrix, type Stage2Matrix } from './stage2/matrix';
import { predictedLogT, sessionHalves, type Stage2Rows } from './stage2/rows';
import type { CredibleSet, SusieFit } from './stage2/susie';
import type { BlindSpot, Term } from './stage2/terms';

export const ANALYSIS_VERSION = 3;

export type { ScorePoint, ScoreSeries };
export type { Standing };
export type { ShiftEvent };

/** A finding whose newest experiment ruled it out, hidden until enough new play has come in (spec 14.3). */
export interface RuledOut {
  findingId: string;
  terms: string[];
  experimentId: string;
  /** Pairs the experiment has. */
  pairs: number;
  /** completedAt of the later trial of the deciding pair. */
  decidedAt: number;
}

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
  /** The shifts of the findings shown, oldest first. */
  shifts: ShiftEvent[];
  /** Sets discovery still reports that an experiment ruled out. They are not in findings. */
  ruledOut: RuledOut[];
  observations: Observation[];
  blindSpots: BlindSpot[];
  score: ScoreSeries | null;
  standing: Standing | null;
}

export interface AnalysisInput {
  trials: readonly Trial[];
  sessions: readonly Session[];
  /** Experiment definitions, which are part of the log (spec 14.4). None when left out. */
  experiments?: readonly Experiment[];
}

/**
 * Everything the dashboard shows, from the log alone (invariant 2): the trials, the
 * sessions and the experiment definitions. Pure and deterministic: the same log always
 * gives the same snapshot.
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
    shifts: [],
    ruledOut: [],
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
      const discovered = full.sets
        .filter((cs) => cs.mean >= MIN_EFFECT_LOG_T)
        .map((cs) => toFinding(cs, matrix.terms, halfFits, rows, round, computedAt))
        .filter((f): f is Finding => f !== null)
        .sort((a, b) => b.scorePoints - a.scorePoints);
      // Stage 2 rows exist only when the level model was fitted. Without one there is nothing to judge.
      if (level !== null) {
        const played = experimentTrials(all);
        for (const found of discovered) {
          const shifts = shiftEvents(matrix, found, level.sigma);
          const judged = judge(found, shifts, input.experiments ?? [], played, eligible, level, registry);
          if (judged.kind === 'ruled-out') {
            snapshot.ruledOut.push(judged.ruledOut);
            continue;
          }
          snapshot.findings.push({ ...judged.finding, shiftEvents: shifts.map((s) => s.id) });
          snapshot.shifts.push(...shifts);
        }
        snapshot.shifts.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
    }
  }
  return snapshot;
}

/** The experiment trials of the log by experiment id. */
function experimentTrials(all: readonly Trial[]): Map<string, Trial[]> {
  const byExperiment = new Map<string, Trial[]>();
  for (const t of all) {
    if (t.mode !== 'experiment') continue;
    const ofExperiment = byExperiment.get(t.experimentId);
    if (ofExperiment === undefined) byExperiment.set(t.experimentId, [t]);
    else ofExperiment.push(t);
  }
  return byExperiment;
}

/** The newest experiment on the finding's set of terms. A tie in createdAt goes to the larger id. */
function experimentFor(finding: Finding, experiments: readonly Experiment[]): Experiment | null {
  let newest: Experiment | null = null;
  for (const e of experiments) {
    if (findingId(e.terms) !== finding.id) continue;
    if (newest === null || e.createdAt > newest.createdAt || (e.createdAt === newest.createdAt && e.id > newest.id)) newest = e;
  }
  return newest;
}

type Judged = { kind: 'shown'; finding: Finding } | { kind: 'ruled-out'; ruledOut: RuledOut };

/**
 * A discovered finding in the light of its newest experiment (spec 14.3). The experiment
 * decides the tier and nothing else: the effect and the score points stay discovery's.
 */
function judge(
  found: Finding,
  shifts: readonly ShiftEvent[],
  experiments: readonly Experiment[],
  played: ReadonlyMap<string, Trial[]>,
  eligible: readonly Trial[],
  level: LevelModel,
  registry: readonly Operation[],
): Judged {
  const experiment = experimentFor(found, experiments);
  if (experiment === null) return { kind: 'shown', finding: found };
  const state = experimentState(played.get(experiment.id) ?? [], level, registry);
  const finding: Finding = { ...found, experiment: { id: experiment.id, outcome: state.outcome, pairs: state.pairs } };
  if (state.decidedAt === null) return { kind: 'shown', finding };
  const decidedAt = state.decidedAt;
  if (state.outcome === 'confirmed') {
    // A shift after the experiment means what it confirmed may no longer hold (spec 16).
    // The tier is then discovery's own, and the finding can be tested again.
    const newest = shifts.at(-1);
    if (newest !== undefined && newest.at > decidedAt) return { kind: 'shown', finding };
    return { kind: 'shown', finding: { ...finding, tier: 'confirmed', experimentId: experiment.id, confirmedAt: decidedAt } };
  }
  let since = 0;
  for (const t of eligible) if (t.completedAt > decidedAt) since++;
  if (since < REFUTED_RETRY_TRIALS) {
    return { kind: 'ruled-out', ruledOut: { findingId: found.id, terms: found.terms, experimentId: experiment.id, pairs: state.pairs, decidedAt } };
  }
  // Enough new play has come in to propose it again. An experiment said no, so replication
  // alone does not make it confirmed.
  const again: Finding = { ...finding, tier: 'suspected' };
  delete again.confirmedAt;
  return { kind: 'shown', finding: again };
}

/** Median predicted time in ms on the rows where the term holds, or 0 when it holds on none. */
function typicalMs(rows: Stage2Rows, term: Term): number {
  const typical: number[] = [];
  for (let r = 0; r < term.values.length; r++) if (term.values[r] === 1) typical.push(Math.exp(predictedLogT(rows, r)));
  typical.sort((a, b) => a - b);
  return typical[Math.floor(typical.length / 2)] ?? 0;
}

/**
 * The shifts on a finding's leading term, oldest first (spec 16). A shift is dated by the
 * session where the alarm fired. Its size is the precision-weighted mean contrast from
 * that session up to the next alarm or the end, minus the same mean over the sessions from
 * the previous restart up to the one before the alarming sum last left zero. A shift with
 * no usable session on either side cannot be sized and is not reported.
 */
function shiftEvents(matrix: Stage2Matrix, finding: Finding, sigma: number): ShiftEvent[] {
  const lead = matrix.terms.find((t) => t.id === finding.terms[0]);
  if (lead === undefined) return [];
  const contrasts = sessionContrasts(matrix, lead.id, sigma);
  const shifts = detectShifts(contrasts);
  /** Precision-weighted mean of the contrasts at positions from, up to and not including to. */
  const mean = (from: number, to: number): number | null => {
    let w = 0;
    let s = 0;
    for (let i = from; i < to; i++) {
      const { d, v } = contrasts[i]!;
      // The contrasts the detector skips.
      if (!Number.isFinite(d) || !Number.isFinite(v) || v <= 0) continue;
      w += 1 / v;
      s += d / v;
    }
    return w > 0 ? s / w : null;
  };
  const ms = typicalMs(matrix.rows, lead);
  const out: ShiftEvent[] = [];
  for (let k = 0; k < shifts.length; k++) {
    const shift = shifts[k]!;
    const restart = k === 0 ? 0 : shifts[k - 1]!.at + 1;
    const before = mean(restart, shift.changeAt);
    const after = mean(shift.at, shifts[k + 1]?.at ?? contrasts.length);
    if (before === null || after === null) continue;
    const session = contrasts[shift.at]!;
    const sizeLogT = after - before;
    out.push({
      id: shiftId(finding.id, session.sessionId),
      findingId: finding.id,
      sessionId: session.sessionId,
      at: session.at,
      direction: shift.direction === 1 ? 'slower' : 'faster',
      sizeLogT,
      sizeMs: ms * (Math.exp(sizeLogT) - 1),
    });
  }
  return out;
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
  const ids = new Set(members.map((t) => t.id));
  const replicated = halves !== null && halves.every((h) => recovered(h, terms, ids));
  const pts = (e: number) => scorePoints(e, prevalence, round.roundSeconds, round.meanSecondsPerProblem);
  return {
    id: findingId(members.map((t) => t.id)),
    terms: members.map((t) => t.id),
    tier: replicated ? 'confirmed' : 'suspected',
    effectLogT: cs.mean,
    effectSdLogT: cs.sd,
    effectMs: typicalMs(rows, lead) * (Math.exp(cs.mean) - 1),
    prevalence,
    prevalenceEstimated: round.estimated,
    scorePoints: pts(cs.mean),
    scorePointsLow: pts(cs.mean - 1.96 * cs.sd),
    scorePointsHigh: pts(cs.mean + 1.96 * cs.sd),
    nTrials: lead.nPositive,
    discoveredAt: computedAt,
    ...(replicated ? { confirmedAt: computedAt } : {}),
    replicated,
    testable: isTestable(members.map((t) => t.id)),
    experiment: null,
    shiftEvents: [],
  };
}
