import type { Settings } from '../../data/settings';
import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import { createRng } from '../../domain/rng';
import type { GeneratorParams, Problem, Rng } from '../../domain/types';
import { TEST_TAB_ITEMS } from '../../engine/constants';
import { logTime, type Obs } from '../../engine/features';
import { medianGapMs } from '../../engine/round/reference';
import { DOptimalDesign, sampleCandidates, testSpace } from '../../engine/select/dOptimal';
import { testProgress, type TestProgress } from '../../engine/select/stopping';
import type { DrillController, DrillStart } from '../drill/DrillRound';
import { Round } from '../drill/round';
import { SessionWriter, type SaveRound } from './sessionWriter';

/**
 * Chooses Test items (spec 22.2). Round calls next() inside keydown, so the choice is made
 * ahead of time by prepare(), which the drill runs after each completed problem.
 */
export class TestSelector {
  readonly space: GeneratorParams;
  readonly opIds: readonly string[];
  progress: TestProgress = 'continue';
  private readonly design: DOptimalDesign;
  private readonly rng: Rng;
  private readonly registry: readonly Operation[];
  private pending: Problem | null = null;

  constructor(params: GeneratorParams, rng: Rng, registry: readonly Operation[] = operations) {
    this.space = testSpace(params, registry);
    this.opIds = registry.filter((op) => params.enabled[op.id] === true).map((op) => op.id);
    this.design = new DOptimalDesign(this.opIds, registry);
    this.rng = rng;
    this.registry = registry;
  }

  /** For Round. Returns the prepared problem, or chooses one now if none is ready. */
  readonly next = (): Problem => {
    const problem = this.pending ?? this.choose();
    this.pending = null;
    this.design.add(problem);
    return problem;
  };

  /** Off the hot path: chooses the next problem and updates progress from the answers so far. */
  prepare(obs: readonly Obs[]): void {
    this.pending ??= this.choose();
    this.progress = testProgress(obs, this.opIds, this.registry);
  }

  private choose(): Problem {
    return this.design.choose(sampleCandidates(this.space, this.rng, undefined, this.registry));
  }
}

/** Level-model observations for the completed problems of a round. */
export function roundObservations(round: Round, sessionId: string): Obs[] {
  return round.completed.map((r) => ({ problem: r.problem, y: logTime(round.keys[r.keyStart]!.t), sessionId }));
}

/** Median gap between keystrokes within completed problems, ms. 0 with none. */
export function roundTypingGapMs(round: Round): number {
  const gaps: number[] = [];
  for (const r of round.completed)
    for (let k = r.keyStart + 1; k < r.keyEnd; k++) gaps.push(round.keys[k]!.t - round.keys[k - 1]!.t);
  return medianGapMs(gaps);
}

export interface TestController extends DrillController {
  selector: TestSelector;
  observations(): Obs[];
  typingGapMs(): number;
  /** True once the user stopped the Test early. */
  stopped(): boolean;
}

/**
 * The Test tab: up to TEST_TAB_ITEMS D-optimal items, trials tagged test, no time limit.
 * The session's parameter snapshot is the user's own params, not the test space. The
 * results screen needs the user's bounds, and the test space is testSpace(params), so
 * both can be rebuilt from the log.
 */
export function testController(settings: Settings, save: SaveRound | null, s: DrillStart): TestController {
  const selector = new TestSelector(settings.params, createRng(s.seed));
  const round = new Round(() => ({ problem: selector.next() }), s.startedAt);
  const sessionId = s.newId(s.epochOffset + s.startedAt);
  const writer = new SessionWriter(
    round,
    settings.params,
    { sessionMode: 'test', trialMode: 'test', durationS: null },
    s.startedAt,
    { sessionId, save, timeOrigin: s.epochOffset, newId: s.newId },
  );
  const observations = () => roundObservations(round, sessionId);
  let quit = false;
  selector.prepare([]);
  return {
    round,
    writer,
    deadline: Infinity,
    status: () => `${Math.min(round.completed.length + 1, TEST_TAB_ITEMS)} / ${TEST_TAB_ITEMS}`,
    over: () => quit || selector.progress !== 'continue',
    afterComplete: () => selector.prepare(observations()),
    quit: () => {
      quit = true;
    },
    selector,
    observations,
    typingGapMs: () => roundTypingGapMs(round),
    stopped: () => quit,
  };
}
