# Calder SDKs

Official clients for `https://api.calder.click/v1`. Every SDK shares one
behavior contract — same error taxonomy, same retry policy, same idempotency
rules (tested identically in Node and Python):

| Behavior     | Contract                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotency  | Every `send` ships an `Idempotency-Key` — a generated UUID by default, or your business key (`"order_123:receipt"`) when passed. Safe retries never double-send.                                              |
| Retries      | 5xx / 429 / network errors → exactly ONE retry with jittered backoff (~250–500ms). 4xx → never retried.                                                                                                       |
| Errors       | `CalderAuthError` (401/403), `CalderRateLimitError` (429, carries Retry-After), `CalderRequestError` (other 4xx, carries the API's `error` message), all extending a common `CalderError` (`status`, `body`). |
| Timeouts     | 10 s per attempt by default, configurable.                                                                                                                                                                    |
| Dependencies | Zero, in every language (fetch / urllib / net/http / ext-curl).                                                                                                                                               |

## Libraries

| Language             | Location            | Status                                       | Install                                     |
| -------------------- | ------------------- | -------------------------------------------- | ------------------------------------------- |
| Node.js / TypeScript | `packages/sdk-node` | ✅ tested in-repo (13 tests)                 | `npm install calder` after registry publish |
| Python               | `sdks/python`       | ✅ tested in-repo (14 tests)                 | `pip install calder` after PyPI publish     |
| Ruby                 | `sdks/ruby`         | authored; runtime-unverified in this sandbox | vendor `lib/calder.rb` (gem pending)        |
| PHP                  | `sdks/php`          | authored; runtime-unverified in this sandbox | vendor `src/Calder.php` (Packagist pending) |

## Publish steps (owner manual)

1. `npm publish` from `packages/sdk-node` (name `calder`, access public).
2. `python -m build && twine upload dist/*` from `sdks/python`.
3. Cut a Ruby gem + `packagist.org` submission once respective CI runtimes exist.
4. THEN flip the dashboard SDK hub tabs from raw-cURL copies to the installed
   SDK snippets — the hub always mirrors what is actually publishable.
