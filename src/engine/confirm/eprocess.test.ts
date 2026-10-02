import { describe, expect, it } from 'vitest';
import { EPROCESS_ALPHA, EPROCESS_BET_CAP } from '../constants';
import { BettingEProcess, evaluatePairs, toUnit, type PairEvidence } from './eprocess';

/** The bet the process must place after a history, from the rule in the plan. */
function expectedBet(history: readonly number[], m: number, direction: 1 | -1): number {
  const n = history.length;
  const sum = history.reduce((a, x) => a + x, 0);
  const sumSq = history.reduce((a, x) => a + x * x, 0);
  const mu = (0.5 + sum) / (n + 1);
  const variance = (0.25 + sumSq - 2 * mu * sum + n * mu * mu) / (n + 1);
  const edge = direction * (mu - m);
  const largest = EPROCESS_BET_CAP / (direction === 1 ? m : 1 - m);
  return Math.min(Math.max(edge / (variance + edge * edge), 0), largest);
}

function fed(m: number, direction: 1 | -1, values: readonly number[]): BettingEProcess {
  const p = new BettingEProcess(m, direction);
  for (const x of values) p.add(x);
  return p;
}

describe('toUnit', () => {
  it('maps -1, 0 and 1 to 0, 0.5 and 1', () => {
    expect(toUnit(-1)).toBe(0);
    expect(toUnit(0)).toBe(0.5);
    expect(toUnit(1)).toBe(1);
    expect(toUnit(0.3)).toBeCloseTo(0.65, 12);
  });

  it('clips beyond the bound', () => {
    expect(toUnit(-7)).toBe(0);
    expect(toUnit(7)).toBe(1);
    expect(toUnit(-Infinity)).toBe(0);
    expect(toUnit(Infinity)).toBe(1);
  });
});

describe('BettingEProcess', () => {
  it('starts at 1', () => {
    expect(new BettingEProcess(0.5, 1).eValue).toBe(1);
  });

  it('is not moved by the first value, because the first bet is 0', () => {
    for (const direction of [1, -1] as const) {
      for (const x of [0, 0.2, 0.5, 0.9, 1]) {
        expect(fed(0.5, direction, [x]).eValue).toBe(1);
      }
    }
  });

  it('stays positive for a run of the worst values', () => {
    // The worst values after a history that made the bet as large as it gets.
    const up = fed(0.5, 1, [...new Array<number>(20).fill(1), ...new Array<number>(200).fill(0)]);
    expect(up.eValue).toBeGreaterThan(0);
    expect(Number.isFinite(up.eValue)).toBe(true);
    const down = fed(0.55, -1, [...new Array<number>(20).fill(0), ...new Array<number>(200).fill(1)]);
    expect(down.eValue).toBeGreaterThan(0);
    expect(Number.isFinite(down.eValue)).toBe(true);
    // The worst values from the start.
    expect(fed(0.5, 1, new Array<number>(200).fill(0)).eValue).toBeGreaterThan(0);
    expect(fed(0.55, -1, new Array<number>(200).fill(1)).eValue).toBeGreaterThan(0);
  });

  it('is left unchanged by x = m whatever the history', () => {
    const histories = [[1, 1, 1, 1], [0, 0, 0], [0.9, 0.2, 0.8, 0.7, 0.95, 0.6], [0.1, 0.3, 0.2, 0.05]];
    for (const direction of [1, -1] as const) {
      for (const m of [0.5, 0.55]) {
        for (const history of histories) {
          const p = fed(m, direction, history);
          const before = p.eValue;
          p.add(m);
          expect(p.eValue).toBe(before);
        }
      }
    }
  });

  it('places a bet that does not depend on the value it is applied to', () => {
    const cases: { m: number; direction: 1 | -1; history: number[] }[] = [
      { m: 0.5, direction: 1, history: [0.9, 0.6, 0.8, 0.7, 0.75] },
      { m: 0.5, direction: 1, history: [1, 1, 1, 1, 1, 1] },
      { m: 0.55, direction: -1, history: [0.3, 0.5, 0.2, 0.45, 0.4] },
      { m: 0.55, direction: -1, history: [0, 0, 0, 0, 0, 0] },
    ];
    for (const { m, direction, history } of cases) {
      const bet = expectedBet(history, m, direction);
      expect(bet).toBeGreaterThan(0);
      for (const x of [0, 0.25, 0.6, 1]) {
        const p = fed(m, direction, history);
        const before = p.eValue;
        p.add(x);
        expect(p.eValue / before).toBeCloseTo(1 + bet * direction * (x - m), 12);
      }
    }
  });

  it('grows on values on the side it bets on and shrinks on the other', () => {
    expect(fed(0.5, 1, new Array<number>(30).fill(0.7)).eValue).toBeGreaterThan(1);
    expect(fed(0.5, 1, [0.9, 0.9, 0.9, 0.2]).eValue).toBeLessThan(fed(0.5, 1, [0.9, 0.9, 0.9]).eValue);
    expect(fed(0.55, -1, new Array<number>(30).fill(0.4)).eValue).toBeGreaterThan(1);
  });
});

describe('evaluatePairs', () => {
  const pairsOf = (ds: readonly number[], se = 0): PairEvidence[] => ds.map((d) => ({ d, se }));

  it('is open with both e-values 1 on no pairs', () => {
    expect(evaluatePairs([])).toEqual({ outcome: 'open', pairs: 0, decidedAtPair: null, confirmE: 1, ruleOutE: 1 });
  });

  it('confirms a steady positive difference', () => {
    const state = evaluatePairs(pairsOf(new Array<number>(60).fill(0.4)));
    expect(state.outcome).toBe('confirmed');
    expect(state.confirmE).toBeGreaterThanOrEqual(1 / EPROCESS_ALPHA);
    expect(state.decidedAtPair).not.toBeNull();
    expect(state.decidedAtPair!).toBeLessThan(60);
  });

  it('rules out a steady difference of zero', () => {
    const state = evaluatePairs(pairsOf(new Array<number>(300).fill(0)));
    expect(state.outcome).toBe('ruled-out');
    expect(state.ruleOutE).toBeGreaterThanOrEqual(1 / EPROCESS_ALPHA);
    expect(state.confirmE).toBe(1);
  });

  it('stays open on a few pairs', () => {
    const state = evaluatePairs(pairsOf([0.3, 0.2, 0.4]));
    expect(state).toMatchObject({ outcome: 'open', pairs: 3, decidedAtPair: null });
  });

  it('does not use pairs after the deciding one', () => {
    const deciding = pairsOf(new Array<number>(60).fill(0.4));
    const short = evaluatePairs(deciding);
    const long = evaluatePairs([...deciding, ...pairsOf(new Array<number>(200).fill(-1))]);
    expect(short.outcome).toBe('confirmed');
    expect(long).toEqual({ ...short, pairs: 260 });
    const exact = evaluatePairs(deciding.slice(0, short.decidedAtPair!));
    expect(exact).toEqual({ ...short, pairs: short.decidedAtPair });
    expect(evaluatePairs(deciding.slice(0, short.decidedAtPair! - 1)).outcome).toBe('open');
  });

  it('gives a lower confirming e-value for a larger se on the same differences', () => {
    const ds = [0.3, 0.25, 0.35, 0.2, 0.3, 0.4];
    const sure = evaluatePairs(pairsOf(ds, 0));
    const unsure = evaluatePairs(pairsOf(ds, 0.1));
    expect(sure.outcome).toBe('open');
    expect(unsure.outcome).toBe('open');
    expect(unsure.confirmE).toBeLessThan(sure.confirmE);
    // The margin works against ruling out too.
    const zeros = new Array<number>(8).fill(0);
    expect(evaluatePairs(pairsOf(zeros, 0.1)).ruleOutE).toBeLessThan(evaluatePairs(pairsOf(zeros, 0)).ruleOutE);
  });
});
