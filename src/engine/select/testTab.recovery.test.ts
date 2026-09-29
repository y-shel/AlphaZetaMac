import { describe, expect, it } from 'vitest';
import { defaultParams, operations } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { normal, respond, trueMean, typicalUser } from '../__sim__/simUser';
import { TEST_TAB_ITEMS, TEST_TAB_MIN_ITEMS } from '../constants';
import { logTime, type Obs } from '../features';
import { fitLevelModel, predict } from '../stage1/levelModel';
import { DOptimalDesign, sampleCandidates, testSpace } from './dOptimal';
import { testProgress, type TestProgress } from './stopping';

/** Runs one simulated Test tab from scratch. */
function runTest(sigma: number, seed: number) {
  const rng = createRng(seed);
  const jitter = () => 0.15 * normal(rng);
  const user = typicalUser({
    alpha: { add: 5.8 + jitter(), sub: 6.0 + jitter(), mul: 5.7 + jitter(), div: 5.9 + jitter() },
    sigma,
    sessionSd: 0,
  });
  const opIds = operations.map((o) => o.id);
  const space = testSpace(defaultParams());
  const design = new DOptimalDesign(opIds);
  const obs: Obs[] = [];
  let progress: TestProgress = 'continue';
  while (progress === 'continue') {
    const problem = design.choose(sampleCandidates(space, rng));
    design.add(problem);
    obs.push({ problem, y: logTime(respond(user, problem, 0, rng).firstKeyMs), sessionId: 'test' });
    progress = testProgress(obs, opIds);
  }
  const fit = fitLevelModel(obs);
  if (fit.kind !== 'ok') throw new Error(fit.reason);
  // Prediction error over problems from the default settings, which the user will play.
  const errors = sampleCandidates(defaultParams(), createRng(1), 200).map((p) => Math.abs(predict(fit.model, p) - trueMean(user, p)));
  return { items: obs.length, progress, errors };
}

describe('Test tab: recovery', () => {
  it('a typical user ends within 100 items with predictions close to the truth', () => {
    const errors: number[] = [];
    for (let seed = 0; seed < 50; seed++) {
      const run = runTest(0.25, 7000 + seed);
      expect(run.items).toBeGreaterThanOrEqual(TEST_TAB_MIN_ITEMS);
      expect(run.items).toBeLessThanOrEqual(TEST_TAB_ITEMS);
      errors.push(...run.errors);
    }
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.06);
    expect(errors[Math.floor(errors.length * 0.9)]).toBeLessThan(0.15);
  });

  it('a consistent user converges and stops early', () => {
    let early = 0;
    for (let seed = 0; seed < 50; seed++) {
      const run = runTest(0.15, 8000 + seed);
      if (run.progress === 'converged' && run.items < TEST_TAB_ITEMS) early++;
    }
    expect(early).toBeGreaterThanOrEqual(45);
  });
});
