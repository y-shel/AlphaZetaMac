import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../data/settings';
import { normalController } from './normalMode';

describe('normalController', () => {
  it('counts down whole seconds and ends at the deadline', () => {
    const c = normalController({ ...defaultSettings(), durationS: 30 }, null, { startedAt: 1000, epochOffset: 0, seed: 1, newId: () => 'x' });
    expect(c.deadline).toBe(31_000);
    expect(c.status(1000)).toBe('Seconds left: 30');
    expect(c.status(1001)).toBe('Seconds left: 30');
    expect(c.status(2000)).toBe('Seconds left: 29');
    expect(c.over(30_999)).toBe(false);
    expect(c.over(31_000)).toBe(true);
    expect(c.status(40_000)).toBe('Seconds left: 0');
  });
});
