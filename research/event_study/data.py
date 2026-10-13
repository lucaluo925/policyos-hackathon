"""Daily close loaders with a local CSV cache (research/data/, git-ignored).

CN: akshare (Eastmoney). Stocks use back-adjusted (hfq) closes so returns
include dividends/splits; indices are unadjusted price indices.
US: yfinance with auto_adjust=True (split/dividend adjusted).

Run on your own machine; nothing here is uploaded anywhere.
"""
from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

CN_INDEXES = {"000300", "980017", "000001", "399001"}


def _cache(cache_dir: Path, market: str, ticker: str) -> Path:
    # Futures tickers look like "ZS=F"; '=' is legal in a filename but trips
    # shell globbing, so it is mapped out of the cache path.
    return cache_dir / f"{market}_{ticker.replace('=', '-')}.csv"


def _fetch_cn(ticker: str, start: str, end: str) -> pd.Series:
    import akshare as ak  # lazy: only needed when the cache is cold

    s, e = start.replace("-", ""), end.replace("-", "")
    if ticker in CN_INDEXES:
        df = ak.index_zh_a_hist(symbol=ticker, period="daily", start_date=s, end_date=e)
    else:
        df = ak.stock_zh_a_hist(symbol=ticker, period="daily", start_date=s, end_date=e, adjust="hfq")
    if df is None or df.empty:
        raise RuntimeError(f"akshare returned no rows for {ticker}")
    return pd.Series(df["收盘"].astype(float).to_numpy(), index=pd.to_datetime(df["日期"]), name=ticker)


def _fetch_cn_sina(ticker: str, start: str, end: str) -> pd.Series:
    """Fallback when Eastmoney refuses connections: Sina daily bars via akshare.
    Back-adjusted (hfq) too, so daily returns match the Eastmoney series up to rounding."""
    import akshare as ak

    if ticker in CN_INDEXES:
        raise RuntimeError("Sina fallback is only wired for stocks")
    prefix = "sh" if ticker.startswith(("6", "9")) else "sz"
    df = ak.stock_zh_a_daily(symbol=prefix + ticker, start_date=start.replace("-", ""),
                             end_date=end.replace("-", ""), adjust="hfq")
    if df is None or df.empty:
        raise RuntimeError(f"Sina returned no rows for {ticker}")
    return pd.Series(df["close"].astype(float).to_numpy(), index=pd.to_datetime(df["date"]), name=ticker)


def parse_yahoo_chart(payload: dict, ticker: str) -> pd.Series:
    """Daily closes out of a Yahoo chart response.

    Split out as a pure function so the fallback below is testable without a
    network call. Yahoo pads the arrays with nulls for sessions it has no
    close for; those rows are dropped rather than forward-filled, because an
    invented close would become an invented return.
    """
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        raise RuntimeError(f"Yahoo returned no result for {ticker}")
    block = result[0]
    stamps = block.get("timestamp") or []
    quote = ((block.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    if not stamps or not closes:
        raise RuntimeError(f"Yahoo returned no closes for {ticker}")
    series = pd.Series(closes, index=pd.to_datetime(stamps, unit="s", utc=True), name=ticker)
    series = series.dropna().astype(float)
    if series.empty:
        raise RuntimeError(f"Yahoo returned only nulls for {ticker}")
    # Normalise to naive dates so the index matches the yfinance path.
    series.index = series.index.tz_convert(None).normalize()
    return series[~series.index.duplicated(keep="last")]


def _fetch_us_chart_api(ticker: str, start: str, end: str) -> pd.Series:
    """Fallback when yfinance is not installed: Yahoo's chart endpoint over
    plain HTTP. Same source as yfinance, one dependency fewer, which is what
    lets this study run in an environment that only has pandas."""
    import requests

    r = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
        params={
            "period1": int(pd.Timestamp(start).timestamp()),
            "period2": int(pd.Timestamp(end).timestamp()),
            "interval": "1d",
            "events": "div,split",
        },
        headers={"User-Agent": "Mozilla/5.0 (research event study)"},
        timeout=30,
    )
    r.raise_for_status()
    return parse_yahoo_chart(r.json(), ticker)


def _fetch_us(ticker: str, start: str, end: str) -> pd.Series:
    try:
        import yfinance as yf
    except ImportError:
        print(f"[data] US {ticker}: yfinance not installed, using the Yahoo chart endpoint")
        return _fetch_us_chart_api(ticker, start, end)

    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise RuntimeError(f"yfinance returned no rows for {ticker}")
    close = df["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close.index = pd.to_datetime(close.index).tz_localize(None)
    return close.rename(ticker).astype(float)


def _fetch_with_retry(market: str, ticker: str, start: str, end: str, attempts: int = 3) -> pd.Series:
    """Eastmoney drops connections under rapid sequential requests; back off and retry.
    Already-downloaded tickers are cached, so a failed run can simply be re-run."""
    fetch = _fetch_cn if market == "CN" else _fetch_us
    for i in range(1, attempts + 1):
        try:
            s = fetch(ticker, start, end)
            time.sleep(1.0)  # be polite between tickers
            return s
        except Exception as e:  # network errors surface as several exception types
            if i == attempts:
                if market == "CN":
                    print(f"[data] CN {ticker}: Eastmoney failed {attempts}x, falling back to Sina")
                    return _fetch_cn_sina(ticker, start, end)
                raise
            wait = 3 * 2 ** (i - 1)
            print(f"[data] {market} {ticker}: {type(e).__name__}, retry {i}/{attempts - 1} in {wait}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def load_closes(market: str, tickers: list[str], start: str, end: str, cache_dir: Path, refresh=False) -> pd.DataFrame:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cols = {}
    for t in tickers:
        p = _cache(cache_dir, market, t)
        if p.exists() and not refresh:
            s = pd.read_csv(p, index_col=0, parse_dates=True).iloc[:, 0].rename(t)
        else:
            s = _fetch_with_retry(market, t, start, end)
            s.to_frame().to_csv(p)
            print(f"[data] {market} {t}: {len(s)} rows {s.index.min().date()}..{s.index.max().date()}")
        cols[t] = s
    return pd.DataFrame(cols).sort_index()


def to_returns(closes: pd.DataFrame, calendar_col: str) -> pd.DataFrame:
    """Simple returns on the benchmark's session calendar.

    A stock with no row on a benchmark session (suspension / not yet listed)
    gets NaN — never a forward-filled zero return.
    """
    cal = closes[calendar_col].dropna().index
    c = closes.reindex(cal)
    r = c / c.shift(1) - 1
    # A return is only valid if the stock also traded on the previous session.
    r[c.shift(1).isna() | c.isna()] = float("nan")
    return r.iloc[1:]
