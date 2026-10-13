# Event study fut_v1_control — primary window [0,1]

Events used: 16 (merged away: ['C12', 'C13', 'C14', 'C15', 'C16', 'C18', 'C22', 'C23', 'C24']). Bonferroni α per primary hypothesis = 0.050.

| Basket | H | exp. sign | n | mean CAR | median | t | p(t) | sign hits | p(sign) | p(placebo) |
|---|---|---|---|---|---|---|---|---|---|---|
| SPREAD_SOY_CORN | HF1 | negative | 16 | 0.26% | 0.35% | 0.69 | 0.750 | 7/16 | 0.773 | 0.789 |
| AG_SOYBEANS | robust | positive | 16 | 0.27% | -0.13% | 0.56 | 0.293 | 8/16 | 0.598 | 0.254 |
| AG_CORN | robust | positive | 16 | 0.03% | -0.49% | 0.05 | 0.482 | 6/16 | 0.895 | 0.366 |

Other windows are in the JSON; they are secondary and not used for the primary decision.
