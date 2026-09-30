import type { Settings } from '../../data/settings';
import { createProblemSource } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import type { DrillController, DrillStart } from '../drill/DrillRound';
import { Round } from '../drill/round';
import { SessionWriter, type SaveRound } from './sessionWriter';

/** Plain Zetamac (spec 22.1): a timed round, trials tagged normal. */
export function normalController(settings: Settings, save: SaveRound | null, s: DrillStart): DrillController {
  const round = new Round(createProblemSource(settings.params, createRng(s.seed)), s.startedAt);
  const writer = new SessionWriter(
    round,
    settings.params,
    { sessionMode: 'normal', trialMode: 'normal', durationS: settings.durationS },
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
  };
}
