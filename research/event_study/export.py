"""Export v1 results for the web app and compute the v2 in-sample split.

    python3 -m research.event_study.export

Writes src/lib/research/event-study-v1.json (static; the page needs no DB)
and prints the descriptive in-sample split by rule scope used to motivate
hypotheses_v2_exploratory.json. Read-only on all frozen inputs.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "research"


def rule_scope(doc_ids: str, fr: pd.DataFrame) -> str:
    """supply_chain = cluster contains a technology/country-wide control rule
    (tagger eventType advanced_computing_semis); otherwise entity-level."""
    types = set(fr.loc[fr.externalId.isin(doc_ids.split("|")), "eventType"])
    return "supply_chain" if "advanced_computing_semis" in types else "entity"


def extra_study(clean, *, hypotheses: str, events_csv: str, results_prefix: str,
                arm: str | None = None) -> dict:
    """A registered study beyond v1, exported in the shape the page reads.

    Parameterised rather than copied: this is the third study to need it, and
    the China version was already an exact template for the futures one.

    `arm` selects one direction out of a two-arm event file — the futures
    study ships its treatment and control events in a single frozen CSV.
    Returns the registration alone until the results files exist.
    """
    Hc = json.loads((RES / hypotheses).read_text())
    evc = pd.read_csv(RES / "events" / events_csv)
    if arm is not None:
        evc = evc[evc.direction == arm].reset_index(drop=True)
    out = {
        "registeredAt": Hc["registered_at"],
        "question": Hc["question"],
        "baskets": {k: {"benchmark": v["benchmark"], "tickers": v["tickers"], "names": v.get("names")}
                    for k, v in Hc["baskets"].items()},
        "hypotheses": Hc["hypotheses"],
        "robustnessExclude": Hc.get("robustness_exclude_events", []),
        "events": [{"id": r.event_id, "cluster": r.cluster, "instant": r.event_instant,
                    "docs": r.doc_ids, "url": r.urls.split("|")[0]} for r in evc.itertuples()],
        "summary": None,
        "perEvent": None,
    }
    sp = RES / "results" / f"{results_prefix}_summary.json"
    ep = RES / "results" / f"{results_prefix}_events.csv"
    if sp.exists() and ep.exists():
        sm = json.loads(sp.read_text())
        out["summary"] = {
            k: {"expectedSign": v["expected_sign"], "hypothesis": v.get("primary_hypothesis"),
                "windows": {w: {kk: clean(vv) for kk, vv in d.items()} for w, d in v["windows"].items()},
                "placebo": {kk: clean(vv) for kk, vv in (v.get("placebo_primary") or {}).items()},
                "excluding": {kk: clean(vv) for kk, vv in (v.get("primary_excluding") or {}).items()} or None}
            for k, v in sm["baskets"].items()
        }
        pe = pd.read_csv(ep)
        out["perEvent"] = [
            {"id": r["event_id"], "basket": r["basket"], "day": r["event_day"],
             "car01": clean(float(r["CAR[0,1]"])) if pd.notna(r.get("CAR[0,1]")) else None}
            for r in pe.to_dict("records")
        ]
    return out


def cn_study(clean) -> dict:
    """China's critical-mineral export controls (hypotheses_cn_v1)."""
    return extra_study(clean, hypotheses="hypotheses_cn_v1.json",
                       events_csv="cn_countermeasures_v1.csv",
                       results_prefix="event_study_cn_v1")


def fut_study(clean) -> dict:
    """Section 301 tariff actions against agricultural futures (hypotheses_fut_v1).
    The frozen file carries both arms; the page shows the treatment arm."""
    return extra_study(clean, hypotheses="hypotheses_fut_v1.json",
                       events_csv="frozen_events_fut_v1.csv",
                       results_prefix="event_study_fut_v1", arm="tightening")


def main() -> None:
    fr = pd.read_csv(RES / "events" / "fr_events.csv")
    ev = pd.read_csv(RES / "events" / "frozen_events_v1.csv")
    ev["rule_scope"] = [rule_scope(d, fr) for d in ev.doc_ids]
    per = pd.read_csv(RES / "results" / "event_study_v1_events.csv")
    summ = json.loads((RES / "results" / "event_study_v1_summary.json").read_text())
    H = json.loads((RES / "hypotheses_v1.json").read_text())

    per = per.merge(ev[["event_id", "rule_scope", "urls", "titles", "event_instant"]], on="event_id", how="left")

    split = []
    for (b, s), g in per[per.ok].groupby(["basket", "rule_scope"]):
        c = g["CAR[0,1]"].to_numpy()
        split.append({"basket": b, "rule_scope": s, "n": int(len(c)), "mean_car": float(c.mean()),
                      "median_car": float(np.median(c)), "n_negative": int((c < 0).sum())})
    split_df = pd.DataFrame(split)
    print(split_df.round(4).to_string(index=False))

    # Exploratory, descriptive: does the reaction differ before vs after 2022?
    per["period"] = np.where(per.event_instant < "2022-01-01", "2018-2021", "2022-2025")
    period_split = []
    for (b, prd), g in per[per.ok].groupby(["basket", "period"]):
        c = g["CAR[0,1]"].to_numpy()
        period_split.append({"basket": b, "period": prd, "n": int(len(c)), "mean_car": float(c.mean()),
                             "median_car": float(np.median(c)), "n_negative": int((c < 0).sum())})
    print(pd.DataFrame(period_split).round(4).to_string(index=False))

    def clean(v):
        if isinstance(v, float) and not np.isfinite(v):
            return None
        return v

    events = []
    for e in ev[ev.direction == "tightening"].itertuples():
        rows = per[per.event_id == e.event_id]
        events.append({
            "id": e.event_id, "cluster": e.cluster, "instant": e.event_instant, "scope": e.rule_scope,
            "title": e.titles.split(" || ")[0], "nDocs": int(e.n_docs), "url": e.urls.split("|")[0],
        })
        events[-1]["baskets"] = {
            row["basket"]: {
                "day": row["event_day"],
                "n": clean(float(row["n_names"])) if pd.notna(row.get("n_names")) else None,
                "carM1P1": clean(float(row["CAR[-1,1]"])) if pd.notna(row.get("CAR[-1,1]")) else None,
                "car01": clean(float(row["CAR[0,1]"])) if pd.notna(row.get("CAR[0,1]")) else None,
                "car05": clean(float(row["CAR[0,5]"])) if pd.notna(row.get("CAR[0,5]")) else None,
                "t01": clean(float(row["t[0,1]"])) if pd.notna(row.get("t[0,1]")) else None,
            }
            for row in rows.to_dict("records")
        }

    out = {
        "version": "v1",
        "hypothesesVersion": H["version"],
        "registeredAt": H["registered_at"],
        "primaryWindow": H["method"]["primary_window"],
        "estimationWindow": H["method"]["estimation_window"],
        "baskets": {k: {"benchmark": v["benchmark"], "tickers": v["tickers"]} for k, v in H["baskets"].items()},
        "hypotheses": H["hypotheses"],
        "summary": {
            k: {"expectedSign": v["expected_sign"], "hypothesis": v.get("primary_hypothesis"),
                "windows": {w: {kk: clean(vv) for kk, vv in d.items()} for w, d in v["windows"].items()},
                "placebo": {kk: clean(vv) for kk, vv in (v.get("placebo_primary") or {}).items()}}
            for k, v in summ["baskets"].items()
        },
        "events": events,
        "inSampleSplit": [{k: clean(v) for k, v in r.items()} for r in split],
        "periodSplit": [{k: clean(v) for k, v in r.items()} for r in period_split],
        "cn": cn_study(clean),
        "fut": fut_study(clean),
    }
    dst = ROOT / "src" / "lib" / "research" / "event-study-v1.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"[export] wrote {dst.relative_to(ROOT)} ({len(events)} events)")


if __name__ == "__main__":
    main()
