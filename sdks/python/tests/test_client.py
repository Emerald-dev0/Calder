"""Calder Python SDK unit tests — transport seam mocked, no network."""

from __future__ import annotations

import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

import pytest  # noqa: E402

from calder import (  # noqa: E402
    Calder,
    CalderAuthError,
    CalderRateLimitError,
    CalderRequestError,
)


class FakeTransport:
    def __init__(self):
        self.calls = []  # (method, url, headers, body)
        self.responses = []  # queued (status, headers, body-dict)

    def then(self, status, body, headers=None):
        self.responses.append((status, headers or {}, json.dumps(body).encode()))

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append((method, url, headers, body))
        status, res_headers, raw = self.responses.pop(0)
        return status, res_headers, raw


def make_client():
    transport = FakeTransport()
    return Calder(api_key="calder_sk_test_py", transport=transport), transport


class TestSend:
    def test_posts_json_with_idempotency_header(self):
        client, t = make_client()
        t.then(200, {"id": "em_1", "status": "queued"})
        out = client.emails.send(from_="app@acme.com", to="you@x.com", subject="hi", text="body")
        assert out["id"] == "em_1"
        method, url, headers, body = t.calls[0]
        assert method == "POST"
        assert url == "https://api.calder.click/v1/emails"
        assert headers["Authorization"] == "Bearer calder_sk_test_py"
        assert len(headers["Idempotency-Key"]) == 36  # uuid4
        parsed = json.loads(body.decode())
        assert parsed["from"] == "app@acme.com"
        assert "idempotencyKey" not in parsed

    def test_caller_idempotency_key_honored(self):
        client, t = make_client()
        t.then(200, {"id": "em_2", "status": "queued"})
        client.emails.send(
            from_="a@b.co", to="c@d.co", subject="s", html="<p>x</p>",
            idempotency_key="order-123:confirm",
        )
        assert t.calls[0][2]["Idempotency-Key"] == "order-123:confirm"

    def test_missing_fields_rejected_client_side(self):
        client, t = make_client()
        with pytest.raises(CalderRequestError):
            client.emails.send(from_="a@b.co", to="", subject="s", text="x")
        assert not t.calls

    def test_requires_content(self):
        client, _ = make_client()
        with pytest.raises(CalderRequestError):
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s")


class TestErrors:
    def test_401_raises_auth(self):
        client, t = make_client()
        t.then(401, {"error": "Invalid key."})
        with pytest.raises(CalderAuthError):
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")

    def test_429_raises_with_retry_after(self):
        client, t = make_client()
        t.then(429, {"error": "Slow down."}, {"Retry-After": "30"})
        with pytest.raises(CalderRateLimitError) as exc:
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert exc.value.retry_after_seconds == 30.0

    def test_422_carries_api_message(self):
        client, t = make_client()
        t.then(422, {"error": "Domain not verified."})
        with pytest.raises(CalderRequestError) as exc:
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert str(exc.value) == "Domain not verified."
        assert exc.value.status == 422


class TestRetries:
    def test_500_retried_once(self, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda *_: None)
        client, t = make_client()
        t.then(500, {"error": "boom"})
        t.then(200, {"id": "em_ok", "status": "queued"})
        out = client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert out["id"] == "em_ok"
        assert len(t.calls) == 2

    def test_4xx_never_retried(self):
        client, t = make_client()
        t.then(400, {"error": "nope"})
        with pytest.raises(CalderRequestError):
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert len(t.calls) == 1

    def test_network_failure_propagates_after_retry(self, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda *_: None)
        calls = []

        def exploding(method, url, headers, body, timeout):
            calls.append(url)
            raise ConnectionError("socket hang up")

        flaky = Calder(api_key="k", transport=exploding)
        with pytest.raises(ConnectionError):
            flaky.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert len(calls) == 2  # retried once, then gave up


class TestReads:
    def test_get_encodes_id(self):
        client, t = make_client()
        t.then(200, {"id": "em_42", "status": "delivered"})
        got = client.emails.get("em_42")
        assert got["status"] == "delivered"
        assert t.calls[0][1].endswith("/v1/emails/em_42")

    def test_list_query_params(self):
        client, t = make_client()
        t.then(200, {"data": [], "nextCursor": None})
        client.emails.list(limit=25, cursor="abc", status="delivered")
        url = t.calls[0][1]
        assert "limit=25" in url
        assert "cursor=abc" in url
        assert "status=delivered" in url


class TestConstruction:
    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("CALDER_API_KEY", raising=False)
        with pytest.raises(ValueError):
            Calder()

    def test_env_key(self, monkeypatch):
        monkeypatch.setenv("CALDER_API_KEY", "calder_sk_test_env")
        assert isinstance(Calder(), Calder)


class TestStructuredErrors:
    def test_structured_shape_message_and_code(self):
        client, t = make_client()
        t.then(422, {"error": {"code": "suppressed", "message": "Recipient suppressed."}})
        with pytest.raises(CalderRequestError) as exc:
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert str(exc.value) == "Recipient suppressed."
        assert exc.value.code == "suppressed"

    def test_flat_string_still_works(self):
        client, t = make_client()
        t.then(400, {"error": "plain message"})
        with pytest.raises(CalderRequestError) as exc:
            client.emails.send(from_="a@b.co", to="c@d.co", subject="s", text="x")
        assert str(exc.value) == "plain message"
