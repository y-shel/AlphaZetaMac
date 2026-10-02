import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../data/settings';
import type { Session, Trial } from '../../domain/types';
import { trueModel, typicalUser } from '../../engine/__sim__/simUser';
import type { Finding } from '../../engine/findings/finding';
import type { TrainPlan } from '../../engine/train/draw';
import type { DrillController, DrillStart } from '../drill/DrillRound';
import { trainController, trainPlan } from './trainMode';

const level = trueModel(typicalUser());
const settings = { ...defaultSettings(), durationS: 30 as const };
const plan: TrainPlan = { level, params: settings.params, difficultyPct: 80, focus: 0.5, findings: [{ lead: 'contains_8', weight: 2 }] };
const start = (seed: number): DrillStart => ({ startedAt: 1000, epochOffset: 1_727_600_000_000, seed, newId: (ms) => `id-${ms}` });

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f-1',
  terms: ['contains_8', 'contains_7'],
  tier: 'suspected',
  effectLogT: 0.2,
  effectSdLogT: 0.05,
  effectMs: 300,
  prevalence: 0.3,
  prevalenceEstimated: false,
  scorePoints: 3,
  scorePointsLow: 1,
  scorePointsHigh: 4,
  nTrials: 80,
  discoveredAt: 0,
  replicated: false,
  testable: true,
  experiment: null,
  ...over,
});

/** Answers n problems, 400 ms each. prepare says whether the drill got to run afterComplete in between. */
function play(c: DrillController, n: number, prepare: boolean): string[] {
  const shown: string[] = [];
  let t = 1000;
  for (let i = 0; i < n; i++) {
    shown.push(c.round.problemText);
    const answer = String(c.round.problem.answer);
    c.round.key(answer[0]!, (t += 400));
    for (const k of answer.slice(1)) c.round.key(k, (t += 5));
    if (prepare) c.afterComplete?.();
  }
  return shown;
}

describe('trainController', () => {
  it('writes each trial tagged train or calibration, in a session of mode train', async () => {
    const saved: Trial[] = [];
    let session: Session | null = null;
    const c = trainController(
      settings,
      plan,
      (_snapshot, s, trials) => {
        session = s;
        saved.push(...trials);
        return Promise.resolve();
      },
      start(3),
    );
    play(c, 200, true);
    await c.writer.flush(31_000);
    expect(saved).toHaveLength(200);
    expect(new Set(saved.map((t) => t.mode))).toEqual(new Set(['train', 'calibration']));
    const calibration = saved.filter((t) => t.mode === 'calibration').length;
    expect(calibration).toBeGreaterThan(30);
    expect(calibration).toBeLessThan(70);
    expect(saved.every((t) => t.experimentId === undefined && t.arm === undefined)).toBe(true);
    expect(session).toMatchObject({ mode: 'train', durationS: 30, score: 200 });
  });

  it('is timed like Normal: the deadline is the duration after the start', () => {
    const c = trainController(settings, plan, null, start(1));
    expect(c.deadline).toBe(31_000);
    expect(c.status(1000)).toBe('Seconds left: 30');
    expect(c.status(2000)).toBe('Seconds left: 29');
    expect(c.over(30_999)).toBe(false);
    expect(c.over(31_000)).toBe(true);
    expect(c.status(40_000)).toBe('Seconds left: 0');
    expect(c.quit).toBeUndefined();
  });

  it('shows the same problems whether the next one was prepared or chosen on the spot', () => {
    const prepared = play(trainController(settings, plan, null, start(7)), 60, true);
    const onTheSpot = play(trainController(settings, plan, null, start(7)), 60, false);
    expect(onTheSpot).toEqual(prepared);
    expect(play(trainController(settings, plan, null, start(8)), 60, true)).not.toEqual(prepared);
  });
});

describe('trainPlan', () => {
  const train = { difficultyPct: 70, focus: 0.25 };
  const withTrain = { ...settings, train };

  it('is null without a snapshot or a level model', () => {
    expect(trainPlan(null, withTrain)).toBeNull();
    expect(trainPlan({ level: null, findings: [] }, withTrain)).toBeNull();
  });

  it('is null when the level model fits none of the enabled operations', () => {
    const enabled = Object.fromEntries(Object.keys(settings.params.enabled).map((id) => [id, false]));
    expect(trainPlan({ level, findings: [] }, { ...withTrain, params: { ...settings.params, enabled } })).toBeNull();
  });

  it('carries the settings, and the leading term and score points of each usable finding', () => {
    const findings = [
      finding(),
      finding({ id: 'f-2', terms: ['carry_required'], tier: 'confirmed', scorePoints: 1.5 }),
      finding({ id: 'f-3', terms: ['borrow_required'], tier: 'insufficient-data' }),
      finding({ id: 'f-4', terms: ['contains_9'], testable: false }),
      finding({ id: 'f-5', terms: ['contains_6'], scorePoints: 0 }),
    ];
    expect(trainPlan({ level, findings }, withTrain)).toEqual({
      level,
      params: settings.params,
      difficultyPct: 70,
      focus: 0.25,
      findings: [
        { lead: 'contains_8', weight: 3 },
        { lead: 'carry_required', weight: 1.5 },
      ],
    });
  });
});
