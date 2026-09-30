import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
import type { Problem } from '../../domain/types';
import { TEST_GAMMA_SE_THRESHOLD, TEST_PRED_SE_THRESHOLD, TEST_TAB_ITEMS, TEST_TAB_MIN_ITEMS } from '../constants';
import { sizeOf, type Obs } from '../features';
import { fitLevelModel, gammaSe, predictionSe } from '../stage1/levelModel';

export type TestProgress = 'continue' | 'converged' | 'limit';

/**
 * Whether the Test tab should stop (spec 22.2). Below TEST_TAB_MIN_ITEMS it always
 * continues. From there on it returns 'converged' once the fit passes the check in
 * `converged`. At TEST_TAB_ITEMS the Test ends either way: 'converged' if the check passes,
 * 'limit' if not, so the results screen can say how well the level was measured.
 */
export function testProgress(obs: readonly Obs[], opIds: readonly string[], registry: readonly Operation[] = operations): TestProgress {
  if (obs.length < TEST_TAB_MIN_ITEMS) return 'continue';
  if (converged(obs, opIds, registry)) return 'converged';
  return obs.length >= TEST_TAB_ITEMS ? 'limit' : 'continue';
}

/**
 * True when every operation in opIds is fitted, the predicted log time of its observed
 * problems with the smallest and largest size has a standard error below
 * TEST_PRED_SE_THRESHOLD, and gamma's is below TEST_GAMMA_SE_THRESHOLD. The standard error
 * of a prediction includes gamma, so it is taken at a real problem, not at a bare size.
 */
function converged(obs: readonly Obs[], opIds: readonly string[], registry: readonly Operation[]): boolean {
  const fit = fitLevelModel(obs, undefined, registry);
  if (fit.kind !== 'ok') return false;
  const { model } = fit;
  if (gammaSe(model) >= TEST_GAMMA_SE_THRESHOLD) return false;
  for (const opId of opIds) {
    if (!model.opIds.includes(opId)) return false;
    let lo: Problem | null = null;
    let hi: Problem | null = null;
    let loSize = Infinity;
    let hiSize = -Infinity;
    for (const o of obs) {
      if (o.problem.opId !== opId) continue;
      const s = sizeOf(o.problem, registry);
      if (s < loSize) [lo, loSize] = [o.problem, s];
      if (s > hiSize) [hi, hiSize] = [o.problem, s];
    }
    if (lo === null || hi === null) return false;
    if (predictionSe(model, lo, registry) >= TEST_PRED_SE_THRESHOLD) return false;
    if (predictionSe(model, hi, registry) >= TEST_PRED_SE_THRESHOLD) return false;
  }
  return true;
}
