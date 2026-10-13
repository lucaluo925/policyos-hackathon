/**
 * Prisma client singleton.
 *
 * Two concerns this module handles:
 *
 *   1. Singleton across hot reload / serverless invocations.
 *      In dev (Next.js HMR) we re-import modules frequently, which would
 *      otherwise create many PrismaClient instances and exhaust the pool.
 *      We cache on `globalThis` to survive HMR; in prod each serverless
 *      function gets exactly one client.
 *
 *   2. Graceful handling when DATABASE_URL is missing.
 *      The app should still *render* without a database (UI-only routes,
 *      build-time type checking, unit tests). `isDatabaseConfigured()`
 *      lets callers branch to the blob/memory fallback, and `getPrisma()`
 *      throws a clear error when someone tries to use it unconfigured.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma(): PrismaClient {
  if (!isDatabaseConfigured()) {
    throw new Error(
      '[db] DATABASE_URL is not set. Configure a Postgres connection string ' +
        '(Neon/Supabase/Vercel Postgres) to enable persistent storage.',
    );
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.prisma;
}

// Convenience re-export used by repository modules. Keep this LAZY — importing
// `prisma` does NOT throw if DATABASE_URL is missing; only calling a query does.
// (This matters because `src/lib/db/index.ts` is imported from routes that
// may legitimately run without a DB configured, e.g. static content routes.)
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any)[prop];
  },
});
