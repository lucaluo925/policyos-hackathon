# Protected Preview acceptance — 13 October 2026 UTC

This is a narrow, observed run of the public-source snapshot, not an accuracy
study or evidence of an unrestricted judging URL. The reviewed source was
published as a single new Git commit (`1d0bdf6525f95ac8eedf44cf53e4ccefe8ada1a8`),
with no history from the original private repository. [GitHub CI passed](https://github.com/lucaluo925/policyos-hackathon/actions/runs/38338608931).
The same snapshot built on Vercel as Preview deployment
`dpl_xuE5tqQUnjkBpNVoRoyPonc1iMZM` at
`https://policyos-3lon47i8x-lucaluo925s-projects.vercel.app`.
Vercel Authentication protects this Preview, so an anonymous visitor is
redirected to login. Production was not replaced.

Using authenticated Preview access, `/explore`, `/verify`, and
`/api/system-status` each returned HTTP 200. The system endpoint reported
`ok: true`, a configured database, 13 source rows and 11 pipeline countries.
Those counts are live database state, not the 217-country directory size or
the source registry's 23 configured jurisdictions.

A new live request checked: “The EU CBAM definitive regime began on
1 January 2026.” The streamed pipeline completed in 6,907 ms with no error
events: two Tavily calls and three Nemotron calls (Super for decomposition
and screening, Ultra for adjudication). The Tavily request IDs were
`41c2dcb7-5443-474d-904e-a6448a2e693a` and
`01f96406-f7c1-40a9-a65a-f2dd1f408185`. The one assertion was labelled
`supported` and cited two European Commission pages:

- https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en
- https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en

Both cited URLs were present in the exact retained adjudication evidence;
both retained passages included the stated date and referred to the definitive
regime. The final event reported `reviewPersistence: saved` for one assertion.
A separate database read found one matching `low/pending` review row and one
matching `claim_verified` audit row carrying Tavily request IDs. This verifies
the successful-write path for this claim. A real database rollback fault test
has not been run; the transaction rollback is covered only by an isolated test.

One live map-search request used `QA`, `trade`, and the configured
`country-government` scope. It returned HTTP 200, Tavily request ID
`7c343da2-9535-4be2-9589-c574fed8bbb9`, and three government-domain
research leads. Some leads were a customs homepage or circulars index, so
they must not be described as three new policies. The UI warns that an
official-domain result can be a homepage or index and requires the visitor
to inspect issuing text and dates.

Still open before submission: browser interaction with the enlarged country
map, a public URL without Vercel Authentication, provider capacity through
the judging window, a new filmed run on the final hosted build, and the final
Devpost submission. This record does not assert broad policy-accuracy or
country-monitoring coverage.

A later predeclared negative-date probe on a documentation-only Preview
deployment ended with a decomposition timeout and no verdict. It is recorded
in the [evaluation summary](EVALUATION_SUMMARY.md), rather than counted as a
successful negative check. The subsequent bounded-timeout retry change passed
its own hosted acceptance: the independent AI Act date probe in the
[evaluation summary](EVALUATION_SUMMARY.md) completed as `refuted` after one
25-second decomposition timeout and one successful retry. It took 71 seconds
and remains a single known-fact smoke probe, not a reliability-rate estimate.
Vercel Authentication still prevents anonymous judging access to this Preview.
