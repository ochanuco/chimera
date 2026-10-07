import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// isolate: false (vitest.config.ts) shares one D1 / R2 across the test files a
// worker runs, so each file starts by emptying them. The migrations seed no
// rows, so empty tables are the freshly migrated state.
const { results: tables } = await env.DB.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', 'sqlite_sequence')",
).all<{ name: string }>();
await env.DB.batch([
  env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
  ...tables.map(({ name }) => env.DB.prepare(`DELETE FROM "${name}"`)),
]);

let cursor: string | undefined;
do {
  const listed = await env.IMAGES.list({ cursor });
  if (listed.objects.length > 0) await env.IMAGES.delete(listed.objects.map((o) => o.key));
  cursor = listed.truncated ? listed.cursor : undefined;
} while (cursor);
