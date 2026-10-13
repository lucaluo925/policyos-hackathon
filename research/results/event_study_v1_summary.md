# Event study v1 — primary window [0,1]

Events used: 16 (merged away: none). Bonferroni α per primary hypothesis = 0.025.

| Basket | H | exp. sign | n | mean CAR | median | t | p(t) | sign hits | p(sign) | p(placebo) |
|---|---|---|---|---|---|---|---|---|---|---|
| US_SEMI_EQUIP | H1 | negative | 16 | -0.34% | 0.27% | -0.47 | 0.321 | 7/16 | 0.773 | 0.294 |
| US_SEMI_BROAD | H3 | negative | 16 | -0.66% | -0.39% | -1.53 | 0.073 | 11/16 | 0.105 | 0.061 |
| CN_SEMI_EQUIP_SUBSTITUTE | H2 | positive | 16 | -0.82% | -0.37% | -0.43 | 0.663 | 7/16 | 0.773 | 0.758 |
| CN_SEMI_INDEX_ROBUST | robust | positive | 16 | -0.27% | -0.57% | -0.49 | 0.683 | 7/16 | 0.773 | 0.628 |

Other windows are in the JSON; they are secondary and not used for the primary decision.
