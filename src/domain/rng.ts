import type { Range, Rng } from './types';

/** mulberry32. Small, fast, and good enough for problem generation and simulation. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Uniform integer in [min, max], both ends inclusive. */
export function randInt(rng: Rng, [min, max]: Range): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}
