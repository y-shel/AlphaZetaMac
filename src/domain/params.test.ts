import { describe, expect, it } from 'vitest';
import { cyrb53 } from './hash';
import { canonicalJson, paramsSnapshotId } from './params';

describe('cyrb53', () => {
  it('matches the reference value for "abc"', () => {
    expect(cyrb53('abc')).toBe(0x11f9f91ac18c8d);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: true } })).toBe('{"a":{"c":true,"d":[2,1]},"b":1}');
  });
});

describe('paramsSnapshotId', () => {
  const params = { enabled: { add: true, sub: false }, ranges: { addA: [2, 100] as const } };

  it('ignores key order', () => {
    const reordered = { ranges: { addA: [2, 100] as const }, enabled: { sub: false, add: true } };
    expect(paramsSnapshotId(reordered)).toBe(paramsSnapshotId(params));
  });

  it('changes when a range changes', () => {
    const other = { ...params, ranges: { addA: [2, 99] as const } };
    expect(paramsSnapshotId(other)).not.toBe(paramsSnapshotId(params));
  });

  it('has the ps- prefix and 14 hex characters', () => {
    expect(paramsSnapshotId(params)).toMatch(/^ps-[0-9a-f]{14}$/);
  });
});
