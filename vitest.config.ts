import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(import.meta.dirname, 'migrations');
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
  ],
  test: {
    // Isolating each file costs ~0.7s of serialized runner setup per file,
    // which dominated the suite; apply-migrations.ts resets storage per file.
    isolate: false,
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
