/**
 * Persistence layer entry point.
 *
 * Exports a singleton {@link store} that auto-selects a backend:
 *   - {@link VercelBlobStore} when `BLOB_READ_WRITE_TOKEN` is set.
 *   - {@link MemoryStore} otherwise (the default for local dev and V2 deploys).
 *
 * To upgrade from Memory to Blob, add `BLOB_READ_WRITE_TOKEN` to the Vercel
 * project's environment variables — no code changes required. If `@vercel/blob`
 * is not installed, VercelBlobStore silently falls back to MemoryStore.
 */

export type { Store } from './store';
export { MemoryStore, VercelBlobStore } from './store';
export { store } from './singleton';
export * from './repositories';
