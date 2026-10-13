/**
 * Database module barrel.
 *
 * This module is the single import surface for everything DB-related:
 *   - `prisma` / `getPrisma()` / `isDatabaseConfigured()`: low-level client
 *   - `repositories`: typed CRUD helpers for each entity
 *   - `pipeline`: the reusable ingestion/update pipeline framework
 *
 * When `DATABASE_URL` is not set, repository helpers fall back to the
 * legacy blob/memory store in `src/lib/persistence` so that the app still
 * works in preview/dev without a DB. See the README in this folder.
 */

export {
  prisma,
  getPrisma,
  isDatabaseConfigured,
} from './client';

export * as countryRepo from './repositories/countries';
export * as policyRepo from './repositories/policies';
export * as sourceRepo from './repositories/sources';
export * as scoreRepo from './repositories/scores';
export * as auditRepo from './repositories/audit';
export * as pipelineRepo from './repositories/pipelines';
export * as contributionRepo from './repositories/contributions';
export * as reviewRepo from './repositories/reviews';
