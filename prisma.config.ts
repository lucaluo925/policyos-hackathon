/**
 * Prisma 6 configuration file.
 *
 * Replaces the deprecated `package.json#prisma` block. Keeps schema + seed
 * pointers co-located with the rest of the project config.
 *
 * Env var note: Prisma 6's `prisma.config.ts` skips its own `.env` loader
 * by design — we load env via `--import tsx/esm` is awkward for Node, so
 * we use the supported `loadEnvFile()` in Node 20+ and fall back to reading
 * `.env.local` manually. This keeps `npx prisma migrate deploy` working
 * without requiring `source .env.local` every time.
 */

import { defineConfig } from 'prisma/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local (Vercel convention) and then .env, if present.
// We do this manually because Prisma 6 disables its own dotenv loader
// when a config file is present.
function loadDotenv(file: string) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv('.env.local');
loadDotenv('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
