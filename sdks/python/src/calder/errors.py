"""Typed Calder API errors — all extend CalderError with .status and .body."""

from __future__ import annotations

from typing import Any, Optional


class CalderError(Exception):
    """Base error for every Calder API failure."""

    def __init__(self, message: str, status: int, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.code: Any = None
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                self.code = err.get("code")


class CalderAuthError(CalderError):
    """401/403 — bad key or missing scope. Never retried."""

    def __init__(self, message: str, body: Any = None) -> None:
        super().__init__(message, 401, body)


class CalderRateLimitError(CalderError):
    """429 — rate limit or quota. Exposes retry_after_seconds when sent."""

    def __init__(self, message: str, retry_after_seconds: Optional[float] = None, body: Any = None) -> None:
        super().__init__(message, 429, body)
        self.retry_after_seconds = retry_after_seconds


class CalderRequestError(CalderError):
    """4xx other than 401/429 — the request itself is wrong. Never retried."""

    def __init__(self, message: str, status: int = 400, body: Any = None) -> None:
        super().__init__(message, status, body)
