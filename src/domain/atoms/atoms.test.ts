import { describe, expect, it } from 'vitest';
import { makeTrial } from '../../test/fixtures';
import { operations } from '../operations/registry';
import type { Problem, Trial } from '../types';
import { atoms, getAtom } from './registry';

const P = (opId: string, operands: number[], answer: number): Problem => ({ opId, operands, answer });
const afterAdd = makeTrial({ opId: 'add' });

interface Case {
  atom: string;
  problem: Problem;
  expected: boolean | null;
  prev?: Trial | null;
  index?: number;
  roundLength?: number;
}

const cases: Case[] = [
  { atom: 'op_add', problem: P('add', [2, 3], 5), expected: true },
  { atom: 'op_add', problem: P('sub', [5, 2], 3), expected: false },
  { atom: 'op_div', problem: P('div', [56, 7], 8), expected: true },

  { atom: 'carry_required', problem: P('add', [17, 25], 42), expected: true },
  { atom: 'carry_required', problem: P('add', [12, 34], 46), expected: false },
  { atom: 'carry_required', problem: P('sub', [12, 3], 9), expected: null },
  { atom: 'carry_multiple', problem: P('add', [57, 68], 125), expected: true },
  { atom: 'carry_multiple', problem: P('add', [95, 5], 100), expected: true },
  { atom: 'carry_multiple', problem: P('add', [17, 25], 42), expected: false },
  { atom: 'carry_multiple', problem: P('mul', [3, 4], 12), expected: null },
  { atom: 'borrow_required', problem: P('sub', [42, 17], 25), expected: true },
  { atom: 'borrow_required', problem: P('sub', [100, 1], 99), expected: true },
  { atom: 'borrow_required', problem: P('sub', [45, 12], 33), expected: false },
  { atom: 'borrow_required', problem: P('mul', [3, 4], 12), expected: null },

  { atom: 'tie', problem: P('add', [7, 7], 14), expected: true },
  { atom: 'tie', problem: P('sub', [14, 7], 7), expected: true },
  { atom: 'tie', problem: P('div', [64, 8], 8), expected: true },
  { atom: 'tie', problem: P('add', [7, 8], 15), expected: false },
  { atom: 'near_tie', problem: P('add', [7, 8], 15), expected: true },
  { atom: 'near_tie', problem: P('add', [7, 7], 14), expected: true },
  { atom: 'near_tie', problem: P('div', [56, 7], 8), expected: true },
  { atom: 'near_tie', problem: P('add', [7, 9], 16), expected: false },
  { atom: 'shares_digit', problem: P('add', [12, 23], 35), expected: true },
  { atom: 'shares_digit', problem: P('add', [14, 35], 49), expected: false },
  { atom: 'shares_digit', problem: P('sub', [46, 12], 34), expected: false },
  { atom: 'operand_round', problem: P('add', [30, 7], 37), expected: true },
  { atom: 'operand_round', problem: P('mul', [12, 40], 480), expected: true },
  { atom: 'operand_round', problem: P('add', [31, 7], 38), expected: false },
  { atom: 'operand_round', problem: P('add', [0, 7], 7), expected: false },

  { atom: 'contains_7', problem: P('add', [17, 2], 19), expected: true },
  { atom: 'contains_7', problem: P('add', [3, 4], 7), expected: false },
  { atom: 'contains_8', problem: P('mul', [8, 3], 24), expected: true },
  { atom: 'contains_9', problem: P('sub', [19, 4], 15), expected: true },
  { atom: 'contains_9', problem: P('add', [12, 3], 15), expected: false },

  { atom: 'two_digit_multiplier', problem: P('mul', [12, 15], 180), expected: true },
  { atom: 'two_digit_multiplier', problem: P('mul', [9, 15], 135), expected: false },
  { atom: 'two_digit_multiplier', problem: P('div', [180, 12], 15), expected: true },
  { atom: 'two_digit_multiplier', problem: P('div', [135, 9], 15), expected: false },
  { atom: 'two_digit_multiplier', problem: P('add', [12, 15], 27), expected: null },
  { atom: 'answer_three_digits', problem: P('add', [50, 50], 100), expected: true },
  { atom: 'answer_three_digits', problem: P('add', [45, 54], 99), expected: false },

  { atom: 'prev_op_differs', problem: P('sub', [5, 2], 3), prev: null, expected: null },
  { atom: 'prev_op_differs', problem: P('sub', [5, 2], 3), prev: afterAdd, expected: true },
  { atom: 'prev_op_differs', problem: P('add', [5, 2], 7), prev: afterAdd, expected: false },
  { atom: 'late_in_round', problem: P('add', [2, 3], 5), index: 61, roundLength: 100, expected: true },
  { atom: 'late_in_round', problem: P('add', [2, 3], 5), index: 60, roundLength: 100, expected: false },
  { atom: 'late_in_round', problem: P('add', [2, 3], 5), index: 0, roundLength: 0, expected: null },
];

describe('atom truth table', () => {
  it.each(cases)('$atom on $problem.operands ($problem.opId) is $expected', (c) => {
    const ctx = {
      problem: c.problem,
      prev: c.prev ?? null,
      indexInSession: c.index ?? 0,
      roundLength: c.roundLength ?? 50,
    };
    expect(getAtom(c.atom).applies(ctx)).toBe(c.expected);
  });
});

describe('atom registry', () => {
  it('holds the 18 atoms of spec 7.2', () => {
    expect(atoms.map((a) => a.id)).toEqual([
      'op_add', 'op_sub', 'op_mul', 'op_div',
      'carry_required', 'carry_multiple', 'borrow_required',
      'tie', 'near_tie', 'shares_digit', 'operand_round',
      'contains_7', 'contains_8', 'contains_9',
      'two_digit_multiplier', 'answer_three_digits',
      'prev_op_differs', 'late_in_round',
    ]);
  });

  it('has one operation atom per registered operation', () => {
    const opAtoms = atoms.filter((a) => a.family === 'operation').map((a) => a.id);
    expect(opAtoms).toEqual(operations.map((o) => `op_${o.id}`));
  });

  it('uses unique ids and gives every atom a label and a family', () => {
    expect(new Set(atoms.map((a) => a.id)).size).toBe(atoms.length);
    for (const a of atoms) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.family.length).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown atom id', () => {
    expect(() => getAtom('nope')).toThrow('unknown atom "nope"');
  });
});
