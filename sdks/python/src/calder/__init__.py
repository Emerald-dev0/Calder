"""
Calder Python SDK — official client for https://api.calder.click/v1.

Zero dependencies (Python stdlib only: urllib). Python ≥ 3.9.

>>> from calder import Calder
>>> calder = Calder()  # reads CALDER_API_KEY
>>> result = calder.emails.send(
...     from_="app@yourdomain.com",
...     to="customer@example.com",
...     subject="Your receipt",
...     text="Thanks!",
... )
>>> result["id"], result["status"]

Design contract, identical to the Node SDK:
- sends are idempotent by default (UUID per call; pass idempotency_key to
  bind retries to your business entity, e.g. "order_123:receipt");
- one jittered-backoff retry on 5xx / 429 / network errors; 4xx never retries;
- errors are typed exceptions carrying status + the API's error message.
"""

from .client import Calder, EmailsResource
from .errors import (
    CalderError,
    CalderAuthError,
    CalderRateLimitError,
    CalderRequestError,
)

__all__ = [
    "Calder",
    "EmailsResource",
    "CalderError",
    "CalderAuthError",
    "CalderRateLimitError",
    "CalderRequestError",
]

__version__ = "0.1.0"
