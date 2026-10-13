import unittest

import numpy as np
import pandas as pd

from research.event_study.align import event_day_index, parse_instant
from research.event_study.car import basket_event_car, cross_section, merge_close_events, placebo_p
from research.event_study.data import parse_yahoo_chart, to_returns
from research.event_study.stats import sign_test_one_sided, t_sf


def bdays(start, end, drop=()):
    d = pd.bdate_range(start, end)
    return d[~d.isin(pd.to_datetime(list(drop)))]


class TestAlign(unittest.TestCase):
    def test_golden_week_2022(self):
        # E09: PI 2022-10-07 12:45Z. US reacts Fri Oct 7; China closed Oct 3–7 → Mon Oct 10.
        us = bdays("2022-09-26", "2022-10-14")
        cn = bdays("2022-09-26", "2022-10-14", drop=pd.bdate_range("2022-10-03", "2022-10-07"))
        t = parse_instant("2022-10-07T12:45:00.000Z")
        self.assertEqual(us[event_day_index(t, us, "US")].date().isoformat(), "2022-10-07")
        self.assertEqual(cn[event_day_index(t, cn, "CN")].date().isoformat(), "2022-10-10")

    def test_after_us_close_rolls_to_next_session(self):
        us = bdays("2025-09-08", "2025-09-19")
        t = parse_instant("2025-09-12T20:15:00.000Z")  # Fri 16:15 EDT
        self.assertEqual(us[event_day_index(t, us, "US")].date().isoformat(), "2025-09-15")

    def test_huawei_manual_time(self):
        # E02: 2019-05-15 21:30Z = 17:30 EDT (after US close) = 05:30 Beijing May 16.
        s = bdays("2019-05-13", "2019-05-24")
        t = parse_instant("2019-05-15T21:30:00.000Z")
        self.assertEqual(s[event_day_index(t, s, "US")].date().isoformat(), "2019-05-16")
        self.assertEqual(s[event_day_index(t, s, "CN")].date().isoformat(), "2019-05-16")

    def test_cn_intraday_before_close_is_same_day(self):
        s = bdays("2024-12-02", "2024-12-06")
        t = parse_instant("2024-12-02T06:00:00Z")  # 14:00 Beijing, before 15:00 close
        self.assertEqual(s[event_day_index(t, s, "CN")].date().isoformat(), "2024-12-02")

    def test_cn_study_holiday_alignment(self):
        # C06 2025-02-04 13:02 Beijing: A-shares closed for Spring Festival until Feb 5; US trades Feb 4.
        cn = bdays("2025-01-20", "2025-02-14", drop=pd.bdate_range("2025-01-28", "2025-02-04"))
        us = bdays("2025-01-20", "2025-02-14")
        t = parse_instant("2025-02-04T05:02:00.000Z")
        self.assertEqual(cn[event_day_index(t, cn, "CN")].date().isoformat(), "2025-02-05")
        self.assertEqual(us[event_day_index(t, us, "US")].date().isoformat(), "2025-02-04")
        # C08 2025-10-09 09:00 Beijing, before the 09:30 open, first session after Golden Week.
        cn2 = bdays("2025-09-22", "2025-10-17", drop=pd.bdate_range("2025-10-01", "2025-10-08"))
        t2 = parse_instant("2025-10-09T01:00:00.000Z")
        self.assertEqual(cn2[event_day_index(t2, cn2, "CN")].date().isoformat(), "2025-10-09")

    def test_after_last_session_none(self):
        s = bdays("2024-01-01", "2024-01-05")
        self.assertIsNone(event_day_index(parse_instant("2024-01-10T00:00:00Z"), s, "US"))


def synthetic(n=600, beta=1.2, shock_at=None, shock=0.0, seed=1):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2018-01-01", periods=n)
    m = rng.normal(0, 0.01, n)
    a = beta * m + rng.normal(0, 0.005, n)
    b = beta * m + rng.normal(0, 0.005, n)
    if shock_at is not None:
        a[shock_at] += shock
        b[shock_at] += shock
    return pd.DataFrame({"BM": m, "A": a, "B": b}, index=idx)


class TestCar(unittest.TestCase):
    def test_recovers_injected_abnormal_return(self):
        r = synthetic(shock_at=400, shock=-0.05)
        res = basket_event_car(r, "BM", ["A", "B"], 400)
        self.assertAlmostEqual(res.beta, 1.2, delta=0.1)
        self.assertAlmostEqual(res.car["[0,1]"], -0.05, delta=0.015)
        self.assertLess(res.t["[0,1]"], -3)

    def test_name_listed_after_event_is_excluded(self):
        r = synthetic(shock_at=400, shock=0.0)
        r.loc[r.index[:350], "B"] = np.nan  # "IPO" at row 350: < 120 obs before event
        res = basket_event_car(r, "BM", ["A", "B"], 400)
        self.assertEqual(res.names, ["A"])

    def test_insufficient_history_returns_none(self):
        self.assertIsNone(basket_event_car(synthetic(), "BM", ["A"], 100))

    def test_merge_close_events(self):
        self.assertEqual(merge_close_events([10, 12, 20, 24, 30], 5), ([10, 20, 30], [12, 24]))

    def test_cross_section_and_placebo_direction(self):
        cs = cross_section([-0.02, -0.01, -0.03, 0.005], "negative")
        self.assertEqual(cs["n_expected_sign"], 3)
        self.assertLess(cs["p_t_one_sided"], 0.1)
        r = synthetic(n=900)
        for i in (300, 400, 500, 600, 700):
            r.iloc[i, 1:] -= 0.04
        pp = placebo_p(r, "BM", ["A", "B"], [300, 400, 500, 600, 700], -0.04, "negative", (0, 1), draws=300)
        self.assertLess(pp["p_placebo"], 0.02)


class TestReturnsAndStats(unittest.TestCase):
    def test_suspension_gives_nan_not_zero(self):
        idx = pd.bdate_range("2024-01-01", periods=5)
        c = pd.DataFrame({"BM": [100, 101, 102, 103, 104], "X": [10, 11, np.nan, 12, 12.6]}, index=idx)
        r = to_returns(c, "BM")
        self.assertTrue(np.isnan(r.loc[idx[2], "X"]))
        self.assertTrue(np.isnan(r.loc[idx[3], "X"]))  # return across the gap is not attributed to one day
        self.assertAlmostEqual(r.loc[idx[4], "X"], 0.05)

    def test_t_sf_known_values(self):
        self.assertAlmostEqual(t_sf(2.0, 15), 0.03197, places=4)
        self.assertAlmostEqual(t_sf(0.0, 10), 0.5, places=6)
        self.assertAlmostEqual(t_sf(-1.753, 15), 0.95, places=3)

    def test_sign_test(self):
        self.assertAlmostEqual(sign_test_one_sided(12, 16), 0.0384, places=4)


if __name__ == "__main__":
    unittest.main()


class TestYahooChartFallback(unittest.TestCase):
    """The dependency-free loader used when yfinance is absent."""

    @staticmethod
    def payload(stamps, closes):
        return {"chart": {"result": [{"timestamp": stamps,
                                      "indicators": {"quote": [{"close": closes}]}}]}}

    def test_parses_closes_to_naive_dates(self):
        # 2018-06-20 and 2018-06-21, 00:00 UTC.
        s = parse_yahoo_chart(self.payload([1529452800, 1529539200], [905.25, 897.0]), "ZS=F")
        self.assertEqual(list(s.index.strftime("%Y-%m-%d")), ["2018-06-20", "2018-06-21"])
        self.assertIsNone(s.index.tz)
        self.assertAlmostEqual(s.iloc[0], 905.25)
        self.assertEqual(s.name, "ZS=F")

    def test_drops_null_sessions_rather_than_filling_them(self):
        # Yahoo pads with nulls; a forward-filled close would be an invented return.
        s = parse_yahoo_chart(self.payload([1529452800, 1529539200, 1529625600],
                                           [905.25, None, 897.0]), "ZS=F")
        self.assertEqual(len(s), 2)
        self.assertEqual(list(s.index.strftime("%Y-%m-%d")), ["2018-06-20", "2018-06-22"])

    def test_rejects_an_empty_or_all_null_response(self):
        for bad in ({"chart": {"result": []}},
                    self.payload([], []),
                    self.payload([1529452800], [None])):
            with self.assertRaises(RuntimeError):
                parse_yahoo_chart(bad, "ZS=F")


class TestExpectedSignIsExplicit(unittest.TestCase):
    """A non-directional sign used to pick the direction silently."""

    def test_cross_section_rejects_a_non_directional_sign(self):
        cars = [0.01, -0.02, 0.005, -0.001]
        for bad in ("null", "", "Negative", "down", None):
            with self.assertRaises(ValueError):
                cross_section(cars, bad)

    def test_the_two_directions_still_work_and_mirror_each_other(self):
        cars = [0.01, -0.02, 0.005, -0.001]
        pos = cross_section(cars, "positive")
        neg = cross_section(cars, "negative")
        self.assertAlmostEqual(pos["mean_car"], neg["mean_car"])
        # One-sided tests in opposite directions partition the probability.
        self.assertAlmostEqual(pos["p_t_one_sided"] + neg["p_t_one_sided"], 1.0, places=6)
        self.assertEqual(pos["n_expected_sign"] + neg["n_expected_sign"], len(cars))
