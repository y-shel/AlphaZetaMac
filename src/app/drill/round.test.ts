import { describe, expect, it } from 'vitest';
import type { Problem } from '../../domain/types';
import { Round } from './round';

function scripted(...problems: Problem[]): () => Problem {
  let i = 0;
  return () => {
    const p = problems[i++];
    if (p === undefined) throw new Error('script ran out of problems');
    return p;
  };
}

const twoPlusThree: Problem = { opId: 'add', operands: [2, 3], answer: 5 };
const threeTimesFour: Problem = { opId: 'mul', operands: [3, 4], answer: 12 };
const nineMinusFour: Problem = { opId: 'sub', operands: [9, 4], answer: 5 };

describe('Round', () => {
  it('shows the first problem at the start time', () => {
    const round = new Round(scripted(twoPlusThree), 1000);
    expect(round.problem).toBe(twoPlusThree);
    expect(round.problemText).toBe('2 + 3');
    expect(round.typed).toBe('');
  });

  it('completes on the keystroke that makes the typed string equal the answer', () => {
    const round = new Round(scripted(twoPlusThree, threeTimesFour), 1000);
    expect(round.key('5', 1400)).toBe(true);
    expect(round.problemText).toBe('3 × 4');
    expect(round.typed).toBe('');
  });

  it('does not complete on a prefix of the answer', () => {
    const round = new Round(scripted(threeTimesFour, twoPlusThree), 0);
    expect(round.key('1', 100)).toBe(false);
    expect(round.typed).toBe('1');
    expect(round.key('2', 200)).toBe(true);
  });

  it('keeps a wrong digit until it is deleted, and records every key', () => {
    const round = new Round(scripted(twoPlusThree, threeTimesFour), 1000);
    expect(round.key('6', 1300)).toBe(false);
    expect(round.typed).toBe('6');
    expect(round.key('Backspace', 1400)).toBe(false);
    expect(round.typed).toBe('');
    expect(round.key('Delete', 1450)).toBe(false);
    expect(round.typed).toBe('');
    expect(round.key('5', 1500)).toBe(true);
    expect(round.keys.slice(0, round.keyCount)).toEqual([
      { k: '6', t: 300 },
      { k: 'Backspace', t: 400 },
      { k: 'Delete', t: 450 },
      { k: '5', t: 500 },
    ]);
  });

  it('times each trial from the moment its problem was shown', () => {
    const round = new Round(scripted(twoPlusThree, threeTimesFour, nineMinusFour), 1000);
    round.key('5', 1500);
    round.key('1', 1700);
    round.key('2', 1800);
    expect(round.completed).toEqual([
      { problem: twoPlusThree, displayedAt: 1000, completedAt: 1500, keyStart: 0, keyEnd: 1 },
      { problem: threeTimesFour, displayedAt: 1500, completedAt: 1800, keyStart: 1, keyEnd: 3 },
    ]);
    expect(round.keys[1]).toEqual({ k: '1', t: 200 });
    expect(round.keys[2]).toEqual({ k: '2', t: 300 });
  });

  it('keeps recording past its preallocated capacity', () => {
    const round = new Round(scripted(twoPlusThree, threeTimesFour), 0, 2);
    round.key('1', 1);
    round.key('Backspace', 2);
    round.key('5', 3);
    expect(round.keyCount).toBe(3);
    expect(round.completed[0]!.keyEnd).toBe(3);
    expect(round.keys[2]).toEqual({ k: '5', t: 3 });
  });
});
