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
 * Generates a short ID guaranteed unique in `table` (and in each of `alsoAvoid`), retrying on collision.
 * `table` / `alsoAvoid` must be trusted, statically-known identifiers (never user input).
 */
export async function createUniqueShortId(db: D1Database, table: string, alsoAvoid: string[] = []): Promise<string> {
  const tables = [table, ...alsoAvoid];
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateShortId();
    let taken = false;
    for (const t of tables) {
      if (await db.prepare(`SELECT 1 FROM ${t} WHERE short_id = ?`).bind(candidate).first()) {
        taken = true;
        break;
      }
    }
    if (!taken) return candidate;
  }
  throw new Error(`failed to generate unique short_id for ${table} after 10 attempts`);
}

/** requests と batches は /b/{short_id} の同じ名前空間を共有する (docs/batch-removal.md)。互いに衝突させない。 */
export function createUniqueRequestShortId(db: D1Database): Promise<string> {
  return createUniqueShortId(db, 'requests', ['batches']);
}
