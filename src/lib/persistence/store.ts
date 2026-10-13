/**
 * Unified KV-like store interface for the PolicyOS freshness persistence layer.
 *
 * Two backends are provided:
 *   - {@link MemoryStore}: process-local Map, hydrated lazily from seed data.
 *   - {@link VercelBlobStore}: durable storage backed by `@vercel/blob`. Activated
 *     automatically when `BLOB_READ_WRITE_TOKEN` is present in the environment.
 *     Falls back to MemoryStore if the `@vercel/blob` package is not installed.
 *
 * Keys use a `prefix:id` convention (e.g. `contribution:abc123`).
 */

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  list<T>(prefix: string): Promise<T[]>;
  delete(key: string): Promise<void>;
  append<T>(key: string, item: T): Promise<void>;
}

// ─── Seed hydration ─────────────────────────────────────────────────────────
// We hydrate the in-memory store on first access (rather than at import time)
// so that importing this module is cheap and free of side effects. Each entity
// type is keyed into the store under a stable prefix.

type SeedPair = { key: string; value: unknown };

async function loadSeed(): Promise<SeedPair[]> {
  // Dynamic import avoids a circular dependency at module-init time: the
  // freshness store module is independent of this persistence module, but we
  // still prefer lazy loading so tests can stub it if needed.
  const seed = await import('@/lib/freshness/store');
  const pairs: SeedPair[] = [];

  for (const item of seed.auditLog) {
    pairs.push({ key: `audit:${item.id}`, value: item });
  }
  for (const item of seed.reviewQueue) {
    pairs.push({ key: `review:${item.id}`, value: item });
  }
  for (const item of seed.pipelineRuns) {
    pairs.push({ key: `pipeline:${item.id}`, value: item });
  }
  for (const item of seed.policyVersions) {
    pairs.push({ key: `version:${item.id}`, value: item });
  }
  for (const item of seed.scoreChanges) {
    pairs.push({ key: `score_change:${item.id}`, value: item });
  }
  // Contributions have no seed — they are purely user-authored.

  return pairs;
}

// ─── MemoryStore ────────────────────────────────────────────────────────────

export class MemoryStore implements Store {
  private data = new Map<string, unknown>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (!this.hydrating) {
      this.hydrating = loadSeed()
        .then((pairs) => {
          for (const { key, value } of pairs) {
            // Only set if absent — writes made before hydration finished win.
            if (!this.data.has(key)) this.data.set(key, value);
          }
          this.hydrated = true;
        })
        .catch((err) => {
          // If seed loading fails (e.g. in an environment without the
          // freshness module), continue with an empty store rather than
          // crashing. A single console.warn is enough — repeated callers
          // will see the cached `hydrated = true` path below.
          console.warn('[persistence] Seed hydration failed:', err);
          this.hydrated = true;
        });
    }
    await this.hydrating;
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureHydrated();
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureHydrated();
    this.data.set(key, value);
  }

  async list<T>(prefix: string): Promise<T[]> {
    await this.ensureHydrated();
    const out: T[] = [];
    const needle = prefix.endsWith(':') ? prefix : `${prefix}:`;
    for (const [k, v] of this.data) {
      if (k.startsWith(needle)) out.push(v as T);
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.ensureHydrated();
    this.data.delete(key);
  }

  async append<T>(key: string, item: T): Promise<void> {
    await this.ensureHydrated();
    const existing = this.data.get(key);
    const arr = Array.isArray(existing) ? (existing as T[]) : [];
    arr.push(item);
    this.data.set(key, arr);
  }
}

// ─── VercelBlobStore ────────────────────────────────────────────────────────
// Uses `@vercel/blob` if available. We intentionally do not `import` the
// package statically — it's an optional dependency. If it is not installed,
// or if any operation fails, we degrade to MemoryStore behaviour.
//
// Each key is stored as its own blob at pathname `policyos/<key>.json`.
// `list()` uses blob's prefix listing. This design trades a network round-trip
// per read for simplicity; good enough for V2.

type BlobModule = {
  put: (
    pathname: string,
    body: string,
    options: { access: 'public'; contentType?: string; token?: string; allowOverwrite?: boolean },
  ) => Promise<{ url: string }>;
  list: (options: { prefix?: string; token?: string }) => Promise<{
    blobs: Array<{ pathname: string; url: string }>;
  }>;
  del: (url: string | string[], options?: { token?: string }) => Promise<void>;
  head: (
    url: string,
    options?: { token?: string },
  ) => Promise<{ url: string; downloadUrl: string } | null>;
};

export class VercelBlobStore implements Store {
  private readonly prefix = 'policyos/';
  private blobModule: BlobModule | null | undefined = undefined; // undefined = not yet tried
  private fallback: MemoryStore | null = null;

  private async mod(): Promise<BlobModule | null> {
    if (this.blobModule !== undefined) return this.blobModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (await import('@vercel/blob' as any)) as BlobModule;
      this.blobModule = m;
    } catch {
      console.warn(
        '[persistence] @vercel/blob not installed; falling back to MemoryStore.',
      );
      this.blobModule = null;
      this.fallback = new MemoryStore();
    }
    return this.blobModule;
  }

  private pathnameFor(key: string): string {
    return `${this.prefix}${key}.json`;
  }

  async get<T>(key: string): Promise<T | null> {
    const m = await this.mod();
    if (!m) return this.fallback!.get<T>(key);
    try {
      const listing = await m.list({ prefix: this.pathnameFor(key) });
      const hit = listing.blobs.find((b) => b.pathname === this.pathnameFor(key));
      if (!hit) return null;
      const res = await fetch(hit.url);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      console.warn('[persistence] VercelBlobStore.get failed:', err);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const m = await this.mod();
    if (!m) return this.fallback!.set<T>(key, value);
    try {
      await m.put(this.pathnameFor(key), JSON.stringify(value), {
        access: 'public',
        contentType: 'application/json',
        allowOverwrite: true,
      });
    } catch (err) {
      console.warn('[persistence] VercelBlobStore.set failed:', err);
    }
  }

  async list<T>(prefix: string): Promise<T[]> {
    const m = await this.mod();
    if (!m) return this.fallback!.list<T>(prefix);
    try {
      const needle = prefix.endsWith(':') ? prefix : `${prefix}:`;
      const listing = await m.list({ prefix: `${this.prefix}${needle}` });
      const out: T[] = [];
      for (const b of listing.blobs) {
        try {
          const res = await fetch(b.url);
          if (res.ok) out.push((await res.json()) as T);
        } catch {
          // skip individual blob read failures
        }
      }
      return out;
    } catch (err) {
      console.warn('[persistence] VercelBlobStore.list failed:', err);
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    const m = await this.mod();
    if (!m) return this.fallback!.delete(key);
    try {
      const listing = await m.list({ prefix: this.pathnameFor(key) });
      const hit = listing.blobs.find((b) => b.pathname === this.pathnameFor(key));
      if (hit) await m.del(hit.url);
    } catch (err) {
      console.warn('[persistence] VercelBlobStore.delete failed:', err);
    }
  }

  async append<T>(key: string, item: T): Promise<void> {
    const m = await this.mod();
    if (!m) return this.fallback!.append<T>(key, item);
    const existing = (await this.get<T[]>(key)) ?? [];
    existing.push(item);
    await this.set(key, existing);
  }
}
