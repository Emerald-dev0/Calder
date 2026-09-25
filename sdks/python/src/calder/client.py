from __future__ import annotations
import json
from typing import Any, Callable, Dict, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from .errors import CalderApiError


class Calder:
    def __init__(self, api_key: str, base_url: str = "https://api.calder.click", transport: Optional[Callable[..., Any]] = None):
        if not api_key:
            raise ValueError("Calder API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._transport = transport

    def request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            if self._transport:
                response = self._transport(request)
                status = getattr(response, "status", 200)
                payload = json.loads(response.read())
            else:
                with urlopen(request, timeout=30) as response:
                    status = response.status
                    payload = json.loads(response.read())
        except HTTPError as error:
            try:
                payload = json.loads(error.read())
            except Exception:
                payload = {}
            detail = payload.get("error", {})
            raise CalderApiError(detail.get("message", str(error)), error.code, detail.get("code"), detail.get("request_id")) from error
        if status < 200 or status >= 300:
            detail = payload.get("error", {})
            raise CalderApiError(detail.get("message", "Calder API request failed"), status, detail.get("code"), detail.get("request_id"))
        return payload.get("data", payload)

    def send_email(self, *, from_: str, to: str, subject: str, text: Optional[str] = None, html: Optional[str] = None, stream: str = "transactional", idempotency_key: Optional[str] = None, **kwargs: Any) -> Any:
        body = {"from": from_, "to": to, "subject": subject, "stream": stream, **kwargs}
        if text is not None:
            body["text"] = text
        if html is not None:
            body["html"] = html
        return self.request("/v1/emails", "POST", body, idempotency_key)

    def list_domains(self) -> Any:
        return self.request("/v1/domains")

    def create_domain(self, domain: str) -> Any:
        return self.request("/v1/domains", "POST", {"domain": domain})

    def verify_domain(self, domain_id: str) -> Any:
        return self.request(f"/v1/domains/{domain_id}/verify", "POST")
