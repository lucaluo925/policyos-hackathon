# PolicyOS research layer — policy events × equity markets

PolicyOS (TypeScript) produces dated, evidence-tagged policy events; this
folder (Python) measures how US and A-share semiconductor baskets react.

## Pipeline
1. `npm run events:backfill -- --from 2018-01-01` → `events/fr_events.csv`
   (Federal Register BIS + USTR, tagged by `fr-tagger-v2`, event time = public-inspection filing).
2. Human review → `events/review_v2.csv` → frozen set `events/frozen_events_v1.csv`
   (see `events/FROZEN_v1.json` for hashes and the one manual time override).
3. Pre-registered design: `hypotheses_v1.json` (written before any price data was pulled).
4. `python -m research.event_study.run` → `results/` (market-model CAR, cross-event t,
   sign test, 1,000-draw random-date placebo, Bonferroni across H1/H2).

## Second study: China's critical-mineral export controls (cn_v1)
8 MOFCOM item-based export-control announcements (2023-07 → 2025-10), timestamps from the official
pages, frozen in `events/cn_countermeasures_v1.csv` with hypotheses in `hypotheses_cn_v1.json`
(H6: CN strategic-materials producers ↑; H7: MP Materials ↑), registered before any price data
for these baskets was pulled. **Result:** H7 supported (MP +4.8% CAR[0,1], p = 0.014, placebo 0.017);
H6 borderline (+3.2%, placebo 0.005, t 0.029); not separable from broader escalation — see
`results/event_study_cn_v1_conclusion.md`.

    python3 -m research.event_study.run --hypotheses research/hypotheses_cn_v1.json \
        --events research/events/cn_countermeasures_v1.csv --tag cn_v1
    python3 -m research.event_study.export   # refresh the /research page data

## Ongoing collection (v2 out-of-sample)
Vercel cron hits `/api/events/ingest` daily (13:00 UTC): last 14 days of BIS/USTR documents,
same frozen tagger, upserted into `policy_events` with `reviewStatus=pending`. Review new relevant
rows with the same rules as v1 before they enter any study. Set `CRON_SECRET` in Vercel to protect
the route.

## Rules
- Do not edit the frozen events, the tagger, or `hypotheses_v1.json` after prices are pulled;
  changes go into a v2 with a note on why.
- Event day = first session whose close is after the event instant (per market);
  China holidays and after-hours US releases are handled by the price calendar.
- Results are a policy-risk study with ~16 events, not a tradable signal.

## Tests
`python3 -m unittest research.event_study.tests.test_event_study`  ·  `npm test` (TS event layer)
