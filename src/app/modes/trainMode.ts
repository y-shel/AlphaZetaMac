import type { Settings } from '../../data/settings';
import { createRng } from '../../domain/rng';
import type { Finding } from '../../engine/findings/finding';
import type { LevelModel } from '../../engine/stage1/levelModel';
import { canTrain, trainSource, type TrainPlan } from '../../engine/train/draw';
import type { DrillController, DrillStart } from '../drill/DrillRound';
import { Round, type Draw } from '../drill/round';
import { SessionWriter, type SaveRound } from './sessionWriter';

export const TRAIN_NEEDS_LEVEL = 'Take the test or play 100 problems first, so training can be set to your level.';
export const TRAIN_NO_FOCUS = 'Nothing to focus on yet.';

/**
 * What a Train round draws from, out of the analysis and the settings (spec 22.3). null
 * when there is no level model, or it fits none of the enabled operations: Train is off.
 *
 * A finding is a focus target when it is suspected or confirmed, its terms can hold for a
 * problem on its own, and it costs score points. Its weight is those score points.
 */
export function trainPlan(analysis: { level: LevelModel | null; findings: readonly Finding[] } | null, settings: Settings): TrainPlan | null {
  const level = analysis?.level ?? null;
  if (analysis === null || level === null || !canTrain(level, settings.params)) return null;
  const findings = analysis.findings
    .filter((f) => (f.tier === 'suspected' || f.tier === 'confirmed') && f.testable && f.scorePoints > 0 && f.terms.length > 0)
    .map((f) => ({ lead: f.terms[0]!, weight: f.scorePoints }));
  return { level, params: settings.params, difficultyPct: settings.train.difficultyPct, focus: settings.train.focus, findings };
}

/**
 * A Train round (spec 22.3): timed like Normal, session mode train, each problem tagged
 * with its own draw's mode, train or calibration. Round asks for a problem inside keydown,
 * so the next one is drawn ahead of time, after each completed problem, and on the spot
 * only if none is ready. Either way the problems are the same for a seed.
 */
export function trainController(settings: Settings, plan: TrainPlan, save: SaveRound | null, s: DrillStart): DrillController {
  const source = trainSource(plan, createRng(s.seed));
  const draw = (): Draw => {
    const d = source.next();
    return { problem: d.problem, tag: { mode: d.mode } };
  };
  let pending: Draw | null = null;
  const round = new Round(() => {
    const next = pending ?? draw();
    pending = null;
    return next;
  }, s.startedAt);
  pending = draw();
  const writer = new SessionWriter(
    round,
    settings.params,
    // Every problem carries its own tag. The default is the one that never feeds the level model.
    { sessionMode: 'train', trialMode: 'train', durationS: settings.durationS },
    s.startedAt,
    { sessionId: s.newId(s.epochOffset + s.startedAt), save, timeOrigin: s.epochOffset, newId: s.newId },
  );
  const deadline = s.startedAt + settings.durationS * 1000;
  return {
    round,
    writer,
    deadline,
    status: (now) => `Seconds left: ${Math.max(0, Math.ceil((deadline - now) / 1000))}`,
    over: (now) => now >= deadline,
    afterComplete: () => {
      pending ??= draw();
    },
  };
}
