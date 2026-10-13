# Dated verification evaluation summary

These are development research results collected on 11–12 October 2026,
before this public-source package excluded the full archived responses. Each
packet fixed its claims and protocol before its own provider calls, but the
case sets were small, developer-selected, correlated and reviewed by a
development assistant rather than an independent expert. The raw provider
responses and exact adjudication passages remain in a private local archive.
The figures here are historical observations, not a fresh holdout of this candidate,
population accuracy estimate, legal correctness claim or demonstration of a
working public deployment. The v27 cross-region packet below predates the
v28 source-window repair and retains its original outcomes.

| Packet | Search-only | Enhanced retrieval | Observed limit |
| --- | --- | --- | --- |
| First source-inspection pilot, 8 selected assertions | 5/8 expected labels | 8/8 expected labels | Two differences were confounded by failed baseline adjudication; only one UK–Malaysia missing-passage recovery was reviewed without that confound. |
| Paired issuer-source check, 5 claims | 4/5 labels; decisive issuer passage 5/5 | 5/5 labels; decisive issuer passage 4/5 | One Search-only error involved truncated adjudication; enhanced Canada replaced a decisive excerpt with a generic one. |
| Post-repair check, 5 new claims | 5/5 labels; decisive issuer passage 4/5 | 5/5 labels; decisive issuer passage 3/5 | Norwegian, South African and Hong Kong passage gaps remained in frozen first runs. |
| Fresh check, 5 new claims | 4/5 labels; decisive issuer passage 3/5 | 4/5 labels; decisive issuer passage 3/5 | Australia decomposition lost a qualifying group; enhanced EU lost a decisive Commission threshold. |
| Current-source check, 4 new claims | 4/4 labels; strict whole-claim issuer grounding 1/4 | 4/4 labels; strict grounding 2/4 | Additional official Search/Extract requests and stochastic draws prevent isolating Extract's effect. |
| New-case check, 4 claims | 4/4 labels; strict grounding 0/4 | 3/4 labels; strict grounding 2/4 | Enhanced UK ETA regressed to unresolved; Malaysia lacked tax-authority passage. |
| V15 prospective check, 4 claims | 4/4 labels; strict grounding 1/4 | 3/4 labels; strict grounding 1/4 | EU used an obsolete recital; WTO inference hit an output-length limit. |
| V21 BOE metadata holdout, 2 Spanish laws | Both insufficient evidence | 2/2 labels and BOE whole-claim grounding | Two laws; enhanced mode combined Search, Extract and direct BOE metadata, so no single-component effect is isolated. |
| V27 cross-region first run, Singapore GST and UAE Corporate Tax | 2/2 labels; exact-scenario issuer grounding 1/2 | 2/2 labels; exact-scenario issuer grounding 1/2 | The Singapore Search verdict cited a third party. Enhanced retrieval cited IRAS but omitted its most direct full-prepayment example from the retained passage; no label advantage was observed. |
| V30 new-policy holdout, UK sick pay and NZ visa/levy | 1/2 labels; strict grounding 1/2 | 2/2 labels; strict grounding 1/2 | The UK enhanced overall label matched for the wrong premise, and its decisive assertion cited only a secondary source. |
| V31 fresh holdout, Canadian PGWP exception and EU EES | 2/2 labels; strict grounding 1/2 | 2/2 labels; strict grounding 1/2 | The Canadian official excerpt in enhanced mode omitted the decisive before-date condition; Search cited a blog. |
| V32 fresh holdout, Australian super payment timing and US clean-vehicle credit | 2/2 labels; strict grounding 1/2 | 2/2 labels; strict grounding 1/2 | The Australian decisive assertion cited secondary sources in both modes, although an exact ATO passage was available to an earlier enhanced assertion. |
| V33 fresh holdout, Canadian wildfire refund and UK steel contract transition | 2/2 labels; strict grounding 0/2 | 1/2 labels; strict grounding 1/2 | The UK enhanced decomposer dropped the contract-date qualifier from one warehouse assertion, creating a false refutation despite an exact GOV.UK passage. |
| V34 fresh holdout, NZ first-year Fees Free and Australian fixed-term contracts | 2/2 labels; strict grounding 1/2 | 2/2 labels; strict grounding 1/2 | Both Australian modes grounded the transition rule in Fair Work Ombudsman material. Both NZ modes matched the label without the decisive TEC fee-incurred cutoff in their exact adjudication input. |

A separate historical end-to-end challenge used six predeclared claims and
observed six label matches, zero stage errors and zero unseen citations over
11 Tavily Search and 28 model requests. Full issuing-body grounding was weaker
than label matching. This is a small selected challenge, not an accuracy rate.

Known-case development reruns after packets were frozen helped repair year
qualification, source-language selection, official-domain scoped searches,
screening truncation and explicit legal-date amendments. They are exposed
regressions, not independent holdouts and do not change the original scores.
After the v27 packet was frozen, the v28 source selector was changed to align
the payment year with the later delivery year before choosing a page window.
In a later v29 local live rerun of that **same known Singapore case**, enhanced
retrieval reached the official IRAS page but returned insufficient evidence:
the generated assertion said “paid for in full,” which the selector's
“paid in full” pattern did not recognize. The v30 pattern covers both wordings.
A second local live rerun of the exposed case completed with five Tavily and
five model calls, zero stage errors, and a refuted overall verdict. Its exact
adjudication input for the decisive assertion contained the IRAS Scenario 1
payment-in-2023, receipt-in-2024 and 8% passage; the verdict cited that same
IRAS URL. The full result remains private because it includes other
publishers' excerpts. These are **debugging runs on an exposed case**, not
additional first-run successes, an independent holdout or proof of broader
accuracy.

The v33 development change passes the most recently cited issuing-body
passages to later assertions before their own screening and adjudication. A
single live rerun of the now-exposed Australian v32 case cited the ATO's exact
payment-date and earlier-pay-period passage in the decisive assertion. This is
debugging evidence only; it does not replace either v32 first run or establish
v33 performance on new claims.

V34 adds a conservative safeguard for an entitlement split that drops its
dated-contract condition, plus a scoped-search check for a named facility
route missing from a general issuer summary. One live rerun of the exposed UK
steel claim returned supported and cited the exact GOV.UK warehouse paragraph.
The open Search draw in that rerun also found that paragraph, so the result
does not isolate the scoped-search change's effect. It is another development
regression check, not a replacement for the v33 first run.

The live code remains inspectable in `src/lib/verify/`. It shares the pipeline
between the API and headless scripts. The public source package supports a
fresh run with your own Tavily and Nebius credentials, and includes one separate
BOE adjudication-only example from a local v25 run. It intentionally cannot
replay the withheld evaluation inputs or the example's earlier retrieval and
screening passages. Any public presentation
must state that limit and show a real current run to demonstrate functionality.

## Current-lineage local live smoke

The v37 production server received the same simple, predeclared EU CBAM date
claim twice: “The EU CBAM definitive regime began on 1 January 2026.” Both
runs completed without stage errors and returned supported in 8.552 and
8.297 seconds. Each made two Tavily calls (Search and Extract) and three
Nemotron calls, then cited two European Commission pages whose decisive date
appeared in that assertion's exact retained adjudication input. The Tavily
request IDs differed between runs. Database persistence was disabled. The
v38 verifier source and API route are byte-for-byte identical to v37, and the
v39 release commit changes only documentation. The v40 map-relevance
revision does not change the verifier's classification behavior. The v41
revision recognizes the UAE government portal as an official domain, so it
can affect source ordering for UAE claims. These are two local demo checks on
an easy positive claim, not fresh hosted evidence, a held-out accuracy
estimate, or proof of judging-period availability. Raw provider passages
remain outside this public package except for the exact BOE adjudication
passages in the dated example.

## Map-search development check

Before six one-call Tavily searches, a cross-region map-search protocol fixed
Mexico/trade, Peru/climate, Kenya/immigration, UAE/trade, Thailand/climate and
Czechia/immigration. The v40 country filter retained links in every case,
but none of the six result lists contained a recognized government-domain
page for the selected country. Mexico's five links were generic country
profiles, Peru included a U.S. "investment climate" page in a climate-policy
search, Czechia's five links came from one secondary publisher, and a relevant
UAE government-portal tariff page was filtered out. These are concrete
development failures, not a representative 217-country accuracy estimate.

The subsequent v41 filter requires a topic signal, caps repeated publisher
hosts and recognizes the UAE portal. Two new live development reruns found
four topical Mexico leads and no qualifying UAE leads; separate Tavily draws
prevent a controlled before/after quality claim. The v41 test and build checks
do not establish live map accuracy or a policy's legal status. No new verifier
holdout was run for the shared official-domain classifier change.

A later predeclared Qatar/trade development probe made one basic Tavily Search
restricted to `gov.qa`. All five returned URLs were Qatar government hosts,
whereas an earlier unrestricted browser run had three retained secondary
leads and no Qatar government URL. These were different provider draws, so
their counts are not a controlled improvement estimate. The restricted list
also contained a customs homepage and source index: five government URLs do
**not** mean five policies. The new user-selected government-site mode uses
one bounded call per click, checks the returned hosts again and labels such
pages as places to inspect. Its effect across the other 23 countries with
configured government-domain search remains unmeasured.

A subsequent predeclared four-case government-site packet found 3/4 nonempty
restricted result lists: Brazil/climate returned three topic or plan pages,
India/immigration was empty, Switzerland/trade returned three links, and
South Africa/immigration returned four. All 15 raw URLs in the nonempty
cases passed the selected-country government-domain test, but many were
portals, news agencies or undated topic pages rather than issuing-body
clauses. The Swiss first run exposed a ranking defect: SECO's homepage and
relations overview occupied its two-host cap while two more specific
free-trade-agreement pages were discarded. A subsequent ranking repair
uses concrete topic/action titles before applying the host cap, and its
offline regression test covers that exposed case. No fresh provider holdout
has yet measured whether this repair improves other countries or causes
new misses.

Four additional government-domain search configurations cover Saudi Arabia,
Kenya, the Philippines and Nigeria. A predeclared one-call development packet
on SA/climate, KE/immigration, PH/trade and NG/climate returned nonempty
filtered lists in 2/4 cases: the first two were empty, the Philippines had
five retained links and Nigeria had three. All eight retained URLs matched
the selected country's configured government suffix, but two Philippine
links were a generic homepage and institutional history page. A narrow
navigation-title filter now excludes those exposed false leads in an offline
regression test; no fresh provider holdout measures its broader effect.
Government-domain matching is not issuer or legal-status verification. The
new suffixes are shared with the verifier's source ordering, for which no
new holdout was run.

## Protected Preview reliability probe, 13 October 2026 UTC

The public-source v52 Preview completed one live positive EU CBAM start-date
claim in 6.9 seconds with two Tavily and three Nemotron calls, two cited
European Commission passages, and a confirmed low-confidence human-review
write. [The narrow acceptance record](PREVIEW_ACCEPTANCE.md) preserves the
request IDs and storage check. It is a known positive development claim, not
an independent accuracy sample.

A counterfactual minimal pair was fixed in a local pre-call plan (retained
outside this public repository) before a second Preview request: “The EU CBAM
definitive regime began on 1 January 2025.” The expected verdict was
`refuted`. That request **did not produce a verdict**. The first
Nemotron decomposition call waited until its 90-second client timeout and
the route emitted a sanitized decomposition error; no Tavily call followed.
This is a reliability failure, not a refuted label or a false positive. The
then-current source shortened each decomposition attempt to 25 seconds and permitted
one retry only for timeout or network failure, counting both attempts.
Isolated transport tests cover this behavior. A later hosted run of the
changed code is described below; it does not erase the failed CBAM probe.

## Bounded-retry Preview probe, 13 October 2026 UTC

Before a new request, a separate local plan fixed the statement “The EU AI
Act entered into force on 1 August 2025” and expected `refuted`. The
[European Commission](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
states that entry into force was 1 August 2024; the later dates when specific
obligations apply are distinct. This known-fact smoke probe was not a blinded
holdout or a rerun of the failed CBAM case.

The new source commit `6347beabe8c11d6a3814787758f23d0ec2fcea76`
passed [GitHub CI](https://github.com/lucaluo925/policyos-hackathon/actions/runs/38339994391)
and built as protected Vercel Preview deployment
`dpl_Cn1EYaS6EZsrsqXeop6vPcwjsbpF`. Its `/verify`, `/explore`, and
`/api/system-status` routes returned HTTP 200 through authenticated Preview
access. The health endpoint reported 13 source rows and 11 pipeline countries.

The live AI Act request completed with one `refuted` assertion, citing that
Commission page. The cited page and both the actual and misstated years were
present in the retained adjudication evidence. It took 71,434 ms, made three
Tavily calls and four Nemotron attempts, and reported one saved review row.
The first decomposition attempt timed out at 25,004 ms; the single retry
returned a tool result after 19,616 ms. Screening and adjudication then
completed. This is direct hosted evidence that the new timeout-and-retry path
ran successfully once. It also exposes substantial latency and extra provider
cost; a further timeout would still fail. The completed request's Tavily IDs
were `26e8a948-de8e-4eba-b019-a5021e060c71`,
`a222df55-e333-4c70-bb4e-abb7f9a8b31f`, and
`ceebd2b2-4e66-489c-ab6c-d0a9fe70046d`. These observations do not
establish overall classification accuracy or sustained provider capacity.

## Anonymous-share browser check and fallback development, 13 October 2026 UTC

A Vercel Shareable Link for the protected Preview was created after the
account's External Access screen showed no existing external access. A fresh
browser session opened the homepage, map and verifier without a Vercel login.
On the map, selecting Qatar and Trade then pressing the government-site
search returned three labelled government-domain research leads, Tavily ID
`2c1c3f6f-4a22-4323-abec-fced0ed968f7`. The leads included a customs
homepage and circulars index; this is working navigation and retrieval, not
three verified policies.

Before clicking Verify in that anonymous browser, a local plan fixed the known
positive CBAM claim and required a completed `supported` result with an
official citation. **This browser run failed** during decomposition: the page
showed only a sanitized error (reference `db80246f`), no final verdict, and no
evidence-search stage. The corresponding Vercel log contained an abort
diagnostic. The same claim was not retried to rescue the result. This failure
shows that a single same-model retry is insufficient for reliable public demo
operation, despite the separate successful hosted AI Act retry above.

A separate, single forced-tool call asked Nemotron Ultra to decompose a
different simple AI Act claim. It returned HTTP 200 with one valid assertion
in 3,515 ms. This is a capability and latency check, not a comparative
reliability rate. The next source revision changes only the default
decomposition transport fallback: Super has a 15-second bound, then Ultra gets
one attempt on timeout or network failure. Explicit model overrides remain on
the selected model so comparison probes do not silently switch candidates.
The new revision's ordinary hosted path was checked separately below; the
fallback branch still needs a live observed timeout. The anonymous browser
failure belongs to the previous 25-second same-model retry deployment.

## Ultra-fallback build hosted smoke, 13 October 2026 UTC

The fallback source commit `b804a57d7c0d13ccafd81108e879853b3a9e22f9`
built as protected Vercel Preview deployment
`dpl_zGy4zEe1pnHgF6NHm4bB3eB3BPRS`. Its status endpoint returned `ok:
true`, 13 source rows and 11 pipeline countries. A predeclared one-call smoke
checked “The EU AI Act entered into force on 1 August 2024,” expecting
`supported` with an official citation. The streamed run completed without an
error in 6,557 ms: one supported assertion, two Tavily calls, three Nemotron
calls, and one saved review assertion. It cited the
[European Commission notice](https://commission.europa.eu/news-and-media/news/ai-act-enters-force-2024-08-01_en)
alongside four secondary pages; the official cited URL and date were in the
retained adjudication evidence. Tavily request IDs were
`0595fb8b-8b07-4dc5-9160-8407d59939b7` and
`b4d8a407-f7b9-4470-be13-480596b4f78b`.

Super decomposition returned in 1,343 ms on this run, so Ultra fallback was
**not exercised** by this hosted probe. The observed result supports the
ordinary path on the new build, while the fallback itself is covered by an
injected timeout test and a separate one-call Ultra capability check. The
initial CI run for this source commit failed only on an unused variable in
that new test file. Commit `aab25d5fdd9c3e12099a8cb1156308e730cccfd7`
fixed the warning, and [CI run 38342057131](https://github.com/lucaluo925/policyos-hackathon/actions/runs/38342057131)
passed. Neither the older anonymous failure nor this success establishes an
end-to-end reliability rate.

## Anonymous browser acceptance of the shared Preview

With explicit owner approval, Vercel's single Hobby shareable-link slot was
moved from the older Preview to `dpl_zGy4zEe1pnHgF6NHm4bB3eB3BPRS`; the old
link redirected an anonymous request to Vercel login. A fresh unauthenticated
cookie jar returned HTTP 200 for `/`, `/verify`, and `/explore` on the new
share link. In a separate unauthenticated browser, the same predeclared AI Act
claim was entered with official-source page reading enabled. The UI reported
one supported assertion after about 8 seconds, two Tavily calls (Search and
Extract), three Nemotron calls, five cited URLs (one recognized official
domain), and one assertion saved for human review. Its displayed European
Commission passage included the exact claim date. Tavily request IDs were
`f767942d-096b-4f0c-86fd-fe236f14921c` and
`21474503-acc1-439f-b467-ee0bc80a85c1`.

This is one successful anonymous browser flow on the new Preview. It neither
exercises the Ultra decomposition fallback nor cancels the earlier browser
failure. No reliability percentage is inferred from these few selected runs.

## Final shared Preview: negative-date browser check

Before a further provider call, a local plan fixed the false claim “The EU AI
Act entered into force on 1 August 2025” and required `refuted` with an
official source that states the correct entry-into-force date. In the shared
Preview's anonymous browser, with source-page reading enabled, the run
returned `refuted` in 11,169 ms. The three Tavily calls included open Search,
scoped official-domain Search and Extract; three Nemotron calls completed and
one assertion was saved for human review. The only cited URL was the
[European Commission's AI Act timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai),
whose exact Extract passage supplied to adjudication distinguishes entry into
force on 1 August 2024 from the later application of particular obligations.
Tavily request IDs were `53765503-93f3-4450-9ec8-2cdfe065aeaa`,
`e537df30-821d-4a72-a767-3a1e197bc7a1`, and
`28561b6b-f114-418e-9566-84e165addc56`.

The browser's Markdown and JSON exports were downloaded and checked locally:
both preserved the false claim, `refuted` verdict, official cited URL, request
IDs and model roles. The JSON reported seven retrieved documents, three Tavily
and three model calls, and a saved review assertion. Raw third-party excerpts
from these exports remain in the private evidence folder. This repeats a
known-fact claim used on an older build; it is final-Preview smoke evidence,
not a new holdout or a reliability estimate.

## Whole-claim transport fallback, source-only check

After the shared Preview build, the source gained a further recovery path for
the ordinary visitor flow: if both the Super and Ultra decomposition calls
fail with timeout or network errors, it sends the original claim unchanged to
Tavily Search as one assertion. Screening and adjudication still require live
Nemotron calls. The report labels the decomposer as absent, records the two
failed attempts, and states that no atomic splitting occurred. The page also
shows that limitation beside the verdict rather than marking decomposition
as successful. Explicit model-comparison runs retain their fixed model and
stop after two failures;
malformed model responses do not trigger this fallback.

Injected offline tests exercise timeouts and network errors through the
pipeline and the actual API event stream, including Tavily search and a later
verdict. They establish the control flow only. No live provider run, anonymous
browser check, or reliability estimate exists for this new path. The currently
shared Preview predates it.
