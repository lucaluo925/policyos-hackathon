"""M2 — policy-event study on US and A-share semiconductor baskets.

    python -m research.event_study.run            # v1 (US export controls), from the policyos/ root
    python -m research.event_study.run --refresh  # re-download prices
    python -m research.event_study.run --hypotheses research/hypotheses_cn_v1.json \
        --events research/events/cn_countermeasures_v1.csv --tag cn_v1

Reads the frozen inputs (never edits them):
    research/hypotheses_v1.json
    research/events/frozen_events_v1.csv
Writes:
    research/results/event_study_v1_events.csv   per event × basket
    research/results/event_study_v1_summary.json  cross-section + placebo
    research/results/event_study_v1_summary.md    human-readable
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from .align import event_day_index, parse_instant
from .car import basket_event_car, cross_section, merge_close_events, placebo_p, wkey
from .data import load_closes, to_returns

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "research"


def market_of(basket_key: str) -> str:
    return "CN" if basket_key.startswith("CN_") else "US"


def robust_key(key: str) -> str:
    # v1 name kept for continuity with already-published results.
    return "CN_SEMI_INDEX_ROBUST" if key == "CN_SEMI_EQUIP_SUBSTITUTE" else f"{key}_INDEX_ROBUST"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--start", default="2017-06-01")
    ap.add_argument("--end", default=pd.Timestamp.today().strftime("%Y-%m-%d"))
    ap.add_argument("--draws", type=int, default=1000)
    ap.add_argument("--hypotheses", default=str(RES / "hypotheses_v1.json"))
    ap.add_argument("--events", default=str(RES / "events" / "frozen_events_v1.csv"))
    ap.add_argument("--tag", default="v1", help="output prefix: results/event_study_<tag>_*")
    args = ap.parse_args()

    H = json.loads(Path(args.hypotheses).read_text())
    ev = pd.read_csv(args.events)
    f = H["event_filter"]
    ev = ev[ev.direction == f["direction"]].reset_index(drop=True)
    m = H["method"]
    est = tuple(m["estimation_window"])
    windows = [tuple(w) for w in m["event_windows"]]
    primary = wkey(tuple(m["primary_window"]))
    cache = RES / "data"

    # Robustness baskets: any basket may name an index to re-run against its benchmark.
    baskets = dict(H["baskets"])
    parent = {}
    for key, b in list(baskets.items()):
        if b.get("robustness_index"):
            rk = robust_key(key)
            baskets[rk] = {"benchmark": b["benchmark"], "tickers": [b["robustness_index"]]}
            parent[rk] = key

    rets_by_market: dict[str, pd.DataFrame] = {}
    for key, b in baskets.items():
        mk = market_of(key)
        closes = load_closes(mk, [b["benchmark"], *b["tickers"]], args.start, args.end, cache, args.refresh)
        prev = rets_by_market.get(mk)
        r = to_returns(closes, b["benchmark"])
        rets_by_market[mk] = r if prev is None else prev.combine_first(r)

    # Event-day alignment per market; merge rule applied on the US calendar.
    us_sessions = rets_by_market["US"].index
    ev["us_idx"] = [event_day_index(parse_instant(s), us_sessions, "US") for s in ev.event_instant]
    kept, dropped = merge_close_events([i for i in ev.us_idx if i is not None], f.get("merge_within_us_trading_days", 5))
    ev["merged_away"] = ev.us_idx.isin(dropped)
    use = ev[~ev.merged_away & ev.us_idx.notna()].copy()
    for mk, r in rets_by_market.items():
        use[f"{mk}_day"] = [
            (r.index[i].date().isoformat() if (i := event_day_index(parse_instant(s), r.index, mk)) is not None else None)
            for s in use.event_instant
        ]
        use[f"{mk}_idx"] = [event_day_index(parse_instant(s), r.index, mk) for s in use.event_instant]

    # Several hypotheses may name the same basket: fut_v1 registers a primary
    # (HF1) and a no-op control (HF3) against SPREAD_SOY_CORN. A plain dict
    # comprehension let the later one win, so the summary attributed the
    # basket to the control and recorded its non-directional sign.
    hyp: dict = {}
    for h in H["hypotheses"]:
        prev = hyp.get(h["basket"])
        if prev is None or (h.get("primary") and not prev.get("primary")):
            hyp[h["basket"]] = h
    rows, summary = [], {"hypotheses_version": H["version"], "n_events_input": len(ev),
                         "merged_away": ev.loc[ev.merged_away, "event_id"].tolist(), "baskets": {}}
    for key, b in baskets.items():
        mk = market_of(key)
        r = rets_by_market[mk]
        # Several hypotheses may name the same basket — fut_v1 registers a
        # primary (HF1) and a control (HF3) against SPREAD_SOY_CORN. Building
        # `hyp` by basket let the later one win, so the summary attributed the
        # basket to the control. Prefer the primary; the direction tested is
        # unchanged, only the label was wrong.
        h = hyp.get(key) or hyp.get(parent.get(key, "")) or {}
        sign = h.get("expected_sign", "positive")
        if sign not in ("positive", "negative"):
            # A control arm registers no direction. The test still has to run
            # one way; say which, rather than letting it fall through.
            print(f"[run] {key}: expected_sign={sign!r} is not directional, testing as negative")
            sign = "negative"
        cars, idxs = {wkey(w): [] for w in windows}, []
        for e in use.itertuples():
            i = getattr(e, f"{mk}_idx")
            res = None if pd.isna(i) else basket_event_car(r, b["benchmark"], b["tickers"], int(i), est, windows, m["min_estimation_obs"])
            row = {"event_id": e.event_id, "cluster": e.cluster, "basket": key, "market": mk,
                   "event_day": getattr(e, f"{mk}_day"), "ok": res is not None}
            if res:
                idxs.append(int(i))
                row.update(n_names=res.n_names, names="|".join(res.names), beta=res.beta, sigma=res.sigma)
                for w in windows:
                    row[f"CAR{wkey(w)}"] = res.car[wkey(w)]
                    row[f"t{wkey(w)}"] = res.t[wkey(w)]
                    cars[wkey(w)].append(res.car[wkey(w)])
            rows.append(row)
        bs = {"expected_sign": sign, "primary_hypothesis": hyp.get(key, {}).get("id"), "windows": {}}
        for w in windows:
            bs["windows"][wkey(w)] = cross_section(cars[wkey(w)], sign)
        cs = bs["windows"][primary]
        if cs.get("n", 0) >= 2:
            bs["placebo_primary"] = placebo_p(r, b["benchmark"], b["tickers"], idxs, cs["mean_car"], sign,
                                              tuple(m["primary_window"]), est, m["min_estimation_obs"], args.draws)
        excl = set(H.get("robustness_exclude_events", []))
        if excl:
            kept_cars = [row[f"CAR{primary}"] for row in rows
                         if row["basket"] == key and row["ok"] and row["event_id"] not in excl]
            bs["primary_excluding"] = {"excluded": sorted(excl), **cross_section(kept_cars, sign)}
        summary["baskets"][key] = bs
        print(f"[{key}] n={cs.get('n')} mean{primary}={cs.get('mean_car', float('nan')):.4f} "
              f"p_t={cs.get('p_t_one_sided', float('nan')):.3f} p_sign={cs.get('p_sign_one_sided', float('nan')):.3f} "
              f"p_placebo={bs.get('placebo_primary', {}).get('p_placebo', float('nan')):.3f}")

    out = RES / "results"
    out.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(out / f"event_study_{args.tag}_events.csv", index=False)
    (out / f"event_study_{args.tag}_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    alpha = H["inference"]["alpha"] / sum(1 for h in H["hypotheses"] if h["primary"])
    lines = [f"# Event study {args.tag} — primary window {primary}", "",
             f"Events used: {len(use)} (merged away: {summary['merged_away'] or 'none'}). "
             f"Bonferroni α per primary hypothesis = {alpha:.3f}.", "",
             "| Basket | H | exp. sign | n | mean CAR | median | t | p(t) | sign hits | p(sign) | p(placebo) |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for key, bs in summary["baskets"].items():
        c = bs["windows"][primary]
        if c.get("n", 0) < 2:
            lines.append(f"| {key} | {bs['primary_hypothesis'] or '-'} | {bs['expected_sign']} | {c.get('n', 0)} | – | – | – | – | – | – | – |")
            continue
        lines.append(f"| {key} | {bs['primary_hypothesis'] or 'robust'} | {bs['expected_sign']} | {c['n']} | "
                     f"{c['mean_car']:.2%} | {c['median_car']:.2%} | {c['t']:.2f} | {c['p_t_one_sided']:.3f} | "
                     f"{c['n_expected_sign']}/{c['n']} | {c['p_sign_one_sided']:.3f} | "
                     f"{bs.get('placebo_primary', {}).get('p_placebo', float('nan')):.3f} |")
    lines += ["", "Other windows are in the JSON; they are secondary and not used for the primary decision."]
    (out / f"event_study_{args.tag}_summary.md").write_text("\n".join(lines) + "\n")
    print(f"[done] wrote {out}")


if __name__ == "__main__":
    main()
