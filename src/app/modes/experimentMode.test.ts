import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../data/settings';
import { defaultParams } from '../../domain/operations/registry';
import type { Experiment, Problem, Trial } from '../../domain/types';
import { simulateTrials, typicalUser } from '../../engine/__sim__/simUser';
import { experimentPairs } from '../../engine/confirm/experiment';
import { EPROCESS_MAX_PAIRS, EXPERIMENT_MIN_BUILDABLE_PAIRS } from '../../engine/constants';
import { observations } from '../../engine/features';
import type { Finding } from '../../engine/findings/finding';
import { fitLevelModel } from '../../engine/stage1/levelModel';
import type { DrillStart } from '../drill/DrillRound';
import { termHolds } from '../../engine/confirm/pairs';
import { findingId } from '../../engine/findings/finding';
import { chooseExperiment, experimentController, prepareExperiment, UPDATING, type ExperimentPlan } from './experimentMode';

const level = (() => {
  const { trials } = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 3, trialsPerSession: 100, seed: 11 });
  const fit = fitLevelModel(observations(trials));
  if (fit.kind !== 'ok') throw new Error(fit.reason);
  return fit.model;
})();

const params = defaultParams();
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f-1',
  terms: ['contains_8'],
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

let counter = 0;
const newId = (ms: number) => `id-${ms}-${counter++}`;
const prepare = (over: Partial<Parameters<typeof prepareExperiment>[0]> = {}) =>
  prepareExperiment({ finding: finding(), level, params, existing: null, priorTrials: [], seed: 5, now: 1000, newId, ...over });

function ok(r: ReturnType<typeof prepareExperiment>) {
  if (r.kind !== 'ok') throw new Error(r.reason);
  return r;
}

const start = (seed: number): DrillStart => ({ startedAt: 0, epochOffset: 1_727_600_000_000, seed, newId });

const isTreatment = (plan: ExperimentPlan, p: Problem) =>
  plan.pairs.some((pair) => pair.treatment.operands.join() === p.operands.join() && pair.treatment.opId === p.opId);

/** Answers pairs, treatment after treatmentMs and control after controlMs. Returns the saved trials. */
const clocks = new WeakMap<object, number>();
function play(c: ReturnType<typeof experimentController>, plan: ExperimentPlan, pairs: number, treatmentMs: number, controlMs: number) {
  let t = clocks.get(c) ?? 1000;
  for (let i = 0; i < pairs * 2 && !c.over(t); i++) {
    const ms = isTreatment(plan, c.round.problem) ? treatmentMs : controlMs;
    const answer = String(c.round.problem.answer);
    c.round.key(answer[0]!, (t += ms));
    for (const k of answer.slice(1)) c.round.key(k, (t += 5));
    if (i % 2 === 1) c.afterComplete?.();
  }
  clocks.set(c, t);
  return t;
}

describe('prepareExperiment', () => {
  it('starts a new experiment on the finding terms, and builds pairs', () => {
    const r = ok(prepare());
    expect(r.isNew).toBe(true);
    expect(r.experiment).toEqual({ id: 'id-1000-' + (counter - 1), terms: ['contains_8'], createdAt: 1000 });
    expect(r.pairs).toHaveLength(EPROCESS_MAX_PAIRS);
    expect(r.prior).toEqual([]);
  });

  it('reuses an open experiment and reads its earlier pairs from the log', async () => {
    const prepared = ok(prepare());
    const first: ExperimentPlan = { ...prepared, level };
    const saved: Trial[] = [];
    const settings = defaultSettings();
    const c = experimentController(settings, (_s, _session, trials) => (saved.push(...trials), Promise.resolve()), start(1), first);
    // Four pairs, then a fifth whose control is left unanswered.
    play(c, first, 4, 800, 800);
    const mid = String(c.round.problem.answer);
    c.round.key(mid, 99_999);
    await c.writer.flush(100_000);
    const existing: Experiment = prepared.experiment;
    const again = ok(prepare({ existing, priorTrials: saved, finding: finding({ experiment: { id: existing.id, outcome: 'open', pairs: 4, decidedAtPair: null } }) }));
    expect(again.isNew).toBe(false);
    expect(again.experiment).toBe(existing);
    expect(again.prior).toEqual(experimentPairs(saved, level));
    expect(again.prior).toHaveLength(4);
  });

  it('cannot test a finding that depends on what came before it', () => {
    expect(prepare({ finding: finding({ testable: false }) })).toEqual({
      kind: 'cannot-test',
      reason: 'This kind of finding depends on what came before it in the round, so it cannot be tested this way.',
    });
  });

  it('cannot test when the settings give too few of these problems', () => {
    const noMul = { ...params, enabled: { ...params.enabled, mul: false } };
    const r = prepare({ finding: finding({ terms: ['op_mul'] }), params: noMul });
    expect(r).toEqual({ kind: 'cannot-test', reason: 'Your current settings do not produce enough of these problems to test this.' });
    expect(EXPERIMENT_MIN_BUILDABLE_PAIRS).toBeGreaterThan(0);
  });
});

describe('experimentController', () => {
  const plan: ExperimentPlan = { ...ok(prepare()), level };

  it('tags every problem with the experiment and an arm, and numbers pairs from 0', async () => {
    const saved: Trial[] = [];
    const c = experimentController(defaultSettings(), (_s, session, trials) => {
      expect(session.mode).toBe('experiment');
      expect(session.durationS).toBeNull();
      saved.push(...trials);
      return Promise.resolve();
    }, start(3), plan);
    expect(c.deadline).toBe(Infinity);
    const t = play(c, plan, 6, 500, 500);
    await c.writer.flush(t);
    expect(saved).toHaveLength(12);
    for (const [i, tr] of saved.entries()) {
      expect(tr.mode).toBe('experiment');
      if (tr.mode !== 'experiment') throw new Error('unreachable');
      expect(tr.experimentId).toBe(plan.experiment.id);
      expect(tr.indexInSession).toBe(i);
    }
    // Each pair is one treatment and one control, and they match the plan's pair k.
    for (let k = 0; k < 6; k++) {
      const arms = [saved[2 * k], saved[2 * k + 1]].map((tr) => (tr!.mode === 'experiment' ? tr!.arm : 'none'));
      expect([...arms].sort()).toEqual(['control', 'treatment']);
      const treated = saved[2 * k]!.mode === 'experiment' && (saved[2 * k] as { arm: string }).arm === 'treatment' ? saved[2 * k]! : saved[2 * k + 1]!;
      expect(treated.operands).toEqual(plan.pairs[k]!.treatment.operands);
    }
  });

  it('puts the arms in both orders across pairs, and the same way for the same seed', () => {
    const orders = (seed: number) => {
      const c = experimentController(defaultSettings(), null, start(seed), plan);
      const out: boolean[] = [];
      for (let k = 0; k < 20; k++) {
        out.push(isTreatment(plan, c.round.problem));
        play(c, plan, 1, 500, 500);
      }
      return out;
    };
    const a = orders(4);
    expect(a.some((x) => x)).toBe(true);
    expect(a.some((x) => !x)).toBe(true);
    expect(orders(4)).toEqual(a);
  });

  it('counts pairs in the banner', () => {
    const c = experimentController(defaultSettings(), null, start(6), plan);
    expect(c.status(0)).toBe('Pair 1 / 60');
    play(c, plan, 1, 500, 500);
    expect(c.status(0)).toBe('Pair 2 / 60');
    play(c, plan, 1, 500, 500);
    // Half a pair does not move the count.
    c.round.key(String(c.round.problem.answer), 100_000);
    expect(c.status(0)).toBe('Pair 3 / 60');
  });

  it('ends when slow treatments and fast controls cross the e-value', () => {
    const c = experimentController(defaultSettings(), null, start(7), plan);
    expect(c.over(0)).toBe(false);
    play(c, plan, EPROCESS_MAX_PAIRS, 1500, 300);
    expect(c.state().outcome).toBe('confirmed');
    expect(c.state().pairs).toBeLessThan(EPROCESS_MAX_PAIRS);
    expect(c.over(0)).toBe(true);
  });

  it('counts the pairs of earlier rounds toward the decision', () => {
    const slowTreatment = { d: 1, se: 0.01 };
    const fresh = experimentController(defaultSettings(), null, start(8), plan);
    play(fresh, plan, 2, 1500, 300);
    expect(fresh.state().outcome).toBe('open');
    const withPrior = experimentController(defaultSettings(), null, start(8), { ...plan, prior: Array.from({ length: 5 }, () => slowTreatment) });
    play(withPrior, plan, 2, 1500, 300);
    expect(withPrior.state().outcome).toBe('confirmed');
    expect(withPrior.state().pairs).toBe(7);
    expect(withPrior.over(0)).toBe(true);
  });

  it('stays open and keeps going while the evidence is flat, and ends when the pairs run out', () => {
    const c = experimentController(defaultSettings(), null, start(9), plan);
    play(c, plan, 3, 400, 400);
    expect(c.state().outcome).toBe('open');
    expect(c.state().pairs).toBe(3);
    expect(c.over(0)).toBe(false);
  });

  it('ends when every pair is answered and the evidence is still undecided', () => {
    const c = experimentController(defaultSettings(), null, start(11), plan);
    // A small gap one way and the other, so neither e-process gets anywhere.
    const answerPairs = (from: number, to: number) => {
      for (let k = from; k < to; k++) play(c, plan, 1, k % 2 === 0 ? 500 : 300, k % 2 === 0 ? 300 : 500);
    };
    answerPairs(0, plan.pairs.length - 1);
    expect(c.state().outcome).toBe('open');
    expect(c.over(0)).toBe(false);
    answerPairs(plan.pairs.length - 1, plan.pairs.length);
    expect(c.state().outcome).toBe('open');
    expect(c.state().pairs).toBe(plan.pairs.length);
    expect(c.over(0)).toBe(true);
  });

  it('ends when the user quits, mid pair or not', () => {
    const c = experimentController(defaultSettings(), null, start(10), plan);
    play(c, plan, 1, 400, 400);
    c.round.key(String(c.round.problem.answer), 50_000);
    expect(c.over(0)).toBe(false);
    c.quit?.();
    expect(c.over(0)).toBe(true);
    expect(c.state().pairs).toBe(1);
  });
});

describe('prepareExperiment, continuing', () => {
  it("builds the pairs from the experiment's own terms, not the finding's current ones", () => {
    const existing: Experiment = { id: 'x1', terms: ['carry_required'], createdAt: 0 };
    const r = ok(prepare({ finding: finding({ terms: ['contains_8'] }), existing }));
    expect(r.experiment).toBe(existing);
    expect(r.pairs.length).toBeGreaterThan(0);
    for (const pair of r.pairs) {
      expect(termHolds('carry_required', pair.treatment)).toBe(true);
      expect(termHolds('carry_required', pair.control)).toBe(false);
    }
  });
});

describe('chooseExperiment', () => {
  const terms = ['contains_8'];
  const f = (experiment: Finding['experiment']) => finding({ id: findingId(terms), terms, experiment });
  const x = (id: string, createdAt: number, t = terms): Experiment => ({ id, terms: t, createdAt });
  const open = (id: string) => ({ id, outcome: 'open' as const, pairs: 4, decidedAtPair: null });

  it('starts a new experiment when none is stored for the finding', () => {
    expect(chooseExperiment(f(null), [])).toEqual({ kind: 'new' });
    expect(chooseExperiment(f(null), [x('other', 5, ['carry_required'])])).toEqual({ kind: 'new' });
  });

  it('continues the open experiment the snapshot shows', () => {
    const stored = x('x1', 5);
    expect(chooseExperiment(f(open('x1')), [stored, x('other', 9, ['carry_required'])])).toEqual({ kind: 'continue', experiment: stored });
  });

  it('starts a new one after a ruled-out experiment the snapshot already shows', () => {
    expect(chooseExperiment(f({ id: 'x1', outcome: 'ruled-out', pairs: 90, decidedAtPair: 90 }), [x('x1', 5)])).toEqual({ kind: 'new' });
  });

  it('waits when the store has a newer experiment than the snapshot knows of', () => {
    expect(chooseExperiment(f(null), [x('x1', 5)])).toEqual({ kind: 'wait', reason: UPDATING });
    expect(chooseExperiment(f(open('x1')), [x('x1', 5), x('x2', 6)])).toEqual({ kind: 'wait', reason: UPDATING });
    expect(UPDATING).toBe('Results are updating. Try again in a moment.');
  });

  it('breaks a tie in createdAt by the larger id, as the analysis does', () => {
    expect(chooseExperiment(f(open('x2')), [x('x2', 5), x('x1', 5)])).toEqual({ kind: 'continue', experiment: x('x2', 5) });
    expect(chooseExperiment(f(open('x1')), [x('x2', 5), x('x1', 5)])).toEqual({ kind: 'wait', reason: UPDATING });
  });
});
