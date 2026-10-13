# Event study cn_v1 — China's critical-mineral export controls: conclusion

**Question.** Do China's item-based export controls on critical minerals move Chinese
strategic-materials producers up (H6) and the main non-China US rare-earth producer, MP
Materials, up (H7)?

**Design (pre-registered 2026-09-22, before any price data for these baskets).** 8 MOFCOM/MOST
announcements, 2023-07 → 2025-10, event instants from the official pages' timestamps
(`events/cn_countermeasures_v1.csv`, hashes in `events/FROZEN_cn_v1.json`). Same method as v1:
market model, estimation [-250,-30], primary window [0,1], one-sided cross-event t, sign test,
1,000-draw random-date placebo, Bonferroni α = 0.025 per primary hypothesis.

## Result

| Basket | H | Expected | Mean CAR[0,1] | Median | p(t) | Sign hits (p) | p(placebo) |
|---|---|---|---|---|---|---|---|
| MP Materials vs SPY | H7 | + | **+4.82%** | +5.22% | **0.014** | 6/8 (0.145) | **0.017** |
| 6 CN producers vs CSI 300 | H6 | + | **+3.23%** | +2.73% | 0.029 | 6/8 (0.145) | **0.005** |
| REMX vs SPY | H8 (secondary) | + | −0.38% | +0.18% | 0.64 | 4/8 (0.64) | 0.65 |

- **H7 is supported** at the pre-registered level by both the t-test and the placebo.
- **H6 is borderline**: the placebo clears α = 0.025, the t-test (0.029) narrowly does not.
- The sign test does not clear α for either (6 of 8 positive, p = 0.145) — with n = 8 it can
  only reach significance at 8/8 or 7/8.
- REMX shows nothing; it holds Chinese producers alongside non-China names, so its exposure to
  the events nets out. It was secondary for that reason.

**Not driven by one event.** Dropping any single event keeps both means positive (CN producers
+2.2% to +4.0%; MP +3.8% to +5.9%). The largest single CN reaction is the first announcement,
gallium/germanium in Jul-2023 (+10.8%, t = 4.9); without it the CN mean is +2.2%.

## The main caveat: confounding with broader escalation

The pre-registered robustness check drops the four events that coincide with other US–China
escalations (C05 Dec-2024, C06 Feb-2025, C07 Apr-2025, C08 Oct-2025). On the remaining four,
means stay positive (CN +2.6%, MP +3.6%) but are no longer significant (p = 0.22 and 0.15;
n = 4 has almost no power). So the data cannot separate "the export control moved these stocks"
from "US–China escalation in general moves these stocks" — which, for an investor, may be the
same signal.

## Other limitations
- n = 8; one US stock for H7 (single-name risk; MP's volatility rose over the sample).
- CN basket chosen in 2026; three of six names were downloaded from Sina after Eastmoney
  refused connections (both back-adjusted; daily returns agree up to rounding).
- Web timestamps are when MOFCOM posted the notice; earlier leaks are not captured
  ([-1,1] results, similar in size, are in the JSON).
- China named MP Materials on its own export-control list in June 2026 — outside this event
  set, and a reminder that "beneficiary" status can reverse.
- A policy-risk study, not a trading signal.
