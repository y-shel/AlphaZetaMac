import { describe, expect, it } from 'vitest';
import { isTrial } from '../../data/validate';
import type { Keystroke } from '../../domain/types';
import type { CompletedRecord } from './round';
import { toTrials, type TrialContext } from './toTrials';

const keys: Keystroke[] = [
  { k: '6', t: 300 },
  { k: 'Backspace', t: 400 },
  { k: '5', t: 500 },
  { k: '1', t: 200 },
  { k: '2', t: 300 },
];

const records: CompletedRecord[] = [
  { problem: { opId: 'add', operands: [2, 3], answer: 5 }, displayedAt: 1000, completedAt: 1500, keyStart: 0, keyEnd: 3, tag: undefined },
  { problem: { opId: 'mul', operands: [3, 4], answer: 12 }, displayedAt: 1500, completedAt: 1800, keyStart: 3, keyEnd: 5, tag: undefined },
];

function context(): TrialContext {
  let n = 0;
  return {
    sessionId: 'session-1',
    mode: 'normal',
    paramsSnapshotId: 'ps-1',
    timeOrigin: 1_727_600_000_000,
    newId: (ms) => `id-${n++}-${ms}`,
  };
}

describe('toTrials', () => {
  it('builds complete, mode-tagged trials with epoch times', () => {
    const [first, second] = toTrials(records, keys, 0, null, context());
    expect(first).toEqual({
      id: 'id-0-1727600001000',
      schemaVersion: 1,
      sessionId: 'session-1',
      mode: 'normal',
      opId: 'add',
      operands: [2, 3],
      answer: 5,
      displayedAt: 1_727_600_001_000,
      keystrokes: [
        { k: '6', t: 300 },
        { k: 'Backspace', t: 400 },
        { k: '5', t: 500 },
      ],
      completedAt: 1_727_600_001_500,
      indexInSession: 0,
      prevTrialId: null,
      paramsSnapshotId: 'ps-1',
    });
    expect(second!.prevTrialId).toBe(first!.id);
    expect(second!.indexInSession).toBe(1);
    expect(second!.keystrokes).toEqual([
      { k: '1', t: 200 },
      { k: '2', t: 300 },
    ]);
  });

  it('builds only records from `from` onward and links to the given previous id', () => {
    const trials = toTrials(records, keys, 1, 'earlier-id', context());
    expect(trials).toHaveLength(1);
    expect(trials[0]!.indexInSession).toBe(1);
    expect(trials[0]!.prevTrialId).toBe('earlier-id');
  });

  it('copies operands so later changes to the problem cannot reach a stored trial', () => {
    const [first] = toTrials(records, keys, 0, null, context());
    expect(first!.operands).not.toBe(records[0]!.problem.operands);
  });
});

describe('toTrials tags', () => {
  it('lets a record tag win over the context mode', () => {
    const tagged: CompletedRecord[] = [
      { ...records[0]!, tag: { mode: 'train' } },
      { ...records[1]! },
    ];
    const [first, second] = toTrials(tagged, keys, 0, null, context());
    expect(first!.mode).toBe('train');
    expect(second!.mode).toBe('normal');
  });

  it('writes the experiment id and arm, and the trial passes isTrial', () => {
    const tagged: CompletedRecord[] = [
      { ...records[0]!, tag: { mode: 'experiment', experimentId: 'ex-1', arm: 'control' } },
    ];
    const [t] = toTrials(tagged, keys, 0, null, context());
    expect(t!.mode).toBe('experiment');
    expect(t!.experimentId).toBe('ex-1');
    expect(t!.arm).toBe('control');
    expect(isTrial(t)).toBe(true);
  });
});

describe('toTrials train tag', () => {
  it('writes a train trial with no experimentId or arm', () => {
    const [t] = toTrials([{ ...records[0]!, tag: { mode: 'train' } }], keys, 0, null, context());
    expect(t!.mode).toBe('train');
    expect('experimentId' in t!).toBe(false);
    expect('arm' in t!).toBe(false);
    expect(isTrial(t)).toBe(true);
  });
});
