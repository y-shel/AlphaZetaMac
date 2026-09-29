import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7';

const zeros = new Uint8Array(10);
const ones = new Uint8Array(10).fill(0xff);

describe('uuidv7', () => {
  it('puts the timestamp first and sets the version and variant bits', () => {
    expect(uuidv7(1727600000000, zeros)).toBe('01923cfb-fc00-7000-8000-000000000000');
    expect(uuidv7(1727600000000, ones)).toBe('01923cfb-fc00-7fff-bfff-ffffffffffff');
  });

  it('sorts by timestamp whatever the random bytes are', () => {
    expect(uuidv7(1727600000001, zeros) > uuidv7(1727600000000, ones)).toBe(true);
  });

  it('drops fractional milliseconds', () => {
    expect(uuidv7(1727600000000.9, zeros)).toBe(uuidv7(1727600000000, zeros));
  });

  it('rejects fewer than 10 random bytes', () => {
    expect(() => uuidv7(0, new Uint8Array(9))).toThrow('10 random bytes');
  });
});
