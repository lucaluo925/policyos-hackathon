"""Small, dependency-free statistics (no scipy on every machine)."""
from __future__ import annotations

import math


def t_sf(t: float, df: int) -> float:
    """P(T > t) for Student t with df degrees of freedom (Simpson integration)."""
    if df <= 0 or math.isnan(t):
        return float("nan")
    c = math.exp(math.lgamma((df + 1) / 2) - math.lgamma(df / 2)) / math.sqrt(df * math.pi)
    pdf = lambda x: c * (1 + x * x / df) ** (-(df + 1) / 2)
    a, b = 0.0, abs(t)
    n = max(200, int(b * 200)) // 2 * 2
    h = (b - a) / n if n else 0
    s = pdf(a) + pdf(b) + sum((4 if k % 2 else 2) * pdf(a + k * h) for k in range(1, n))
    area = s * h / 3 if n else 0.0  # P(0 < T < |t|)
    return 0.5 - area if t >= 0 else 0.5 + area


def sign_test_one_sided(n_pos: int, n: int) -> float:
    """P(X >= n_pos), X ~ Binomial(n, 0.5)."""
    return sum(math.comb(n, k) for k in range(n_pos, n + 1)) / 2**n
