import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../domain/operations/registry';
import type { Trial } from '../../domain/types';
import { makeTrial } from '../../test/fixtures';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { STAGE1_MIN_TRIALS, STAGE2_MAX_LAPSE_RESP } from '../constants';
import { levelTrials, logTime } from '../features';
import { ewmaWeights } from '../stage1/levelModel';
import { predictedLogT, selectRows, sessionHalves, stage2Rows, type Stage2Rows } from './rows';

/** Level trials a to e with first-key times 500, 600, 700, 800 and 900 ms. */
function fiveTrials() {
  return levelTrials(['a', 'b', 'c', 'd', 'e'].map((id, i) => makeTrial({ id, keystrokes: [{ k: '5', t: 500 + 100 * i }] })));
}

/** Rows over the given trials, with nothing else filled in. */
function rowsOf(trials: readonly Trial[]): Stage2Rows {
  const n = trials.length;
  return { trials, residual: new Float64Array(n), weight: new Float64Array(n), logT: new Float64Array(n), all: trials.map((_, r) => r) };
}

describe('selectRows', () => {
  it('drops a NaN residual and a lapse responsibility above the limit, and keeps the rest in order', () => {
    const level = fiveTrials();
    const cf = {
      kind: 'ok' as const,
      residual: Float64Array.from([0.1, Number.NaN, 0.3, 0.4, 0.5]),
      lapseResp: Float64Array.from([0, Number.NaN, 0.51, STAGE2_MAX_LAPSE_RESP, 0.2]),
    };
    const weights = Float64Array.from([1, 2, 3, 4, 5]);
    const rows = selectRows(level, cf, weights);
    expect(rows.trials.map((t) => t.id)).toEqual(['a', 'd', 'e']);
    expect([...rows.residual]).toEqual([0.1, 0.4, 0.5]);
    expect([...rows.weight]).toEqual([1, 4, 5]);
    expect([...rows.logT]).toEqual([Math.log(500), Math.log(800), Math.log(900)]);
    expect(rows.all).toEqual([0, 1, 2]);
  });

  it('drops a row whose residual is NaN even when its lapse responsibility is not', () => {
    const level = fiveTrials();
    const cf = {
      kind: 'ok' as const,
      residual: Float64Array.from([0.1, Number.NaN, 0.3, 0.4, 0.5]),
      lapseResp: Float64Array.from([0, 0, 0, 0, 0]),
    };
    expect(selectRows(level, cf, ewmaWeights(5)).trials.map((t) => t.id)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('gives each kept row the weight of its position in the full sequence', () => {
    const level = fiveTrials();
    const cf = {
      kind: 'ok' as const,
      residual: Float64Array.from([Number.NaN, 0.2, Number.NaN, 0.4, 0.5]),
      lapseResp: Float64Array.from([0, 0, 0, 0, 0]),
    };
    const w = ewmaWeights(5);
    const rows = selectRows(level, cf, w);
    expect([...rows.weight]).toEqual([w[1], w[3], w[4]]);
    expect([...rows.weight]).not.toEqual([...ewmaWeights(3)]);
  });
});

describe('stage2Rows', () => {
  it('keeps every column aligned with its trial on a simulated log', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 3, trialsPerSession: 100, seed: 11 });
    const result = stage2Rows(levelTrials(sim.trials));
    if (result.kind !== 'ok') throw new Error(result.reason);
    const { rows } = result;
    const n = rows.trials.length;
    expect(n).toBeGreaterThan(200);
    expect(n).toBeLessThanOrEqual(300);
    expect(rows.residual).toHaveLength(n);
    expect(rows.weight).toHaveLength(n);
    expect(rows.logT).toHaveLength(n);
    expect(rows.all).toEqual(Array.from({ length: n }, (_, r) => r));
    for (let r = 0; r < n; r++) {
      expect(rows.logT[r]).toBe(logTime(rows.trials[r]!.keystrokes[0]!.t));
      expect(Number.isFinite(rows.residual[r])).toBe(true);
    }
  });

  it('weights each row by the position of its trial among the level trials', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 3, trialsPerSession: 100, seed: 11 });
    const level = levelTrials(sim.trials);
    const result = stage2Rows(level);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const w = ewmaWeights(level.trials.length);
    result.rows.trials.forEach((t, r) => {
      expect(result.rows.weight[r]).toBe(w[level.trials.indexOf(t)]);
    });
  });

  it('returns insufficient-data below the cross-fit floor', () => {
    const sim = simulateTrials(typicalUser(), { params: defaultParams(), sessions: 1, trialsPerSession: STAGE1_MIN_TRIALS - 1, seed: 1 });
    const result = stage2Rows(levelTrials(sim.trials));
    expect(result.kind).toBe('insufficient-data');
    if (result.kind === 'insufficient-data') expect(result.reason).toContain(String(STAGE1_MIN_TRIALS));
  });
});

describe('predictedLogT', () => {
  it('is the log time less the residual', () => {
    const rows: Stage2Rows = {
      ...rowsOf([makeTrial({ id: 'a' }), makeTrial({ id: 'b' })]),
      residual: Float64Array.from([0.25, -0.5]),
      logT: Float64Array.from([7, 6.5]),
    };
    expect(predictedLogT(rows, 0)).toBe(6.75);
    expect(predictedLogT(rows, 1)).toBe(7);
  });
});

describe('sessionHalves', () => {
  it('alternates sessions by first appearance and puts every row in exactly one half', () => {
    const sessions = ['s3', 's3', 's1', 's3', 's2', 's1', 's4', 's2'];
    const rows = rowsOf(sessions.map((sessionId, i) => makeTrial({ id: `t${i}`, sessionId })));
    const [a, b] = sessionHalves(rows);
    // s3 and s2 are the first and third sessions seen, s1 and s4 the second and fourth.
    expect(a).toEqual([0, 1, 3, 4, 7]);
    expect(b).toEqual([2, 5, 6]);
    expect([...a, ...b].sort((x, y) => x - y)).toEqual(rows.all);
  });

  it('gives two empty halves for no rows', () => {
    expect(sessionHalves(rowsOf([]))).toEqual([[], []]);
  });
});
