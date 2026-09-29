import { operations } from '../../domain/operations/registry';
import type { Operation } from '../../domain/operations/types';
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
 * True when every operation in opIds is fitted, its predicted log time at the smallest and
 * largest sizes it was tested at has a standard error below TEST_PRED_SE_THRESHOLD, and
 * gamma's is below TEST_GAMMA_SE_THRESHOLD.
 */
function converged(obs: readonly Obs[], opIds: readonly string[], registry: readonly Operation[]): boolean {
  const fit = fitLevelModel(obs, undefined, registry);
  if (fit.kind !== 'ok') return false;
  const { model } = fit;
  if (gammaSe(model) >= TEST_GAMMA_SE_THRESHOLD) return false;
  for (const opId of opIds) {
    if (!model.opIds.includes(opId)) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const o of obs) {
      if (o.problem.opId !== opId) continue;
      const s = sizeOf(o.problem, registry);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    if (predictionSe(model, opId, lo) >= TEST_PRED_SE_THRESHOLD) return false;
    if (predictionSe(model, opId, hi) >= TEST_PRED_SE_THRESHOLD) return false;
  }
  return true;
}
