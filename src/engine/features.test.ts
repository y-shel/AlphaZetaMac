import { describe, expect, it } from 'vitest';
import { makeTrial } from '../test/fixtures';
import { logTime, observations, sizeOf } from './features';

describe('sizeOf', () => {
  it('is the operation size metric', () => {
    expect(sizeOf({ opId: 'add', operands: [30, 45], answer: 75 })).toBeCloseTo(Math.log(75), 12);
    expect(sizeOf({ opId: 'div', operands: [56, 7], answer: 8 })).toBeCloseTo(Math.log(56), 12);
  });

  it('clamps a size of 0 or 1 to 0 instead of returning -Infinity', () => {
    expect(sizeOf({ opId: 'add', operands: [0, 0], answer: 0 })).toBe(0);
    expect(sizeOf({ opId: 'mul', operands: [1, 0], answer: 0 })).toBe(0);
    expect(sizeOf({ opId: 'mul', operands: [1, 1], answer: 1 })).toBe(0);
  });
});

describe('logTime', () => {
  it('is the natural log, with times below 1 ms clamped to 1 ms', () => {
    expect(logTime(1000)).toBeCloseTo(Math.log(1000), 12);
    expect(logTime(0)).toBe(0);
  });
});

describe('observations', () => {
  it('keeps normal, test and calibration trials in order and drops train and experiment', () => {
    const trials = [
      makeTrial({ id: 'a', mode: 'normal', keystrokes: [{ k: '5', t: 800 }] }),
      makeTrial({ id: 'b', mode: 'train' }),
      makeTrial({ id: 'c', mode: 'test', sessionId: 's2', keystrokes: [{ k: '5', t: 1200 }] }),
      { ...makeTrial({ id: 'd' }), mode: 'experiment' as const, experimentId: 'e1', arm: 'control' as const },
      makeTrial({ id: 'e', mode: 'calibration', keystrokes: [{ k: 'Backspace', t: 400 }, { k: '5', t: 900 }] }),
    ];
    const obs = observations(trials);
    expect(obs.map((o) => o.y)).toEqual([Math.log(800), Math.log(1200), Math.log(400)]);
    expect(obs.map((o) => o.sessionId)).toEqual(['session-1', 's2', 'session-1']);
    expect(obs[0]!.problem).toEqual({ opId: 'add', operands: [2, 3], answer: 5 });
  });

  it('skips a trial with no keystrokes', () => {
    expect(observations([makeTrial({ keystrokes: [] })])).toEqual([]);
  });
});
