import { describe, expect, it } from 'vitest';
import { bandFor } from './bands';

describe('bandFor', () => {
  it.each([
    [20, 'building'],
    [44.9, 'building'],
    [45, 'baseline'],
    [54.9, 'baseline'],
    [55, 'competitive'],
    [69.9, 'competitive'],
    [70, 'strong'],
    [110, 'strong'],
  ])('%d is %s, and approximate', (score, band) => {
    expect(bandFor(score)).toMatchObject({ band, approximate: true });
  });
});
