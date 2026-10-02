import { describe, expect, it } from 'vitest';
import type { Finding } from '../engine/findings/finding';
import { describeFinding, describeTerm } from './describe';

const finding = (over: Partial<Finding>): Finding => ({
  id: 'f-1',
  terms: ['borrow_required'],
  tier: 'suspected',
  effectLogT: 0.2,
  effectSdLogT: 0.05,
  effectMs: 340,
  prevalence: 0.11,
  prevalenceEstimated: false,
  scorePoints: 3.04,
  scorePointsLow: 1.5,
  scorePointsHigh: 4.4,
  nTrials: 80,
  discoveredAt: 0,
  replicated: false,
  testable: true,
  experiment: null,
  ...over,
});

describe('describeTerm', () => {
  it('reads an atom, an operation scope and a pair', () => {
    expect(describeTerm(['borrow_required'])).toBe('A problem that requires a borrow');
    expect(describeTerm(['contains_7', 'op_mul'])).toBe('A multiplication problem that shows a 7');
    expect(describeTerm(['contains_8', 'tie'])).toBe('A problem that shows an 8 and is a tie, like 7 + 7');
  });

  it('does not throw for an atom the registry does not have', () => {
    expect(describeTerm(['no_such_atom'])).toBe('An unknown kind of problem');
    expect(describeTerm(['op_mul', 'no_such_atom'])).toBe('An unknown kind of problem');
  });
});

describe('describeFinding', () => {
  it('states a suspected finding in ms, share of a round and score points (spec 12.3)', () => {
    expect(describeFinding(finding({}))).toEqual({
      title: 'A problem that requires a borrow',
      body: 'Each one costs you about 340 ms. They are 11% of a typical round, about 3.0 problems off your score.',
    });
  });

  it('gives a confirmed finding its interval, and names an estimate as one', () => {
    const d = describeFinding(finding({ tier: 'confirmed', prevalenceEstimated: true }));
    expect(d.body).toContain('somewhere between 1.5 and 4.4');
    expect(d.body).toContain('this is an estimate');
  });

  it('says so when a credible set holds more than one term', () => {
    expect(describeFinding(finding({ terms: ['borrow_required', 'contains_9'] })).title).toBe(
      'Either a problem that requires a borrow, or a problem that shows a 9. The data cannot yet tell these apart',
    );
  });
});
