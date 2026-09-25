# calder — the official Calder Node.js SDK

Transactional email with durable delivery and honest outcomes. Zero dependencies, Node ≥ 18.17.

```bash
npm install calder
```

```ts
import Calder from "calder";

const calder = new Calder({ apiKey: process.env.CALDER_API_KEY });

const { id, status } = await calder.emails.send({
  from: "app@yourdomain.com",      // verified sender or sender_… id
  to: "customer@example.com",
  subject: "Your receipt",
  html: "<strong>Thanks!</strong>",
  // Idempotent by default: a UUID is generated when omitted. Bind to your
  // own entity for cross-restart safety:
  idempotencyKey: "order_123:receipt",
});

const email = await calder.emails.get(id);           // status + timestamps
const { data, nextCursor } = await calder.emails.list({ limit: 25 });
```

## Behavior contract

| Case | What the SDK does |
|---|---|
| Success | Returns the parsed JSON response |
| 401/403 | `CalderAuthError` (never retried) |
| 429 | `CalderRateLimitError` with `retryAfterMs` |
| other 4xx | `CalderRequestError` carrying the API's `error` message |
| 5xx once, then anything | one retry with jittered backoff, then `CalderError` |
| network/timeout | one retry, then the original error |
| 10s default timeout | `timeoutMs` option to change |

All errors extend `CalderError` (`status`, `body` fields).

## Options

```ts
new Calder({
  apiKey,        // or CALDER_API_KEY env
  baseUrl,       // default https://api.calder.click
  timeoutMs,     // default 10_000
  fetchImpl,     // tests only
});
```

## Development

```bash
pnpm install
pnpm test        # unit tests (mocked fetch)
pnpm build       # emits dist/ with .d.ts
pnpm publish     # registry step is manual (see docs/DEPLOYMENT.md)
```
