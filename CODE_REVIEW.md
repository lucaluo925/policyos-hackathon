# Code review log

Append-only. Newest entry at the bottom. Read this before touching code in
this repository: it records both confirmed findings and suspicions that were
checked and turned out to be wrong, so a later session does not re-investigate
the same ground.

---

## 2026-11-08 — OSIRIS merged in as a module (commit `66b8422`)

Reviewed with `ocr delegate` (open-code-review v1.13.6, delegation mode — no
code left the machine). 275 files in the commit.

### Coverage

| Class | Count | How it was established |
| --- | --- | --- |
| Vendored, byte-identical to upstream after the `@/lib` → `@/lib/osiris` and `@/components` → `@/components/osiris` import rewrite | 218 | Each file compared programmatically against `carbon-evolution/osiris@fabbc82` with the same rewrite applied |
| PolicyOS pages moved into the `(policyos)` route group | 34 | Each compared byte-for-byte against `b34d4ea:src/app/…` — 0 differ |
| Modified beyond the import rewrite | 5 | `api/ai/analyze/route.ts`, `api/temperature/route.ts`, `api/temperature/field/route.ts`, `api/temperature/field/sources.ts`, `api/temperature/fieldtile/route.ts` — all five changes are import repoints to the two extracted modules |
| Authored here | ~12 | `src/proxy.ts`, `eslint.config.mjs`, `vitest.config.ts`, `package.json`, `.env.example`, `THIRD_PARTY_NOTICES.md`, `(osiris)/layout.tsx`, `api/temperature/payload.ts`, `api/temperature/field/renderField.ts`, `lib/osiris/proxy-analytics.test.ts` |

The 218 vendored files were not line-reviewed: they are unmodified upstream
code, and reviewing 33k lines of third-party source is a separate exercise from
reviewing this merge. The two extractions were verified logic-identical to
upstream by diffing the moved region against the upstream pre-`GET` text with
only the export keywords and the dropped-import lines normalised.

### High

**1. Rate limiting fails open, and the only two routes behind it spend money.**
`src/lib/osiris/rateLimit.ts:22-23` returns `{ allowed: true }` whenever Redis
is unreachable — deliberate upstream behaviour for a self-hosted deployment
where Redis is part of the stack. This deployment is on Vercel with no
`REDIS_URL`, so `guardRequest` is a no-op. Only four routes call it, and two
are `/api/ai/analyze` and `/api/ai/briefing`, which fall back to
`GEMINI_API_KEY_1…8` from the environment when the caller sends no
`x-gemini-key` header. If those variables are ever set on the deployment, a
public URL gets uncapped third-party model spend with no throttle — the same
failure mode the `/verify` cumulative budget guard exists to prevent.
*Fix, smallest first:* leave `GEMINI_API_KEY_*` unset in production and let the
AI analyst run on the visitor's own key (the header path already takes
priority). If a server key is wanted, make `guardRequest` fail **closed** for
these two routes when `REDIS_URL` is absent, rather than relaxing the limiter.

### Medium

**2. `.env.example` omits the AI analyst's only server credential.**
`src/app/api/ai/analyze/route.ts:117` and `.../briefing/route.ts:66` read
`` process.env[`GEMINI_API_KEY_${i}`] `` for i = 1…8. The dynamic lookup is
invisible to a `process.env.NAME` scan, so these never made it into the env
template written in this commit. Anyone configuring the module from
`.env.example` cannot discover them.
*Fix:* add `GEMINI_API_KEY_1` … `_8` to the OSIRIS block, with the finding
above noted beside them.

**3. `/api/stats` needs `INTERNAL_ORIGIN` set or it returns empty counts.**
`src/lib/osiris/internalOrigin.ts:9` falls back to
`http://127.0.0.1:${PORT}`, and `api/stats/route.ts` fans out six internal
fetches to it. On Vercel each invocation is an isolated function, so loopback
does not reach the app. `Promise.allSettled` keeps it from throwing, so the
dashboard's status bar degrades to blank counts instead of erroring — easy to
miss. *Fix:* set `INTERNAL_ORIGIN` to the deployment's own origin. The variable
is already documented in `.env.example`.

**4. The on-disk caches never populate on Vercel.**
`api/temperature/payload.ts:80`, `field/route.ts:29`, `fieldtile/route.ts:60`
and `tile/route.ts:87` all write under `process.cwd()/.cache`. Every write is
inside `try { … } catch {}`, so the read-only filesystem is handled rather than
fatal — checked, this is not a crash. The consequence is cost, not
correctness: each request to the temperature field re-runs the IDW
interpolation and a 1440×640 `sharp` render, and re-fetches upstream. *Fix if
this layer gets used:* point the cache at `/tmp`, or front these routes with
`Cache-Control` / a CDN rather than the disk cache.

### Low

**5. The eslint override is wider than the problem.** `eslint.config.mjs`
turns off `no-explicit-any`, `no-img-element` and `exhaustive-deps` for whole
directories (`src/lib/osiris/**`, `src/components/osiris/**`, `src/workers/**`,
`src/app/api/cctv/**`, `src/app/api/maritime/**`). The errors were confined to
six files. Anything written into those paths later is unlinted for those rules.
Narrowing to the six files would keep the signal; it was not done because
upstream's own ratchet list is file-based and will drift.

**6. `/osiris` is set to be indexed.** `(osiris)/layout.tsx` keeps
`robots: { index: true, follow: true }`. A vendored OSINT dashboard indexed
under the PolicyOS domain is a positioning decision, not a defect — flagging it
so it is a decision rather than an accident.

**7. `vitest.config.ts` loads `.env` into the test process** via
`setupFiles: ['dotenv/config']` (upstream's setting). Harmless locally; worth
knowing before wiring these tests into CI with real secrets present.

### Checked and cleared — do not re-investigate

- **`/api/scanner` as an open scan relay.** `src/lib/osiris/scanner-access.ts`
  refuses remote callers with 403 unless `SCANNER_ACCESS_TOKEN` or
  `SCANNER_ALLOW_ANONYMOUS=true` is set, and its local-dev bypass is gated on
  `NODE_ENV === 'development'`. Safe by default on this deployment.
- **`/api/osint/shodan` burning an operator key.** It calls the keyless
  `internetdb.shodan.io`; no credential involved.
- **SSRF through the proxy-ish routes.** 17 route files import `ssrf-guard`,
  and the upstream hardening suite (`api/route-hardening.test.ts`,
  `api/scanner-access.test.ts`, now wired into `npm run osiris:test`) passes —
  including the path-injection and forged-Host cases.
- **OSIRIS Postgres colliding with the Prisma schema.** `db/postgres.ts` uses
  its own `PG_HOST`/`PG_DB` connection (defaulting to database `osiris`), never
  `DATABASE_URL`. No env-variable name collides between the two halves either.
- **Route path collisions.** All 79 OSIRIS API routes versus PolicyOS's 29:
  zero collisions, and no shared top-level segment.
- **The two temperature extractions changing behaviour.** Verified
  logic-identical to upstream, module-level memoisation (`landFcPromise`) and
  cache constants included.
- **The `(policyos)` move touching page content.** All 34 files byte-identical
  to pre-merge.

### Verification state at this commit

`tsc --noEmit` clean · `eslint --max-warnings 0` clean · `next build` clean
(62 static pages, 108 API routes) · PolicyOS tests 629/629 · OSIRIS tests 118
passed, 6 skipped. Four OSIRIS suites (`cache`, `rateLimit`, `feedStore`,
`db/postgres`) fail on `ECONNREFUSED` alone and need `npm run osiris:data:up`;
they connect in `beforeAll` with no availability guard, which is upstream
behaviour, not a merge regression.

Separately: `next build` reports that **Next 16.4.0 is affected by a known
security advisory** and recommends `next upgrade --agent=security`. Not
introduced by this merge — it is the version the repository was already on.
