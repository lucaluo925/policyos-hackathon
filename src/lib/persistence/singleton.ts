/**
 * The persistence-layer singleton. Pulled into its own module so
 * `repositories.ts` and `index.ts` can both depend on it without forming an
 * import cycle.
 */

import { MemoryStore, VercelBlobStore, type Store } from './store';

export const store: Store = process.env.BLOB_READ_WRITE_TOKEN
  ? new VercelBlobStore()
  : new MemoryStore();
