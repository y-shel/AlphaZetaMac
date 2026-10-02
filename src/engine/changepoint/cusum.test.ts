import { describe, expect, it } from 'vitest';
import { createRng } from '../../domain/rng';
import { normal } from '../__sim__/simUser';
import { CUSUM_BURN_IN } from '../constants';
import { detectShifts } from './cusum';

/** Noise in the test streams, as a share of sigma. Small, so that each step is one clear event. */
const NOISE = 0.2;

/** Seeded noise of the given sd around a level per position. */
function stream(length: number, sd: number, seed: number, level: (i: number) => number): number[] {
  const rng = createRng(seed);
  return Array.from({ length }, (_, i) => level(i) + sd * normal(rng));
}

describe('detectShifts', () => {
  it('finds nothing in an empty stream', () => {
    expect(detectShifts([], 1)).toEqual([]);
  });

  it('finds nothing before the burn-in, however wild the values', () => {
    const wild = Array.from({ length: CUSUM_BURN_IN }, (_, i) => (i < 10 ? 0 : 100));
    expect(detectShifts(wild, 1)).toEqual([]);
  });

  it('can fire on the first value after the burn-in and no earlier', () => {
    const x = [...new Array<number>(CUSUM_BURN_IN).fill(0), 100];
    expect(detectShifts(x, 1)).toEqual([{ at: CUSUM_BURN_IN, changeAt: CUSUM_BURN_IN, direction: 1 }]);
  });

  it('finds nothing in a constant stream', () => {
    expect(detectShifts(new Array<number>(500).fill(0.37), 0.25)).toEqual([]);
  });

  it('detects a step up of 3 sigma within 10 values and places it within 3', () => {
    const sigma = 0.25;
    const x = stream(120, NOISE * sigma, 11, (i) => (i < 60 ? 0 : 3 * sigma));
    const shifts = detectShifts(x, sigma);
    expect(shifts).toHaveLength(1);
    const s = shifts[0]!;
    expect(s.direction).toBe(1);
    expect(s.at).toBeGreaterThanOrEqual(60);
    expect(s.at).toBeLessThan(70);
    expect(Math.abs(s.changeAt - 60)).toBeLessThanOrEqual(3);
  });

  it('detects a step down of 3 sigma with direction -1', () => {
    const sigma = 0.25;
    const x = stream(120, NOISE * sigma, 12, (i) => (i < 60 ? 0 : -3 * sigma));
    const shifts = detectShifts(x, sigma);
    expect(shifts).toHaveLength(1);
    const s = shifts[0]!;
    expect(s.direction).toBe(-1);
    expect(s.at).toBeGreaterThanOrEqual(60);
    expect(s.at).toBeLessThan(70);
    expect(Math.abs(s.changeAt - 60)).toBeLessThanOrEqual(3);
  });

  it('restarts after an alarm and detects a second step back', () => {
    const sigma = 0.25;
    const x = stream(240, NOISE * sigma, 13, (i) => (i >= 60 && i < 140 ? 3 * sigma : 0));
    const shifts = detectShifts(x, sigma);
    expect(shifts).toHaveLength(2);
    const [first, second] = shifts as [(typeof shifts)[0], (typeof shifts)[0]];
    expect(first.direction).toBe(1);
    expect(first.at).toBeGreaterThanOrEqual(60);
    expect(first.at).toBeLessThan(70);
    expect(second.direction).toBe(-1);
    expect(second.at).toBeGreaterThanOrEqual(140);
    expect(second.at).toBeLessThan(150);
    expect(Math.abs(second.changeAt - 140)).toBeLessThanOrEqual(3);
  });

  it('does not use the values before a restart', () => {
    // After the alarm the new level is the baseline, so staying on it is no shift.
    const x = [...new Array<number>(60).fill(0), ...new Array<number>(200).fill(3)];
    const shifts = detectShifts(x, 1);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.direction).toBe(1);
  });

  it('accepts a typed array', () => {
    const x = Float64Array.from([...new Array<number>(60).fill(0), ...new Array<number>(20).fill(3)]);
    expect(detectShifts(x, 1)).toHaveLength(1);
  });

  it('does not throw on a sigma of 0', () => {
    // A value equal to the mean so far standardises to 0 / 0, and nothing is reported after it.
    expect(detectShifts(new Array<number>(100).fill(1), 0)).toEqual([]);
    const late = [...new Array<number>(30).fill(0), ...new Array<number>(30).fill(1)];
    expect(detectShifts(late, 0)).toEqual([]);
    // A first value after the burn-in that differs is infinitely many sigmas, so it alarms.
    const x = [...new Array<number>(20).fill(0), 1, ...new Array<number>(30).fill(1)];
    expect(detectShifts(x, 0)).toEqual([{ at: 20, changeAt: 20, direction: 1 }]);
  });

  it('does not throw on a NaN value, and reports nothing after it', () => {
    const x = [...new Array<number>(30).fill(0), Number.NaN, ...new Array<number>(30).fill(0), ...new Array<number>(30).fill(5)];
    expect(detectShifts(x, 1)).toEqual([]);
  });

  it('keeps the shifts found before a NaN value', () => {
    const x = [...new Array<number>(30).fill(0), ...new Array<number>(30).fill(5), Number.NaN, ...new Array<number>(60).fill(0)];
    const shifts = detectShifts(x, 1);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.direction).toBe(1);
  });
});
