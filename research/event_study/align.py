"""Event-day alignment: map a UTC instant to the first session that could react.

Rule (pre-registered in research/hypotheses_v1.json):
    event day = first trading session whose *close* is strictly after the
    event instant, in that market's local time.

Sessions come from the market's own price data (the benchmark's dates), so
exchange holidays (e.g. China's Golden Week) are handled without a calendar
library.
"""
from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

import pandas as pd

MARKETS = {
    "US": {"tz": ZoneInfo("America/New_York"), "close": time(16, 0)},
    "CN": {"tz": ZoneInfo("Asia/Shanghai"), "close": time(15, 0)},
}


def parse_instant(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def session_close_utc(day: pd.Timestamp, market: str) -> datetime:
    m = MARKETS[market]
    local = datetime.combine(day.date(), m["close"], tzinfo=m["tz"])
    return local.astimezone(ZoneInfo("UTC"))


def event_day_index(instant: datetime, sessions: pd.DatetimeIndex, market: str) -> int | None:
    """Position in `sessions` of the event day, or None if after the last session."""
    # Candidate: first session whose date >= instant's local date; step forward
    # until its close is after the instant.
    local_date = instant.astimezone(MARKETS[market]["tz"]).date()
    i = int(sessions.searchsorted(pd.Timestamp(local_date)))
    while i < len(sessions):
        if session_close_utc(sessions[i], market) > instant:
            return i
        i += 1
    return None
