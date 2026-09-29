import { describe, expect, it } from 'vitest';
import { makeSession, makeSnapshot, makeTrial } from '../test/fixtures';
import { isParamSnapshot, isSession, isTrial } from './validate';

describe('isTrial', () => {
  it('accepts a valid trial', () => {
    expect(isTrial(makeTrial())).toBe(true);
  });

  it('accepts an experiment trial only with experimentId and arm', () => {
    const base = { ...makeTrial(), mode: 'experiment' };
    expect(isTrial({ ...base, experimentId: 'e1', arm: 'control' })).toBe(true);
    expect(isTrial(base)).toBe(false);
    expect(isTrial({ ...base, experimentId: 'e1', arm: 'sideways' })).toBe(false);
  });

  it('rejects experiment fields on a non-experiment trial', () => {
    expect(isTrial({ ...makeTrial(), experimentId: 'e1', arm: 'control' })).toBe(false);
  });

  it.each([
    ['an unknown mode', { mode: 'warmup' }],
    ['a missing id', { id: '' }],
    ['a fractional operand', { operands: [2.5, 3] }],
    ['a letter keystroke', { keystrokes: [{ k: 'a', t: 10 }] }],
    ['a keystroke without a time', { keystrokes: [{ k: '5' }] }],
    ['a numeric prevTrialId', { prevTrialId: 4 }],
  ])('rejects %s', (_, patch) => {
    expect(isTrial({ ...makeTrial(), ...patch })).toBe(false);
  });

  it('accepts Backspace and Delete keystrokes', () => {
    const keystrokes = [{ k: 'Backspace', t: 1 }, { k: 'Delete', t: 2 }];
    expect(isTrial({ ...makeTrial(), keystrokes })).toBe(true);
  });
});

describe('isSession and isParamSnapshot', () => {
  it('accept valid records', () => {
    expect(isSession(makeSession())).toBe(true);
    expect(isSession(makeSession({ endedAt: 1727600120000, durationS: null }))).toBe(true);
    expect(isParamSnapshot(makeSnapshot())).toBe(true);
  });

  it('reject bad records', () => {
    expect(isSession({ ...makeSession(), mode: 'calibration' })).toBe(false);
    expect(isSession({ ...makeSession(), score: null })).toBe(false);
    expect(isParamSnapshot({ id: 'x', params: { enabled: {}, ranges: { addA: [5, 2] } } })).toBe(false);
  });
});
