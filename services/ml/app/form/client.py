"""Results-feed client with a FIXED MINIMUM INTERVAL between requests.

Rate-limit lesson: a bare concurrency semaphore is not enough. Once responses
get fast, a semaphore still bursts past the allowance — that returned 429s and
failed 183 dates mid-run. Pace by wall-clock interval, not just concurrency.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

BASE = os.environ.get("RACING_API_BASE", "https://api.theracingapi.com/v1")
MIN_INTERVAL_S = float(os.environ.get("RACING_API_MIN_INTERVAL", "0.55"))


class FeedError(RuntimeError):
    pass


class RacingFeed:
    def __init__(self, user: str | None = None, password: str | None = None):
        self.user = user or os.environ.get("RACING_API_USER")
        self.password = password or os.environ.get("RACING_API_PASS")
        if not self.user or not self.password:
            raise FeedError(
                "RACING_API_USER / RACING_API_PASS are not set. This archive is built "
                "from the licensed results feed; supply credentials to run it."
            )
        self.s = httpx.Client(auth=(self.user, self.password), timeout=60.0)
        self._last = 0.0

    def _pace(self) -> None:
        wait = MIN_INTERVAL_S - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, path: str, params: dict | None = None, *, retries: int = 4) -> Any:
        """GET with backoff. Transient failures (429 / 5xx / DNS blips / dropped
        connections) retry; a persistent failure raises so the CALLER decides
        whether to skip the date — it is never swallowed here."""
        last: Exception | None = None
        for attempt in range(retries):
            self._pace()
            try:
                r = self.s.get(f"{BASE}{path}", params=params)
                if r.status_code == 429 or r.status_code >= 500:
                    raise FeedError(f"{r.status_code} on {path}")
                if r.status_code >= 400:
                    raise FeedError(f"{r.status_code} on {path}: {r.text[:200]}")
                return r.json()
            except Exception as e:  # noqa: BLE001 - retry any transient transport error
                last = e
                if attempt < retries - 1:
                    time.sleep(min(2 ** attempt, 30))
        raise FeedError(f"failed after {retries} attempts: {last}")

    def results_for_date(self, day: str) -> list[dict]:
        """All charted races for a date. Paginates when the feed pages."""
        out: list[dict] = []
        skip, limit = 0, 50
        while True:
            d = self.get(f"/results/{day}", {"limit": limit, "skip": skip})
            races = d.get("results", d) if isinstance(d, dict) else d
            if not isinstance(races, list):
                break
            out.extend(races)
            if len(races) < limit:
                break
            skip += limit
            if skip > 5000:  # guard against a feed that never signals the end
                break
        return out
