import { operations } from '../domain/operations/registry';
import type { Operation } from '../domain/operations/types';
import type { Experiment, Session, Trial } from '../domain/types';
import { predictStanding, type Standing } from './anchor/standing';
import type { ExperimentState } from './confirm/eprocess';
import { experimentState } from './confirm/experiment';
import { isTestable } from './confirm/pairs';
import { MIN_EFFECT_LOG_T, REFUTED_RETRY_TRIALS, SUSIE_MIN_TRIALS } from './constants';
import { levelTrials, type LevelRows } from './features';
import { findingId, scorePoints, type Finding } from './findings/finding';
import { scoreSeries, type ScorePoint, type ScoreSeries } from './score/series';
import { referenceRound, termPrevalence, typingGapMs, type ReferenceRound } from './round/reference';
import { fitLevelModel, type LevelModel } from './stage1/levelModel';
import type { Observation } from './stage2/fallback';
import { fitRows, rankFallback, stage2Matrix } from './stage2/matrix';
import { predictedLogT, sessionHalves, type Stage2Rows } from './stage2/rows';
import type { CredibleSet, SusieFit } from './stage2/susie';
import type { BlindSpot, Term } from './stage2/terms';

export const ANALYSIS_VERSION = 3;

export type { ScorePoint, ScoreSeries };
export type { Standing };

/** A finding whose newest experiment ruled it out, hidden until enough new play has come in (spec 14.3). */
export interface RuledOut {
  findingId: string;
  terms: string[];
  experimentId: string;
  /** Pairs the experiment has. */
  pairs: number;
  /** The deciding pair's number. A ruled-out record always has one. */
  decidedAtPair: number | null;
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
  const all = inTimeOrder(input.trials);
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
        const stateOf = experimentJudge(all, levelRows, level, registry);
        for (const found of discovered) {
          const judged = judge(found, input.experiments ?? [], stateOf, eligible);
          if (judged.kind === 'ruled-out') snapshot.ruledOut.push(judged.ruledOut);
          else snapshot.findings.push(judged.finding);
        }
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

/** Where an experiment stands, and when it was decided. */
export type JudgedState = ExperimentState & { decidedAt: number | null };

/**
 * Reads an experiment's state by id, each with the level model of its own time (spec 14.4):
 * the model fitted on the level trials completed before the first trial of the
 * experiment's newest session. That is the model its last round was played against, so a
 * verdict does not move when the user plays on. all is the log in time order, levelRows
 * its level trials in the same order, and level the model fitted on all of them.
 *
 * A model is fitted once for each distinct cut point and a state is read once for each
 * experiment. An experiment with no level trial after its cut uses level itself.
 */
function experimentJudge(all: readonly Trial[], levelRows: LevelRows, level: LevelModel, registry: readonly Operation[]): (experimentId: string) => JudgedState {
  const played = experimentTrials(all);
  /** By the number of level trials before the cut. */
  const models = new Map<number, LevelModel>();
  const states = new Map<string, JudgedState>();
  const modelAt = (cut: number): LevelModel => {
    // levelRows is in completedAt order, so the trials before the cut are a prefix.
    let lo = 0;
    let hi = levelRows.trials.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (levelRows.trials[mid]!.completedAt < cut) lo = mid + 1;
      else hi = mid;
    }
    if (lo === levelRows.trials.length) return level;
    let model = models.get(lo);
    if (model === undefined) {
      const fit = fitLevelModel(levelRows.obs.slice(0, lo), undefined, registry);
      // Too few level trials before the round to fit a model. The app cannot start a round
      // without one, so this is a log it did not write. The current model is the best there is.
      model = fit.kind === 'ok' ? fit.model : level;
      models.set(lo, model);
    }
    return model;
  };
  return (experimentId) => {
    let state = states.get(experimentId);
    if (state === undefined) {
      const trials = played.get(experimentId) ?? [];
      // A session starts when its first trial is shown. The newest session is the one that starts last.
      const starts = new Map<string, number>();
      for (const t of trials) starts.set(t.sessionId, Math.min(starts.get(t.sessionId) ?? Infinity, t.displayedAt));
      const cut = Math.max(-Infinity, ...starts.values());
      state = experimentState(trials, trials.length === 0 ? level : modelAt(cut), registry);
      states.set(experimentId, state);
    }
    return state;
  };
}

/**
 * Where each experiment stands, by id, as the analysis judges it (spec 14.4). The same
 * reading analyse gives a finding, for an experiment whether or not discovery reports its
 * set. Empty when there is no level model.
 */
export function experimentStates(input: Pick<AnalysisInput, 'trials' | 'experiments'>, registry: readonly Operation[] = operations): Map<string, JudgedState> {
  const all = inTimeOrder(input.trials);
  const levelRows = levelTrials(all);
  const fit = fitLevelModel(levelRows.obs, undefined, registry);
  const out = new Map<string, JudgedState>();
  if (fit.kind !== 'ok') return out;
  const stateOf = experimentJudge(all, levelRows, fit.model, registry);
  for (const e of input.experiments ?? []) out.set(e.id, stateOf(e.id));
  return out;
}

/** Time order, oldest first. The id breaks a tie so the order never depends on arrival. */
function inTimeOrder(trials: readonly Trial[]): Trial[] {
  return [...trials].sort((a, b) => a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The experiments on the finding's set of terms, oldest first. A tie in createdAt is broken
 * by id, so of two made at the same time the one with the larger id is the newer.
 */
function experimentsFor(finding: Finding, experiments: readonly Experiment[]): Experiment[] {
  return experiments
    .filter((e) => findingId(e.terms) === finding.id)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Judged = { kind: 'shown'; finding: Finding } | { kind: 'ruled-out'; ruledOut: RuledOut };

/**
 * A discovered finding in the light of the experiments on its set of terms (spec 14.3).
 * An experiment decides the tier and nothing else: the effect and the score points stay
 * discovery's.
 *
 * The newest experiment is the one shown. If it confirmed, the finding is confirmed. If
 * not, a ruled-out verdict from any experiment on the set outranks replication for good:
 * the finding is hidden until REFUTED_RETRY_TRIALS level trials have come in after the
 * most recent verdict, when that verdict is ruled out, and after that it is shown as
 * suspected until a later experiment confirms it.
 */
function judge(
  found: Finding,
  experiments: readonly Experiment[],
  stateOf: (experimentId: string) => JudgedState,
  eligible: readonly Trial[],
): Judged {
  const judged = experimentsFor(found, experiments).map((experiment) => ({ experiment, state: stateOf(experiment.id) }));
  const newest = judged.at(-1);
  if (newest === undefined) return { kind: 'shown', finding: found };
  const finding: Finding = { ...found, experiment: { id: newest.experiment.id, outcome: newest.state.outcome, pairs: newest.state.pairs, decidedAtPair: newest.state.decidedAtPair } };
  if (newest.state.outcome === 'confirmed' && newest.state.decidedAt !== null) {
    return { kind: 'shown', finding: { ...finding, tier: 'confirmed', experimentId: newest.experiment.id, confirmedAt: newest.state.decidedAt } };
  }
  // No experiment has ruled the set out: the tier is discovery's.
  if (!judged.some((j) => j.state.outcome === 'ruled-out')) return { kind: 'shown', finding };
  // The most recent verdict. An open experiment after it changes nothing yet.
  const verdict = [...judged].reverse().find((j) => j.state.decidedAt !== null);
  if (verdict !== undefined && verdict.state.outcome === 'ruled-out' && verdict.state.decidedAt !== null) {
    const decidedAt = verdict.state.decidedAt;
    let since = 0;
    for (const t of eligible) if (t.completedAt > decidedAt) since++;
    if (since < REFUTED_RETRY_TRIALS) {
      return {
        kind: 'ruled-out',
        ruledOut: { findingId: found.id, terms: found.terms, experimentId: verdict.experiment.id, pairs: verdict.state.pairs, decidedAtPair: verdict.state.decidedAtPair, decidedAt },
      };
    }
  }
  // An experiment once said no, so replication alone does not make it confirmed.
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
  };
}
