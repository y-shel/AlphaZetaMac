import type { Settings } from '../../data/settings';
import { createRng } from '../../domain/rng';
import type { Arm, Experiment, GeneratorParams, Trial } from '../../domain/types';
import { evaluatePairs, type ExperimentState, type PairEvidence } from '../../engine/confirm/eprocess';
import { experimentPairs } from '../../engine/confirm/experiment';
import { buildPairs, pairEvidence, type MatchedPair } from '../../engine/confirm/pairs';
import { EXPERIMENT_MIN_BUILDABLE_PAIRS } from '../../engine/constants';
import type { Finding } from '../../engine/findings/finding';
import type { LevelModel } from '../../engine/stage1/levelModel';
import type { DrillController, DrillStart } from '../drill/DrillRound';
import { Round, type Draw } from '../drill/round';
import { SessionWriter, type SaveRound } from './sessionWriter';

export const NOT_TESTABLE = 'This kind of finding depends on what came before it in the round, so it cannot be tested this way.';
export const TOO_FEW_PAIRS = 'Your current settings do not produce enough of these problems to test this.';

export type Prepared =
  | { kind: 'ok'; experiment: Experiment; isNew: boolean; pairs: MatchedPair[]; prior: PairEvidence[] }
  | { kind: 'cannot-test'; reason: string };

/**
 * Everything a round of an experiment needs, before it starts (spec 14.1). Pure: the time,
 * the seed and the id source come in. existing is the finding's open experiment, or null
 * for a new one. priorTrials are the trials of existing, and prior is the evidence of the
 * pairs they hold. Nothing here runs while a round is in progress.
 */
export function prepareExperiment(args: {
  finding: Finding;
  level: LevelModel;
  params: GeneratorParams;
  existing: Experiment | null;
  priorTrials: readonly Trial[];
  seed: number;
  now: number;
  newId: (ms: number) => string;
}): Prepared {
  const { finding, level, params, existing, priorTrials, seed, now, newId } = args;
  if (!finding.testable) return { kind: 'cannot-test', reason: NOT_TESTABLE };
  const pairs = buildPairs(level, params, finding.terms, seed);
  if (pairs.length < EXPERIMENT_MIN_BUILDABLE_PAIRS) return { kind: 'cannot-test', reason: TOO_FEW_PAIRS };
  const experiment = existing ?? { id: newId(now), terms: [...finding.terms], createdAt: now };
  const prior = existing === null ? [] : experimentPairs(priorTrials, level);
  return { kind: 'ok', experiment, isNew: existing === null, pairs, prior };
}

/** What prepareExperiment gave, plus the level model the answers are judged against. */
export interface ExperimentPlan {
  experiment: Experiment;
  pairs: readonly MatchedPair[];
  prior: readonly PairEvidence[];
  level: LevelModel;
}

export interface ExperimentController extends DrillController {
  /** Where the experiment stands: the earlier pairs and this round's, in order. */
  state(): ExperimentState;
  /** True once the user stopped the round early. */
  stopped(): boolean;
}

/**
 * A round of matched pairs (spec 14.1). Pair k is the problems at places 2k and 2k + 1 of the
 * session, one per arm in an order drawn from the seed. The whole draw is made here, so
 * nothing is chosen while a key is down. After each completed pair, afterComplete reads the
 * evidence again. The round ends when the test is decided, the pairs run out, or the user quits.
 */
export function experimentController(
  settings: Settings,
  save: SaveRound | null,
  s: DrillStart,
  plan: ExperimentPlan,
): ExperimentController {
  const rng = createRng(s.seed);
  const treatmentFirst = plan.pairs.map(() => rng.next() < 0.5);
  const tagOf = (arm: Arm): Draw['tag'] => ({ mode: 'experiment', experimentId: plan.experiment.id, arm });
  const draws: Draw[] = plan.pairs.flatMap((pair, k) => {
    const t: Draw = { problem: pair.treatment, tag: tagOf('treatment') };
    const c: Draw = { problem: pair.control, tag: tagOf('control') };
    return treatmentFirst[k] === true ? [t, c] : [c, t];
  });
  let drawn = 0;
  // Past the last pair the round is over, so the problem shown after it is never answered.
  const round = new Round(() => ({ ...draws[Math.min(drawn++, draws.length - 1)]! }), s.startedAt);
  const writer = new SessionWriter(
    round,
    settings.params,
    // Every problem carries its own tag. The default is one that never feeds the level model.
    { sessionMode: 'experiment', trialMode: 'train', durationS: null },
    s.startedAt,
    { sessionId: s.newId(s.epochOffset + s.startedAt), save, timeOrigin: s.epochOffset, newId: s.newId },
  );

  const fresh: PairEvidence[] = [];
  let current = evaluatePairs(plan.prior);
  const firstKeyMs = (place: number) => round.keys[round.completed[place]!.keyStart]!.t;
  function refresh(): void {
    const done = Math.floor(round.completed.length / 2);
    if (done === fresh.length) return;
    for (let k = fresh.length; k < done; k++) {
      const first = firstKeyMs(2 * k);
      const second = firstKeyMs(2 * k + 1);
      const [treatmentMs, controlMs] = treatmentFirst[k] === true ? [first, second] : [second, first];
      fresh.push(pairEvidence(plan.level, plan.pairs[k]!, treatmentMs, controlMs));
    }
    current = evaluatePairs([...plan.prior, ...fresh]);
  }

  let quit = false;
  const total = plan.pairs.length;
  return {
    round,
    writer,
    deadline: Infinity,
    status: () => `Pair ${Math.min(Math.floor(round.completed.length / 2) + 1, total)} / ${total}`,
    over: () => quit || round.completed.length >= 2 * total || (refresh(), current.outcome !== 'open'),
    afterComplete: refresh,
    quit: () => {
      quit = true;
    },
    state: () => (refresh(), current),
    stopped: () => quit,
  };
}
