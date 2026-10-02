import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { trueModel, typicalUser } from '../__sim__/simUser';
import { termHolds } from '../confirm/pairs';
import { DERIVE_SAMPLES, MATCH_TOLERANCE_LOG_T } from '../constants';
import { predictedLogTimes, quantile } from '../params/derive';
import { predict } from '../stage1/levelModel';
import { trainSource, type TrainDraw, type TrainPlan } from './draw';

const N = 8000;
const level = trueModel(typicalUser());
const params = defaultParams();
const plan = (over: Partial<TrainPlan> = {}): TrainPlan => ({ level, params, difficultyPct: 80, focus: 0.5, findings: [], ...over });
const two = [
  { lead: 'contains_8', weight: 2 },
  { lead: 'contains_7&op_mul', weight: 1 },
];

function draws(p: TrainPlan, seed: number, n = N): { target: number; all: TrainDraw[]; train: TrainDraw[] } {
  const source = trainSource(p, createRng(seed));
  const all = Array.from({ length: n }, () => source.next());
  return { target: source.target, all, train: all.filter((d) => d.mode === 'train') };
}

const gap = (d: TrainDraw, target: number) => Math.abs(predict(level, d.problem) - target);

describe('trainSource', () => {
  it('takes the difficulty percentile of the predicted log times as its target', () => {
    for (const pct of [50, 80, 95]) {
      const expected = quantile(predictedLogTimes(level, params, 1, DERIVE_SAMPLES), pct / 100);
      expect(trainSource(plan({ difficultyPct: pct }), createRng(1)).target).toBe(expected);
    }
  });

  it('makes about a quarter of the draws calibration draws', () => {
    for (const p of [plan(), plan({ findings: two }), plan({ difficultyPct: 95 })]) {
      const { all, train } = draws(p, 5);
      const share = (all.length - train.length) / all.length;
      expect(share).toBeGreaterThan(0.23);
      expect(share).toBeLessThan(0.27);
      expect(all.every((d) => d.mode === 'train' || d.mode === 'calibration')).toBe(true);
    }
  });

  it('focuses half of the train draws at focus 0.5, each on a problem its term holds for', () => {
    const { all, train } = draws(plan({ findings: two }), 5);
    const focused = train.filter((d) => d.focused !== null);
    const share = focused.length / train.length;
    expect(share).toBeGreaterThan(0.46);
    expect(share).toBeLessThan(0.54);
    for (const d of focused) expect(termHolds(d.focused!, d.problem)).toBe(true);
    expect(all.filter((d) => d.mode === 'calibration').every((d) => d.focused === null)).toBe(true);
  });

  it('follows the focus setting', () => {
    expect(draws(plan({ findings: two, focus: 0 }), 5).train.every((d) => d.focused === null)).toBe(true);
    // At focus 1 a draw is broad only when its term did not turn up in all the tries.
    const { train } = draws(plan({ findings: two, focus: 1 }), 5);
    expect(train.filter((d) => d.focused !== null).length / train.length).toBeGreaterThan(0.98);
  });

  it('focuses nothing when there are no findings', () => {
    expect(draws(plan(), 5).all.every((d) => d.focused === null)).toBe(true);
  });

  it('puts at least 85% of broad train draws within the tolerance of the target at difficulty 80', () => {
    for (const seed of [5, 6, 7]) {
      const { target, train } = draws(plan(), seed);
      const within = train.filter((d) => gap(d, target) <= MATCH_TOLERANCE_LOG_T).length / train.length;
      expect(within).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('picks findings in proportion to their weights', () => {
    const { train } = draws(plan({ findings: two }), 5);
    const count = (lead: string) => train.filter((d) => d.focused === lead).length;
    const ratio = count('contains_8') / count('contains_7&op_mul');
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it('gives a broad draw when no problem with the picked term turns up', () => {
    // No multiplication is drawn, so the term never holds.
    const off = { ...params, enabled: { ...params.enabled, mul: false } };
    const { train } = draws(plan({ params: off, findings: [{ lead: 'contains_7&op_mul', weight: 1 }], focus: 1 }), 5, 200);
    expect(train.length).toBeGreaterThan(100);
    expect(train.every((d) => d.focused === null)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const p = plan({ findings: two });
    expect(draws(p, 9, 500).all).toEqual(draws(p, 9, 500).all);
    expect(draws(p, 9, 500).all).not.toEqual(draws(p, 10, 500).all);
  });

  it('draws calibration problems as Normal does, whatever the target', () => {
    const broadMedian = quantile(predictedLogTimes(level, params, 1, DERIVE_SAMPLES), 0.5);
    for (const pct of [50, 95]) {
      const { target, all, train } = draws(plan({ difficultyPct: pct }), 5);
      const calibration = all.filter((d) => d.mode === 'calibration');
      const median = quantile(
        calibration.map((d) => predict(level, d.problem)),
        0.5,
      );
      expect(Math.abs(median - broadMedian)).toBeLessThan(0.05);
      const near = (ds: TrainDraw[]) => ds.filter((d) => gap(d, target) <= MATCH_TOLERANCE_LOG_T).length / ds.length;
      // A draw that ignores the target lands near it far less often than one that aims for it.
      expect(near(calibration)).toBeLessThan(near(train) / 2);
    }
  });

  it('skips an unfitted operation in train draws and allows it in calibration draws', () => {
    const user = typicalUser();
    const fitted = trueModel({ ...user, alpha: { add: user.alpha.add!, sub: user.alpha.sub! }, beta: { add: user.beta.add!, sub: user.beta.sub! } });
    const source = trainSource(plan({ level: fitted }), createRng(5));
    const enabled = { ...params.enabled, mul: false, div: false };
    expect(source.target).toBe(quantile(predictedLogTimes(fitted, { ...params, enabled }, 1, DERIVE_SAMPLES), 0.8));
    const all = Array.from({ length: 2000 }, () => source.next());
    const opsOf = (mode: string) => new Set(all.filter((d) => d.mode === mode).map((d) => d.problem.opId));
    expect(opsOf('train')).toEqual(new Set(['add', 'sub']));
    expect(opsOf('calibration')).toEqual(new Set(['add', 'sub', 'mul', 'div']));
  });

  it('throws when the level model fits none of the enabled operations', () => {
    const none = { ...params, enabled: { add: false, sub: false, mul: true, div: true } };
    const user = typicalUser();
    const fitted = trueModel({ ...user, alpha: { add: user.alpha.add! }, beta: { add: user.beta.add! } });
    expect(() => trainSource(plan({ level: fitted, params: none }), createRng(1))).toThrow('the model fits none of the enabled operations');
  });
});
