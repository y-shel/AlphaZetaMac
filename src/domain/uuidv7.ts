/**
 * UUIDv7 from a millisecond timestamp and 10 random bytes. Pure: the caller supplies both,
 * so ids sort by the time passed in.
 */
export function uuidv7(epochMs: number, random: Uint8Array): string {
  if (random.length < 10) throw new Error('uuidv7 needs 10 random bytes');
  const ms = Math.floor(epochMs);
  const hi = Math.floor(ms / 2 ** 32);
  const lo = ms >>> 0;
  const b = new Uint8Array(16);
  b[0] = (hi >>> 8) & 0xff;
  b[1] = hi & 0xff;
  b[2] = (lo >>> 24) & 0xff;
  b[3] = (lo >>> 16) & 0xff;
  b[4] = (lo >>> 8) & 0xff;
  b[5] = lo & 0xff;
  b[6] = 0x70 | (random[0]! & 0x0f);
  b[7] = random[1]!;
  b[8] = 0x80 | (random[2]! & 0x3f);
  for (let i = 0; i < 7; i++) b[9 + i] = random[3 + i]!;
  let hex = '';
  for (const byte of b) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
