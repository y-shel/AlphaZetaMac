import { describe, expect, it } from 'vitest';
import { makeTrial } from '../test/fixtures';
import { levelTrials, logTime, observations, sizeOf } from './features';

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

describe('levelTrials', () => {
  const trials = [
    makeTrial({ id: 'a', mode: 'normal', keystrokes: [{ k: '5', t: 800 }] }),
    makeTrial({ id: 'b', mode: 'train' }),
    makeTrial({ id: 'c', mode: 'test', sessionId: 's2', keystrokes: [{ k: '5', t: 1200 }] }),
    { ...makeTrial({ id: 'd' }), mode: 'experiment' as const, experimentId: 'e1', arm: 'control' as const },
    makeTrial({ id: 'e', mode: 'normal', keystrokes: [] }),
    makeTrial({ id: 'f', mode: 'calibration', operands: [4, 5], answer: 9, keystrokes: [{ k: '9', t: 900 }] }),
  ];

  it('returns each level trial with its own observation, and skips what observations skips', () => {
    const level = levelTrials(trials);
    expect(level.trials.map((t) => t.id)).toEqual(['a', 'c', 'f']);
    expect(level.obs).toHaveLength(level.trials.length);
    level.trials.forEach((t, i) => {
      expect(level.obs[i]).toEqual({
        problem: { opId: t.opId, operands: t.operands, answer: t.answer },
        y: logTime(t.keystrokes[0]!.t),
        sessionId: t.sessionId,
      });
    });
    expect(level.trials[0]).toBe(trials[0]);
  });

  it('gives the observations that observations gives', () => {
    expect(observations(trials)).toEqual(levelTrials(trials).obs);
    expect(levelTrials([])).toEqual({ trials: [], obs: [] });
  });
});
