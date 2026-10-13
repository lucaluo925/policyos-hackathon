# Event study v1 — conclusion

**Question.** Do US semiconductor export-control actions against China move US equipment
stocks down (H1) and Chinese domestic-substitution equipment stocks up (H2)?

**Design (pre-registered 2026-09-21, before price data).** 16 tightening event clusters
(Federal Register BIS, 2018-10 → 2025-09, frozen in `events/frozen_events_v1.csv`);
event instant = public-inspection filing (one manual override, E02); event day = first
session closing after the instant, per market. Equal-weight baskets, market model
(estimation [-250,-30]), primary window [0,1], one-sided cross-event t, sign test,
1,000-draw random-date placebo, Bonferroni α = 0.025 per primary hypothesis.

## Result: no support for either primary hypothesis

| Basket | H | Expected | Mean CAR[0,1] | Median | p(t) | p(placebo) |
|---|---|---|---|---|---|---|
| AMAT/LRCX/KLAC vs SPY | H1 | − | −0.34% | +0.27% | 0.32 | 0.29 |
| 6 CN equipment names vs CSI 300 | H2 | + | −0.82% | −0.37% | 0.66 | 0.76 |
| SOXX vs SPY | H3 (secondary) | − | −0.66% | −0.39% | 0.07 | 0.06 |
| CNI Semiconductor index 980017 vs CSI 300 | robustness | + | −0.27% | −0.57% | 0.68 | 0.63 |

H3 is directionally consistent (11/16 negative) but does not clear α = 0.05 and is
secondary; it is reported, not promoted. Other windows ([-1,1], [0,5]) do not change the
picture.

**Power.** With a basket CAR s.d. of ~2.9% (US equipment) and n = 16, the standard error
of the mean is ~0.7%; effects smaller than ~1.5% would likely go undetected. A null here
means "no large average effect", not "no effect".

## Exploratory observation (post hoc — not a finding)

The CN basket's dispersion is dominated by a few events of opposite sign:

- **E09, Oct-2022 advanced-computing rule** (tool/chip-wide, plus the US-person restriction):
  CN equipment CAR[0,1] **−23.9%** (t = −6.3). Raw data confirm near-limit-down moves on
  2022-10-10 (first session after Golden Week) across STAR-market names; CSI 300 −2.2%.
- **E05, May-2020 Huawei FDPR** (single named customer): CN equipment +10.0% over [0,1],
  most of it on day +1 (688012 +17.7% on 2020-05-19).
- **E11, Mar-2023 Inspur** +10.7%, coinciding with a broad A-share AI/semis rally — likely
  confounded.

Split by rule scope (in-sample, descriptive): technology-wide rules (n = 3) mean −8.6%,
median −2.9%; entity-level additions (n = 13) mean +1.0%, median −0.4%. The v1
"substitution" hypothesis likely pooled two mechanisms. This motivates
`hypotheses_v2_exploratory.json`, which is to be tested **only on events after
2026-09-22**.

## Limitations
- Small sample (16); a handful of events drive dispersion.
- CN basket chosen in 2026 (survivors); mitigated by point-in-time eligibility
  (names need ≥120 pre-event sessions) and the index robustness check, not eliminated.
- Event time can precede public inspection when BIS issues a press release first
  (handled manually once, E02); [-1,1] results are shown for this reason.
- Market model only; no sector or factor adjustment; overlapping news not controlled.
- Not a trading signal.

## Appendix — reaction by period (exploratory, added 2026-09-22)

Descriptive split of CAR[0,1] at 2022-01-01 (8 events each side). Not a test; it does not
revise the v1 conclusion.

| Basket | 2018–2021 mean / median | 2022–2025 mean / median |
|---|---|---|
| US equipment (AMAT/LRCX/KLAC) | −1.23% / −0.50% (5/8 negative) | +0.55% / +0.98% (2/8 negative) |
| SOXX | −0.61% / −0.28% | −0.70% / −0.86% |
| CN equipment | +0.51% / −0.42% | −2.15% / +0.28% |
| CNI Semiconductor index | −0.22% / −0.78% | −0.32% / −0.33% |

If anything, US equipment names reacted *less* negatively after 2022, when controls were
larger — consistent with markets pricing the policy path ahead of individual rules, but
with n = 8 per side this is a hypothesis, not a finding.
