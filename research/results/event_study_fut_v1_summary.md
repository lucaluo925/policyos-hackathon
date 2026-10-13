# Event study fut_v1 — primary window [0,1]

Events used: 10 (merged away: none). Bonferroni α per primary hypothesis = 0.025.

| Basket | H | exp. sign | n | mean CAR | median | t | p(t) | sign hits | p(sign) | p(placebo) |
|---|---|---|---|---|---|---|---|---|---|---|
| SPREAD_SOY_CORN | HF1 | negative | 10 | 0.14% | -0.07% | 0.30 | 0.613 | 5/10 | 0.623 | 0.630 |
| AG_SOYBEANS | HF2 | negative | 10 | -0.31% | -0.60% | -0.76 | 0.232 | 6/10 | 0.377 | 0.185 |
| AG_CORN | robust | positive | 9 | -1.06% | -1.05% | -1.56 | 0.921 | 3/9 | 0.910 | 0.977 |

Other windows are in the JSON; they are secondary and not used for the primary decision.
