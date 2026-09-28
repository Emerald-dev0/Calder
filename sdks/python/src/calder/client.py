"""Calder SDK core — stdliburllib transport with the shared retry contract."""

from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from .errors import (
    CalderAuthError,
    CalderError,
    CalderRateLimitError,
    CalderRequestError,
)

DEFAULT_BASE_URL = "https://api.calder.click"
_MAX_ATTEMPTS = 2  # one retry

# Transport seam: (method, url, headers, body_bytes, timeout) ->
# (status, headers_dict, body_bytes). Tests inject a fake here.
Transport = Callable[[str, str, Dict[str, str], Optional[bytes], float], "tuple[int, Dict[str, str], bytes]"]


def _urllib_transport(
    method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float
) -> "tuple[int, Dict[str, str], bytes]":
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (HTTPS + caller-configured URL)
            return res.status, dict(res.headers.items()), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


def _message_from_body(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        err = body.get("error")
        # Public API shape: {"error": {"code": ..., "message": ...}};
        # older flat-string shape tolerated as well.
        if isinstance(err, dict):
            msg = err.get("message")
            if isinstance(msg, str) and msg:
                return msg
        if isinstance(err, str) and err:
            return err
    return fallback


def _code_from_body(body: Any) -> Any:
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return err.get("code")
    return None


def _backoff_seconds(attempt: int) -> float:
    return 0.25 * attempt + random.uniform(0, 0.25)  # noqa: S311 — jitter, not crypto


class Calder:
    """Client entry point: ``Calder(api_key=...)`` or env CALDER_API_KEY."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: float = 10.0,
        transport: Optional[Transport] = None,
    ) -> None:
        key = api_key or os.environ.get("CALDER_API_KEY")
        if not key:
            raise ValueError(
                "Calder SDK: no API key. Pass api_key= or set CALDER_API_KEY. "
                "Keys live in the dashboard → Keys."
            )
        self._api_key = key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._transport: Transport = transport or _urllib_transport
        self.emails = EmailsResource(self)

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Optional[str]]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if query:
            params = {k: v for k, v in query.items() if v is not None}
            if params:
                url = f"{url}?{urllib.parse.urlencode(params)}"

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        payload = json.dumps(body).encode("utf-8") if body is not None else None

        last_error: Optional[Exception] = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                status, res_headers, raw = self._transport(method, url, headers, payload, self._timeout)
            except Exception as e:  # network failure → retryable once
                last_error = e
                if attempt < _MAX_ATTEMPTS:
                    time.sleep(_backoff_seconds(attempt))
                    continue
                raise

            parsed: Any = None
            if raw:
                try:
                    parsed = json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    parsed = raw.decode("utf-8", errors="replace")

            if 200 <= status < 300:
                return parsed

            message = _message_from_body(parsed, f"Calder API error {status}")
            if status in (401, 403):
                raise CalderAuthError(message, parsed)
            if status == 429:
                retry_after = None
                raw_ra = res_headers.get("Retry-After") or res_headers.get("retry-after")
                if raw_ra:
                    try:
                        retry_after = float(raw_ra)
                    except ValueError:
                        retry_after = None
                raise CalderRateLimitError(message, retry_after, parsed)
            if status >= 500:
                last_error = CalderError(message, status, parsed)
                if attempt < _MAX_ATTEMPTS:
                    time.sleep(_backoff_seconds(attempt))
                    continue
                raise last_error
            raise CalderRequestError(message, status, parsed)

        if last_error is not None:
            raise last_error
        raise CalderError("Calder request failed.", 0)


class EmailsResource:
    """``calder.emails`` — send + read email resources."""

    def __init__(self, client: Calder) -> None:
        self._client = client

    def send(
        self,
        *,
        from_: str,
        to: Union[str, Sequence[str]],
        subject: str,
        text: Optional[str] = None,
        html: Optional[str] = None,
        cc: Optional[Union[str, Sequence[str]]] = None,
        bcc: Optional[Union[str, Sequence[str]]] = None,
        reply_to: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send one transactional email. Idempotent by default.

        ``from_`` is snake_case for the API's ``from`` field (reserved word).
        """
        if not from_ or not to or not subject:
            raise CalderRequestError("send() requires from_, to and subject.")
        if not text and not html:
            raise CalderRequestError("send() requires text or html content.")
        body: Dict[str, Any] = {"from": from_, "to": to, "subject": subject}
        if text is not None:
            body["text"] = text
        if html is not None:
            body["html"] = html
        if cc is not None:
            body["cc"] = cc
        if bcc is not None:
            body["bcc"] = bcc
        if reply_to is not None:
            body["replyTo"] = reply_to
        if headers is not None:
            body["headers"] = headers
        if metadata is not None:
            body["metadata"] = metadata
        return self._client._request(
            "POST",
            "/v1/emails",
            body=body,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    def get(self, email_id: str) -> Dict[str, Any]:
        """Retrieve one email with its delivery state."""
        return self._client._request("GET", f"/v1/emails/{urllib.parse.quote(email_id, safe='')}")

    def list(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List recent emails for the key's project."""
        return self._client._request(
            "GET",
            "/v1/emails",
            query={
                "limit": str(limit) if limit is not None else None,
                "cursor": cursor,
                "status": status,
            },
        )
