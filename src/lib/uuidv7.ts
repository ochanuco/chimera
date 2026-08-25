/**
 * Minimal UUIDv7 generator (RFC 9562).
 *
 * Layout: 48-bit big-endian unix_ts_ms | 4-bit version (0111) | 12-bit rand_a
 * | 2-bit variant (10) | 62-bit rand_b.
 */
export function uuidv7(): string {
  const unixTsMs = Date.now();
  const bytes = new Uint8Array(16);

  bytes[0] = (unixTsMs / 2 ** 40) & 0xff;
  bytes[1] = (unixTsMs / 2 ** 32) & 0xff;
  bytes[2] = (unixTsMs / 2 ** 24) & 0xff;
  bytes[3] = (unixTsMs / 2 ** 16) & 0xff;
  bytes[4] = (unixTsMs / 2 ** 8) & 0xff;
  bytes[5] = unixTsMs & 0xff;

  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);

  // rand_a: 12 bits (bytes[6] low nibble + bytes[7])
  bytes[6] = 0x70 | (rand[0]! & 0x0f);
  bytes[7] = rand[1]!;

  // variant: top 2 bits of bytes[8] set to 10
  bytes[8] = 0x80 | (rand[2]! & 0x3f);
  bytes[9] = rand[3]!;
  bytes[10] = rand[4]!;
  bytes[11] = rand[5]!;
  bytes[12] = rand[6]!;
  bytes[13] = rand[7]!;
  bytes[14] = rand[8]!;
  bytes[15] = rand[9]!;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
