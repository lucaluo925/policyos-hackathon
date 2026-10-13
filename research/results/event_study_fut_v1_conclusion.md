# Event study fut_v1 — conclusion

**Question.** Do US Section 301 tariff actions against China move CBOT agricultural
futures through the expected-retaliation channel, and specifically soybeans relative
to corn?

**Why futures here and nowhere else in this folder.** The other two studies cover
export controls on semiconductor equipment and on critical minerals. Neither has a
liquid futures contract on the restricted good — there is no tradeable gallium,
germanium, antimony, graphite or rare-earth contract — so a futures test there would
measure instruments the policy does not target. Section 301 actions are different:
the retaliation they provoked fell on US agricultural exports, where the targeted
good is the deliverable of a liquid contract.

**Design.** Pre-registered in `hypotheses_fut_v1.json` on 2026-10-10, before any
futures price data was pulled (verified at the time: the cache held 24 series, none
of them a futures contract). Event set frozen in
`events/frozen_events_fut_v1.csv`, hash in `events/FROZEN_fut_v1.json`: 10 action
events and 25 control events, 2018-01-01 to 2019-12-31, selected from
`fr_events.csv` by a title rule recorded in the registration. Market model,
estimation window [-250,-30], primary window [0,+1], one-sided t at alpha/2 across
two primaries, 1,000-draw placebo.

## Result: no support for either primary hypothesis

| Hypothesis | Basket | Expected | n | mean CAR[0,1] | t p | sign p | placebo p |
|---|---|---|---|---|---|---|---|
| HF1 (primary) | soybeans benchmarked on corn | negative | 10 | **+0.14%** | 0.613 | 0.623 | 0.630 |
| HF2 (primary) | soybeans, benchmark DBC | negative | 10 | −0.31% | 0.232 | 0.377 | 0.185 |
| — (secondary) | corn, benchmark DBC | — | 9 | −1.06% | — | — | — |

HF1, the better-identified test, came out with the **wrong sign** and nowhere near
significance. HF2 has the predicted sign but a p-value five times the threshold.
Neither passes.

**The control arm behaves as it should.** The same pipeline on the 25 exclusion
events (16 after the 5-session clustering rule) gives a spread of +0.26%, p = 0.750,
and no significant move in either leg. So the null on the action arm is a null, not
a design that cannot detect anything.

**The most informative number is corn.** Corn fell 1.06% around these events while
soybeans fell 0.31% — the opposite of the ordering the retaliation story predicts,
and the reason the spread came out positive. Whatever moved grain markets in these
windows was not specific to the commodity China was retaliating against.

## What this does not establish

A null with n = 10 is weak evidence of no effect, as the registration said in
advance. Three readings survive this result and are not separated by it:

1. **The filing instant is the legal instant, not the information instant.** These
   actions were trailed for weeks in Presidential statements and press briefings.
   The Federal Register public-inspection timestamp is the earliest a participant
   could read the *document*, which this study treats as the event; it is not the
   earliest they could trade the *news*. This is the explanation I find most likely,
   and it is a hypothesis, not a finding — testing it needs an announcement-date
   series this project does not yet have.
2. Soybean futures in 2018-2019 were absorbing weather, biofuel policy and dollar
   moves of similar magnitude; a 2-day window may be too narrow against that noise.
3. The retaliation channel may genuinely be priced at the Chinese announcement
   rather than the US one. This project's event corpus is US-side only.

## Limitations

- Front-month continuous series roll between contracts; the roll convention of the
  price source is not controlled, and is a known source of return noise.
- DBC is energy-weighted, so the market model against it has low explanatory power
  for grains and HF2's abnormal return is close to a raw return. This was stated in
  the registration rather than discovered afterwards.
- One corn event dropped for insufficient estimation observations (n = 9 against 10).

## Status

Registered, run once, reported. **No v2 is registered**: there is no new mechanism
hypothesis here, only an untested suspicion about announcement timing. Per the
protocol, moving further would need the announcement-date series first — that is the
evidence that would justify another round, and until it exists this direction is
closed.

Artifacts: `event_study_fut_v1_summary.{json,md}`, `event_study_fut_v1_events.csv`,
and the control arm under `event_study_fut_v1_control_*`.

## Addendum 2026-10-10 — an attribution bug in the artifacts, not in the result

Exporting this study to the research page surfaced a defect in the runner.

`run.py` built its hypothesis lookup as `{h["basket"]: h for h in hypotheses}`,
so when two hypotheses name the same basket the later one wins. HF1 (primary,
expected negative) and HF3 (control, non-directional) both name
`SPREAD_SOY_CORN`, so the summary recorded that basket as HF3 with
`expected_sign: "null"`.

That had no effect on the number, because `cross_section` tested any sign
other than `"positive"` as negative — which is the direction HF1 asks for. The
published p-values were valid; the label on them was wrong.

Both halves are now fixed, and the fix is verified by the result not moving:
re-running with the corrected resolution reproduces 0.0014 / 0.613 / 0.623 /
0.630 for the primary basket and every other figure to the digit. The summary
now reads `("negative", "HF1")`.

The silent fall-through is closed too: `cross_section` raises on a sign that is
not `"positive"` or `"negative"`, and `run.py` prints which direction it uses
when a registration gives a non-directional one, as the control arm does.
