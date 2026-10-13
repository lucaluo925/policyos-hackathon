"""Market-model event study on an equal-weight basket.

Why a basket (portfolio approach): all names in a basket react to the same
event on the same day, so their abnormal returns are cross-correlated.
Averaging into one portfolio return per day and testing across *events*
avoids overstating significance by treating correlated names as independent.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .stats import sign_test_one_sided, t_sf


@dataclass
class EventCar:
    ev_idx: int
    n_names: int
    names: list[str]
    alpha: float
    beta: float
    sigma: float
    car: dict[str, float] = field(default_factory=dict)
    t: dict[str, float] = field(default_factory=dict)


def wkey(w: tuple[int, int]) -> str:
    return f"[{w[0]},{w[1]}]"


def basket_event_car(
    rets: pd.DataFrame,
    bench: str,
    tickers: list[str],
    ev_idx: int,
    est: tuple[int, int] = (-250, -30),
    windows: list[tuple[int, int]] = ((-1, 1), (0, 1), (0, 5)),
    min_obs: int = 120,
) -> EventCar | None:
    lo = min(w[0] for w in windows)
    hi = max(w[1] for w in windows)
    e0, e1 = ev_idx + est[0], ev_idx + est[1]
    if e0 < 0 or ev_idx + hi >= len(rets):
        return None
    est_rows = rets.iloc[e0 : e1 + 1]
    ev_rows = rets.iloc[ev_idx + lo : ev_idx + hi + 1]
    # Point-in-time eligibility: enough history *before* the event and a full
    # event window. Names listed after the event are excluded automatically,
    # which is what limits the survivorship bias of a 2026-chosen basket.
    names = [
        t for t in tickers
        if t in rets and est_rows[t].notna().sum() >= min_obs and ev_rows[t].notna().all()
    ]
    if not names:
        return None
    port = rets[names].mean(axis=1, skipna=True)
    y = port.iloc[e0 : e1 + 1]
    x = rets[bench].iloc[e0 : e1 + 1]
    ok = y.notna() & x.notna()
    if ok.sum() < min_obs:
        return None
    X = np.column_stack([np.ones(ok.sum()), x[ok].to_numpy()])
    coef, *_ = np.linalg.lstsq(X, y[ok].to_numpy(), rcond=None)
    alpha, beta = float(coef[0]), float(coef[1])
    resid = y[ok].to_numpy() - X @ coef
    sigma = float(np.sqrt(resid @ resid / (ok.sum() - 2)))
    ar = port - (alpha + beta * rets[bench])
    out = EventCar(ev_idx, len(names), names, alpha, beta, sigma)
    for w in windows:
        seg = ar.iloc[ev_idx + w[0] : ev_idx + w[1] + 1]
        L = w[1] - w[0] + 1
        c = float(seg.sum())
        out.car[wkey(w)] = c
        out.t[wkey(w)] = c / (sigma * np.sqrt(L)) if sigma > 0 else float("nan")
    return out


def merge_close_events(idx: list[int], min_gap: int) -> tuple[list[int], list[int]]:
    """Keep the earliest of events closer than `min_gap` sessions. Returns (kept, dropped)."""
    kept, dropped = [], []
    for i in sorted(idx):
        if kept and i - kept[-1] < min_gap:
            dropped.append(i)
        else:
            kept.append(i)
    return kept, dropped


def cross_section(cars: list[float], expected_sign: str) -> dict:
    # Anything that is not "positive" used to fall through to the negative
    # branch, so a typo or a placeholder like "null" silently chose the test
    # direction. Say so instead.
    if expected_sign not in ("positive", "negative"):
        raise ValueError(
            f'expected_sign must be "positive" or "negative", got {expected_sign!r}'
        )
    a = np.asarray([c for c in cars if np.isfinite(c)])
    n = len(a)
    if n < 2:
        return {"n": n}
    mean, sd = float(a.mean()), float(a.std(ddof=1))
    t = mean / (sd / np.sqrt(n)) if sd > 0 else float("nan")
    tt = t if expected_sign == "positive" else -t
    n_hit = int((a > 0).sum() if expected_sign == "positive" else (a < 0).sum())
    return {
        "n": n,
        "mean_car": mean,
        "median_car": float(np.median(a)),
        "sd": sd,
        "t": t,
        "p_t_one_sided": t_sf(tt, n - 1),
        "n_expected_sign": n_hit,
        "p_sign_one_sided": sign_test_one_sided(n_hit, n),
    }


def placebo_p(
    rets: pd.DataFrame,
    bench: str,
    tickers: list[str],
    event_idx: list[int],
    actual_mean: float,
    expected_sign: str,
    window: tuple[int, int],
    est=(-250, -30),
    min_obs=120,
    draws: int = 1000,
    exclude: int = 10,
    seed: int = 20260921,
) -> dict:
    """Empirical p: share of random same-size date sets whose mean CAR is at
    least as extreme (in the expected direction) as the actual one."""
    banned = {j for i in event_idx for j in range(i - exclude, i + exclude + 1)}
    cand = [i for i in range(len(rets)) if i not in banned]
    per_day: dict[int, float] = {}
    for i in cand:
        r = basket_event_car(rets, bench, tickers, i, est, [window], min_obs)
        if r is not None:
            per_day[i] = r.car[wkey(window)]
    pool = np.array(list(per_day.values()))
    n = len(event_idx)
    if len(pool) < n * 5:
        return {"placebo_pool": len(pool), "p_placebo": float("nan")}
    rng = np.random.default_rng(seed)
    means = np.array([rng.choice(pool, n, replace=False).mean() for _ in range(draws)])
    hit = (means >= actual_mean) if expected_sign == "positive" else (means <= actual_mean)
    return {
        "placebo_pool": len(pool),
        "placebo_draws": draws,
        "placebo_mean": float(means.mean()),
        "placebo_sd": float(means.std(ddof=1)),
        "p_placebo": float((hit.sum() + 1) / (draws + 1)),
    }
