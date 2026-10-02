import { describe, expect, it } from 'vitest';
import { atomContexts } from '../../domain/atoms/contexts';
import { atoms } from '../../domain/atoms/registry';
import { defaultParams } from '../../domain/operations/registry';
import { simulateTrials, typicalUser } from '../__sim__/simUser';
import { levelTrials } from '../features';
import { fallbackRanking } from './fallback';
import { fitRows, rankFallback, stage2Matrix, termRows, type Stage2Matrix } from './matrix';
import { sessionHalves } from './rows';
import { suffStats, susie } from './susie';

function simulated(sessions = 5, trialsPerSession = 100, seed = 11) {
  const { trials } = simulateTrials(typicalUser({ weakness: { atomIds: ['contains_8'], effect: 0.3 } }), {
    params: defaultParams(),
    sessions,
    trialsPerSession,
    seed,
  });
  return trials;
}

function matrixOf(sessions?: number, trialsPerSession?: number): Stage2Matrix {
  const all = simulated(sessions, trialsPerSession);
  const result = stage2Matrix(levelTrials(all), all);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.matrix;
}

describe('stage2Matrix', () => {
  it('gives every term one value per row', () => {
    const m = matrixOf();
    expect(m.terms.length).toBeGreaterThan(0);
    for (const t of m.terms) expect(t.values).toHaveLength(m.rows.trials.length);
  });

  it('passes a cross-fit failure through', () => {
    const all = simulated(1, 20);
    expect(stage2Matrix(levelTrials(all), all).kind).toBe('insufficient-data');
  });
});

describe('termRows', () => {
  it("returns exactly the rows whose trial answers true to every atom of the term", () => {
    const all = simulated();
    const result = stage2Matrix(levelTrials(all), all);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const m = result.matrix;
    const contexts = atomContexts(m.rows.trials, all);
    expect(m.terms.some((t) => t.atomIds.length === 2)).toBe(true);
    for (const t of m.terms) {
      const termAtoms = t.atomIds.map((id) => atoms.find((a) => a.id === id)!);
      const expected: number[] = [];
      contexts.forEach((ctx, r) => {
        if (termAtoms.every((a) => a.applies(ctx) === true)) expected.push(r);
      });
      expect(termRows(m, t.id)).toEqual(expected);
      expect(expected).toHaveLength(t.nPositive);
    }
  });

  it('is empty for an unknown term id', () => {
    expect(termRows(matrixOf(), 'no_such_term')).toEqual([]);
  });
});

describe('fitRows', () => {
  it('on every row equals the fit built by hand', () => {
    const m = matrixOf();
    const columns = m.terms.map((t) => t.values);
    const byHand = susie(suffStats(columns, m.rows.residual, m.rows.weight, m.rows.all));
    expect(fitRows(m)).toEqual(byHand);
    expect(fitRows(m, m.rows.all)).toEqual(byHand);
  });

  it('on a half uses only that half', () => {
    const m = matrixOf();
    const [half, other] = sessionHalves(m.rows);
    const columns = m.terms.map((t) => t.values);
    const fit = fitRows(m, half);
    expect(fit).toEqual(susie(suffStats(columns, m.rows.residual, m.rows.weight, half)));
    // Changing the rows outside the half must not move the fit.
    const residual = Float64Array.from(m.rows.residual);
    for (const r of other) residual[r] = 99;
    expect(fitRows({ ...m, rows: { ...m.rows, residual } }, half)).toEqual(fit);
    expect(fit).not.toEqual(fitRows(m));
  });
});

describe('rankFallback', () => {
  it('is the fallback ranking on every row', () => {
    const m = matrixOf(3, 50);
    const ranked = rankFallback(m);
    expect(ranked).toEqual(fallbackRanking(m.terms, m.rows.residual, m.rows.weight, m.rows.all));
    expect(ranked.length).toBeGreaterThan(0);
  });
});
