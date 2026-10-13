# PolicyOS

PolicyOS is an original policy-intelligence prototype for researching climate,
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
An [acceptance record](PREVIEW_ACCEPTANCE.md) documents one funded Tavily/Nemotron
run and one country search on a Vercel Preview. That Preview is login-protected;
the unrestricted public demo required for judging is still pending.

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
Invalid model output is not retried.

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
the prior key-only path. `VERIFY_DAILY_ASSERTION_CAP` remains a secondary
completed-assertion check. These application limits are not provider billing
ceilings or proof that credits will last through judging. Review the migration
and seed behavior before using a database with data that must be retained.
When a verification completes, all of its review rows and audit entries commit
in one transaction; a failed write is reported separately from the evidence verdict.
Provider keys must never be placed in the browser bundle or committed to source
control.

```bash
npm run type-check
npm run lint
npm test
npm run build
```

Offline tests and local builds do not prove provider availability, live
accuracy, unrestricted public access, or competition acceptance. The protected
Preview acceptance record proves one narrow live run with funded Tavily and
Nebius calls; judging still needs an unrestricted URL, verified provider
capacity for the judging period, and a video of the same deployed build.

## Evaluation and reproducibility

[Evaluation summary](EVALUATION_SUMMARY.md) gives the recorded protocols,
selected-case results and failures. Exact retrieval passages and model inputs
from those dated evaluation runs remain in a separate private research archive
because the public source package has not established redistribution rights for
every publisher. The BOE example is a separate real run with exact adjudication
inputs, not a replay of those evaluations. The summary does not represent a new
test of this candidate or claim that judges can reproduce old scores from
redacted outputs. Anyone with
their own keys can run fresh claims through the shared production pipeline;
`npm run verify:seed` writes its raw evidence to ignored `private/` storage.

No World Monitor application code, dashboard assets or branding are used here.
The map directory is sourced directly from the World Bank API; third-party
terms and attribution boundaries are listed in [notices](THIRD_PARTY_NOTICES.md).
