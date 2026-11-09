import { defineConfig } from 'vitest/config';
import path from 'node:path';

/*
 * Vitest covers the OSIRIS module only. PolicyOS's own tests run on the
 * node:test runner via `npm test`, so the include list is scoped to the
 * OSIRIS-derived paths to keep the two runners from picking up each other's
 * files. Upstream config: carbon-evolution/osiris (MIT).
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: [
      'src/lib/osiris/**/*.test.ts',
      'src/workers/**/*.test.ts',
      // OSIRIS API tests, listed path by path so a future PolicyOS test under
      // src/app/api is not picked up by the wrong runner.
      'src/app/api/route-hardening.test.ts',
      'src/app/api/scanner-access.test.ts',
      'src/app/api/temperature/**/*.test.ts',
    ],
    testTimeout: 20000,
    setupFiles: ['dotenv/config'],
  },
});
