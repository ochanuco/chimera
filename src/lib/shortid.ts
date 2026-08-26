const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 6;

/** Generates a random 6-char lowercase-alphanumeric candidate short ID. */
export function generateShortId(): string {
  const rand = new Uint8Array(LENGTH);
  crypto.getRandomValues(rand);
  let out = '';
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[rand[i]! % ALPHABET.length];
  }
  return out;
}

const SHORT_ID_RE = /^[a-z0-9]{6}$/;

export function isShortId(value: string): boolean {
  return SHORT_ID_RE.test(value);
}

/**
 * Generates a short ID guaranteed unique in `table`, retrying on collision.
 * `table` must be a trusted, statically-known identifier (never user input).
 */
export async function createUniqueShortId(db: D1Database, table: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateShortId();
    const existing = await db
      .prepare(`SELECT 1 FROM ${table} WHERE short_id = ?`)
      .bind(candidate)
      .first();
    if (!existing) return candidate;
  }
  throw new Error(`failed to generate unique short_id for ${table} after 10 attempts`);
}
