# PolicyOS

PolicyOS is an original policy-intelligence application for researching climate,
trade and immigration developments across countries. Its contest-era
improvement is a claim verifier that retrieves fresh sources with Tavily,
reasons over bounded passages with NVIDIA Nemotron models on Nebius Token
Factory, and exposes the evidence and call trail to the user. The application
also has a global country directory, a directly readable official-announcement
view, and a human-review boundary before any inferred policy update can affect
scores.

This is the **public source snapshot** prepared for the
[Nebius × NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/rules).
The [release scope](PUBLIC_RELEASE_SCOPE.md) explains which private research
records are deliberately excluded. The MIT license applies to original PolicyOS
code and documentation, not external websites or source data.
Open [PolicyOS](https://policyos-app.vercel.app/verify) to check a claim or inspect
a dated recording. Live verification requires funded providers, a shared database
and the cumulative model-budget guard described below. Historical recordings
remain explicitly dated: the EU AI Act walkthrough publishes one unchanged
European Commission passage out of seven adjudication inputs, identifies the six
withheld source URLs, and preserves the recorded verdict and call counts. The
separate BOE recording publishes its complete adjudication passages. Neither
recording is a fresh check.

The [V78 release receipt](RELEASE_V78.txt) records the latest deployment and
the authorized budget-expiry extension through December 15, 2026, noon Pacific.
The [V76 release receipt](RELEASE_V76.txt) records the earlier candidate's
hosted browser check, evidence-download/database comparison and promotion.
It is one known-case functionality check, not an accuracy estimate.
The [acceptance record](PREVIEW_ACCEPTANCE.md) documents earlier funded
Tavily/Nemotron runs and anonymous browser checks on a Vercel Preview. These
historical results do not establish current availability. Funded access throughout
the judging period and publication of the final video remain release requirements.

For a separate contest demo Vercel project, make an isolated source copy,
link it to that **separate** project, replace its `vercel.json` with
`vercel.demo.json`, then run `vercel deploy --prod` from the copy. Check
`vercel crons list` for zero jobs. Merely passing `--local-config` while the
original `vercel.json` remains in the upload still registers its scheduled
jobs on Vercel. The demo config keeps the shared database quota guards but
schedules no ingestion jobs; the main source tree retains the existing site's
scheduled jobs. Configure provider keys as sensitive server-side
variables, a reviewed database, and verified provider capacity before enabling
public live calls. A deployment without those services is only a static/demo
shell, not a working live-verification submission. For that read-only mode,
set `NEXT_PUBLIC_STATIC_DEMO_MODE=1` in the separate project's Production
environment before building. It visibly pauses live Tavily/Nemotron controls
and blocks their API routes even if keys are added later. Remove the flag and
redeploy only after provider access and a judge-safe quota have been checked.

## Policy event candidates

`/monitor` opens with policy event candidates over the currently loaded
official announcements. An empty announcement archive uses the existing bounded
official-source readers; a populated archive keeps its own search and pagination.
Every original title, source URL, source date and
provenance remains visible, with per-announcement save and verification links.
The announcement list remains available. JSON export includes group membership,
link reasons and unchanged source records; the existing CSV exports originals.

Groups require pairwise matches within 14 days, using a shared document URL,
a substantial matching headline, or conservative lexical similarity within
the same country/topic/language scope. Different title numbers and explicit
negations block similarity grouping. Every group is an unverified research
lead; similarity is not a legal-status or truth verdict. Groups cover only
loaded results, may change as more are loaded, and are not persistent event IDs.
Saved items remain browser snapshots and can be stale.

Two MIT-licensed AIHOT text utilities are pinned and attributed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The full AIHOT event engine,
models and live service are not used. Aggregation adds no model, embedding or
Tavily calls, background jobs, database tables or quota changes. Selecting a
verification link only pre-fills the verifier and remembers the original
source as unverified context; the visitor explicitly starts the paid check.

## What changed for the hackathon

The verifier at `/verify` was built after PolicyOS already existed as a policy
monitoring and scoring site. A live run uses the same pipeline implementation as
the headless verifier scripts:

```text
claim
  → decompose       Nemotron 3 Super 120B-A12B; Ultra fallback on transport failure
  → retrieve        Tavily Search, bounded calls
  → inspect         optional Tavily Extract, scoped official search and issuer HTML read
  → screen          Nemotron 3 Super 120B-A12B
  → adjudicate      Nemotron 3 Ultra 550B-A55B
  → roll up         supported / refuted / insufficient evidence
```

The API makes **runtime** calls to Tavily and Nebius Token Factory. It streams
actual stage events, stores Tavily request IDs in the run result, displays
source URLs and truncated passages, and exports a report with the exact
adjudication excerpts when a live run recorded them. The page's 13 claim
starters only fill the input; selecting one does **not** replay a prior verdict
or make a provider call. A separate dated BOE example can be opened without
keys; it shows one historical local run and the exact BOE passages submitted
to adjudication, while withholding earlier retrieval and screening passages.
Press **Verify** to run the current pipeline. Tavily Search and Extract share
a bounded call budget. Issuer HTML reads are separately bounded by host,
response size and timeout, and their origin is identified separately from
Tavily Extract in the exported evidence. A decomposition transport timeout
or network failure permits at most one further Nemotron call. The default
Super attempt is bounded at 15 seconds; its fallback uses Ultra, which passed
a separate forced-tool live check. Both attempts are counted and diagnosed.
If both default decomposition calls fail at the transport layer, the visitor
flow checks the original claim as one assertion with Tavily and the later
Nemotron stages. The page, result and exports identify this whole-claim fallback;
it loses atomic-assertion detail and still requires the remaining providers to
respond. Explicit model-comparison runs keep their selected model and fail
after two transport errors rather than silently changing method. Invalid
model output is not retried. The whole-claim path has only passed injected
offline tests so far; the linked Preview runs an earlier source version.

Open-web search is not restricted to issuing bodies. The interface identifies
recognized official hosts but does not treat a domain badge as proof that a
policy is in force. A source's publication date is not necessarily its
effective date. Confidence is the model's self-report, not a calibrated
probability. The optional source-page mode can improve grounding on some
claims and regress on others; [evaluation notes](EVALUATION_SUMMARY.md) retain
both successes and failures without claiming population accuracy.

When persistence succeeds, verification output enters the existing review queue as `ai_inferred` with
low confidence. The review resolver rejects this target type for automatic
country-score changes. A researcher must inspect and approve a policy update.
The final live result states whether its assertions were saved for review,
skipped because storage is unavailable, or failed to save. A failed or partial
review write does not erase the evidence report; the downloadable report
retains that storage status instead of implying persistence succeeded.

## Map and announcements

`/explore` has a World Bank country/economy directory of 217 entries, 211 with
coordinates. Fifteen pre-existing country score profiles are a separate data
layer. Thirty-six configured official-announcement connectors span 21
geographies; with the separate policy-source pipeline locations, 23
geographies have at least one configured source. These are configuration
counts, **not** 217-country live policy coverage. A selectable country can
have no connector, a connector can fail to read, and a fetched announcement
is a research lead rather than a verified in-force policy.
The self-hosted Natural Earth 1:50m backdrop has 242 geometry features,
improving the visibility of small places over the retained 1:110m asset; it
does not add policy data or determine legal jurisdiction. The 50m map lets
visitors click 188 polygons with an unambiguous World Bank directory-point
match. Remaining places stay accessible through the 211 markers and the
country/economy picker; no nearest-country guess is made for unmatched shapes.
The map can filter all geography, configured-source locations, and locations
with a score for the selected domain. Filtering changes the visible markers
and country picker; it does not create coverage where no source exists.
Every directory country links to `/verify` for a precise user-written claim.
The selected-country panel also has an on-demand Tavily Search action for each
of the three policy domains, including countries with no configured feed. It
uses one bounded Search call per uncached country/domain request and a
10-minute process-local cache. With PostgreSQL configured, a Serializable
audit-log reservation enforces a 60-call UTC-day ceiling across instances;
database errors fail closed before Tavily is called. Without PostgreSQL,
the local fallback has a 60-call daily cap per server process. Search
runs only when the visitor clicks Search.
For 28 countries with a known government-domain suffix, a separate
**Search country government sites** action restricts the single Tavily call
to those domains. Its cache key and shared quota reservation are separate
from the broad search. Returned URLs are checked again locally, since a
provider-side domain filter is not a trust boundary. Restricted results may
be agency homepages or source indexes rather than dated policy announcements;
the UI says so, and this action does not add a standing connector or score.
Countries without a concrete known suffix keep the broad search only.
The result requires a country name or accepted alias in the title or leading
excerpt, except for a known domain of that country's government. It avoids
confusing the two Koreas and Congos, and a generic page on a country-code
domain is no longer enough. A non-government lead also needs a policy-topic
term in its title; generic country profiles and investment-climate pages do
not become climate-policy leads. At most one link per other publisher host
and two per selected-country government host are shown from each five-hit
search. Within each source class, specific topic/action titles rank above
generic government homepages before the host cap is applied; this is a
discovery ranking, not a legal-status judgment. The conservative title filter
can miss relevant local-language or
generically titled pages. It shows source links, excerpts, separate labels
for the country's government and other recognized official domains,
search time, and Tavily request ID. These are discovery leads, not proof that a
policy is current or in force, and they never create a score or a standing
monitor. Availability depends on a configured `TAVILY_API_KEY`. The cache is
per server instance; `vercel.json` sets
`COUNTRY_RESEARCH_REQUIRE_SHARED_QUOTA=1` and
`VERIFY_REQUIRE_SHARED_QUOTA=1` for Vercel functions, so paid map search and
claim verification refuse to run without PostgreSQL even if Vercel system
variables are hidden. For other multi-instance hosts, set both flags; also set a provider-side
spend ceiling before sustained public traffic. The shared quota cannot be
claimed operational until tested against the actual deployment database.
The selected country is displayed as context only; the verifier retrieves fresh
sources for the actual claim and can return insufficient evidence. This allows
research outside the fixed feed registry without implying a standing monitor.

The announcement reader displays original titles, links, publication or
update dates, and actual collection status. It labels failed reads and stale
cached results. The verification page may receive an announcement as an
unverified lead, but a live run retrieves its own evidence.

## Run locally

Use Node.js 22 or newer. The production command uses Next's supported webpack
builder so its CSS worker does not need to bind a local port during build. It
uses the project's existing system-font stack without a remote font download.
A no-key preview provides the directory and public
announcement reader. It does not provide live inference:

```bash
npm ci
npm run build
npm run start
```

Open `http://localhost:3000/explore`, `/intelligence?country=MY`, and
`/verify`. Claim starters and the dated BOE recording load without keys; a live Verify request requires
both provider keys. Copy `.env.example` to `.env.local` and set:

| Variable | Purpose |
| --- | --- |
| `TAVILY_API_KEY` | Tavily Search and optional Extract at runtime |
| `NEBIUS_API_KEY` | NVIDIA Nemotron inference through Nebius Token Factory |

The database-backed review and scheduled ingestion paths additionally need a
PostgreSQL `DATABASE_URL`. On Vercel, live verification also requires that
database: a Serializable audit-log reservation is made before the first paid
call, with a configurable rolling 24-hour `VERIFY_DAILY_RUN_CAP` (default 12).
Failed and disconnected runs keep their reservation; an unavailable database
returns 503 before metered calls. Local development without a database keeps
the prior key-only path. Public hosts also require `VERIFY_MODEL_BUDGET_ID`,
`VERIFY_MODEL_BUDGET_USD` and an ISO timestamp in
`VERIFY_MODEL_BUDGET_EXPIRES_AT`. The campaign is cumulative across deploys;
reuse its ID and do not delete its audit rows to reset spending. A Serializable
transaction reserves $1.50 before each model request, then reconciles valid
reported usage with 25% headroom. Failed calls keep the full reservation;
missing usage or a ledger failure stops the run. Model rates were checked on
2026-10-13; operators must recheck pricing before extending the expiry. The
remaining balance must cover the full reservation, so admission can stop early.
`VERIFY_DAILY_ASSERTION_CAP` remains a secondary
completed-assertion check. These application limits are not provider billing
ceilings or proof that credits will last through judging. Review the migration
and seed behavior before using a database with data that must be retained.
When a verification completes, all of its review rows and audit entries commit
in one transaction; a failed write is reported separately from the evidence verdict.
Provider keys must never be placed in the browser bundle or committed to source
control.

Before another metered check, an operator with existing database access can run
`npm run verify:budget-audit` in an environment that already supplies
`DATABASE_URL` and the existing `VERIFY_MODEL_BUDGET_*` settings. It reads the
original campaign and rolling 24-hour counters in a PostgreSQL read-only
transaction. It does not load secret files, migrate, seed, reset or settle rows,
or contact Tavily/Nebius. Output contains only budget metadata and counters;
connection errors are sanitized. Do not paste credentials into the terminal
command or chat. An empty campaign is reported as needing review, not as new
funding. Exit 0 means the snapshot has no detected admission blocker; exit 2
means review or a limit is needed, and exit 1 means the audit could not run.
This does not prove provider funding, complete-run capacity, source accuracy,
or free access throughout judging. Known costs outside the campaign remain
separate. Never create a new campaign ID to obtain a reassuring audit result.

```bash
npm run type-check
npm run lint
npm test
npm run build
```

CI also runs `tests/integration/quota-postgres.test.ts` against a fresh
PostgreSQL 16 service after applying the repository migrations. Eight separate
Node processes compete for verifier slots, then eight compete for the last
country-research slot and eight for the cumulative model budget. The test checks
committed reservations, rolling-window expiry, settlement, duplicate-refund
rejection, and denial without a new reservation. It makes no provider calls and
requires an explicitly disposable local database named `policyos_ci`; it
refuses an existing audit history. Serialization conflicts may deny attempts
early, so the assertion is no overspending, not guaranteed concurrent throughput.

Offline tests and local builds do not prove provider availability, live
accuracy, sustained public access, or competition acceptance. The shared
Preview acceptance record proves selected anonymous browser runs with funded
Tavily and Nebius calls; judging still needs a working URL available throughout
its review period, verified provider capacity, and a video of the final build.

## Evaluation and reproducibility

### Saved verification evidence

New live results store one private `VerificationRun` snapshot containing the
complete verification result, exact retained adjudication excerpts, source
attribution, model diagnostics and tool request IDs. All assertion review items
and their audit entries commit in the same transaction as this snapshot.
The archive covers adjudication inputs, not full source pages or every earlier
retrieval/screening passage. Historical items without saved evidence stay
unlinked; the app never fills their gaps from today's web pages.

After applying migration `0010_verification_evidence` with `npm run db:migrate`,
an authenticated administrator can use **Download saved evidence** on the review
queue, even after the original verifier page has closed. The JSON endpoint
`/api/verify/records/<id>` requires the admin session and returns private,
non-cacheable attachments. Record IDs and cron credentials do not grant access.
Regular audit/review list APIs remain metadata-only. Browser-side exports still
work when persistence fails; an oversized archive fails visibly rather than
silently truncating its evidence. Existing application score guards are unchanged.

No migration or new code recreates missing evidence for old reviews. A source
record is evidence of what the model saw, not proof that the policy verdict is
correct or that a human has approved it.

### Dated evaluations

The [13 October hosted packet](EVALUATION_V65.txt) completed three predeclared
claims on the public app: three expected labels, but only one strict
whole-claim issuer-grounding pass. The report records the French and
New Zealand evidence gaps, exact source/deployment, calls, cost estimates
and remaining judge-access requirements.

[Evaluation summary](EVALUATION_SUMMARY.md) gives the recorded protocols,
selected-case results and failures. Exact retrieval passages and model inputs
from those dated evaluation runs remain in a separate private research archive
because the public source package has not established redistribution rights for
every publisher. The BOE example is a separate real run with exact adjudication
inputs, not a replay of those evaluations. Each packet identifies its tested build; it does not claim that judges can
reproduce old scores from redacted outputs. Anyone with
their own keys can run fresh claims through the shared production pipeline;
`npm run verify:seed` writes its raw evidence to ignored `private/` storage.

No World Monitor application code, dashboard assets or branding are used here.
The map directory is sourced directly from the World Bank API; third-party
terms and attribution boundaries are listed in [notices](THIRD_PARTY_NOTICES.md).
