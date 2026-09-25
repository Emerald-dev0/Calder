# calder (Ruby) — official SDK

```ruby
require_relative "path/to/calder"
calder = Calder::Client.new   # or Calder::Client.new(api_key: "calder_sk_live_…")
result = calder.emails.send(
  from: "app@yourdomain.com", to: "customer@example.com",
  subject: "Your receipt", text: "Thanks!",
  idempotency_key: "order_123:receipt", # optional; UUID auto-generated when omitted
)
```

Idempotent by default; 5xx/429/network retry ONCE with jittered backoff; typed
errors `Calder::AuthError` / `Calder::RateLimitError` (`retry_after_seconds`) /
`Calder::RequestError` (`status`, `body`). Stdlib-only (net/http).

**Publication status:** source-available in the monorepo pending `calder` gem
registration — copy `lib/calder.rb` into your app or vendor it. Gem tests live
with the repo CI pass once a Ruby toolchain is available (this file was
authored without a Ruby runtime at hand; treat as beta and run your own send
against a test key first).
