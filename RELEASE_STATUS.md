# Dated application release status

Checked 14 October 2026. This is a release receipt, not a claim that the entry
is complete, submitted, eligible for every award, or guaranteed to win.

## Deployed application

- Public app: [claim verification](https://policyos-app.vercel.app/verify),
  [policy events](https://policyos-app.vercel.app/monitor) and
  [country research](https://policyos-app.vercel.app/explore).
- Independent Vercel project: `policyos-hackathon-demo`; no scheduled cron jobs.
- Application source: [`e779293ffea39d690a8229ee5a5a1267f8061483`](https://github.com/lucaluo925/policyos-hackathon/commit/e779293ffea39d690a8229ee5a5a1267f8061483).
- [CI for that exact source](https://github.com/lucaluo925/policyos-hackathon/actions/runs/38651493349):
  successful, including 604 offline tests and disposable PostgreSQL checks.
- Deployment: `dpl_PmePkhUaVZUDtJFDmNmkUJ8V4HhN`, READY. The public alias was
  explicitly assigned to it. Anonymous page and read-only status checks passed.

Repository documentation can advance independently of the compiled app. This
receipt identifies the application source rather than equating every later
documentation commit with a new deployment or provider test.

## What the current checks prove

[V87](RELEASE_V87.txt) adds country-search recovery, original-source handoff and
search-lead JSON export. Local browser checks used clearly marked simulated API
responses, with no provider credentials: timeout, manual stop, failed refresh,
safe invalid-response handling, retained search details, downloaded JSON and
source handoff were exercised. Opening a lead did not submit verification.
These checks are implementation evidence, not new live Tavily/Nemotron acceptance.

[V76](RELEASE_V76.txt) remains the last paid hosted acceptance in this release
packet: one familiar New Zealand claim, with its downloaded result compared to
the saved database evidence. It does not establish current latency, independent
accuracy or acceptance of every later build. The initial two-new-case result
remains 2/2 expected labels and 1/2 strict official-evidence passes; the later
German repair is a familiar-case retest. See [evaluation history](EVALUATION_SUMMARY.md).

## Access preparation and remaining gates

The [judge entrance](https://policyos-app.vercel.app/judge) is implemented and
tested but **disabled**, pending organizer confirmation. It grants no admin or
private-review access. No judge credential has been configured or distributed.
The [authorized clarification thread](https://nebiusglobalaihackathon.devpost.com/forum_topics/45534-clarifying-free-judging-access-for-apps-with-metered-apis)
had zero comments at the latest 14 October read. This is not an organizer waiver.

The original campaign, cumulative budget, expiry and shared limits remain in
force. The owner-approved historical-cost checkpoint was applied and its
missing-checkpoint stop requirement enabled on 14 October; see [V88](RELEASE_V88.txt).
The original model rows were preserved. This does not establish complete
lifetime provider billing or authorize further spending. An
application availability response is advisory: it does not check provider
credits, reserve a run or guarantee completion. Private credentials, finite
funding and shared caps do not by themselves prove free unrestricted judging
access. [V78](RELEASE_V78.txt) extended the configured expiry to 15 December
2026 at 20:00 UTC; that extension does not resolve capacity or provider-credit
expiry. No budget expansion or limit bypass is included.

Under the [official rules](https://nebiusglobalaihackathon.devpost.com/rules),
submission closes 30 October 2026 at 10:00 Pacific; testing access must last
through 15 December at noon Pacific. Runtime Nebius/NVIDIA use and a runtime
Tavily call for the Tavily award are required. Source, setup, English materials,
technology feedback and prior-project updates must accompany the entry.
The public YouTube demonstration must be under three minutes.

The English story is a review draft. Owner narration, final synchronized video,
authorized YouTube publication, finalized testing access/instructions and final
Devpost submission remain outstanding. No final submission has been made.
Historical recordings and exports are supplementary, not substitutes for live
testing access. The MIT license and [third-party notices](THIRD_PARTY_NOTICES.md)
describe code and data boundaries; they do not license every external source or
mark for a public video. No external adoption or measured time savings is claimed.
