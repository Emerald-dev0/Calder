# calder (PHP) — official SDK

```php
<?php
require_once __DIR__ . "/calder/src/Calder.php";   // or your PSR-4 autoload
$calder = new \Calder\Client();                    // CALDER_API_KEY env
$result = $calder->emails->send([
    "from" => "app@yourdomain.com",
    "to" => "customer@example.com",
    "subject" => "Your receipt",
    "text" => "Thanks!",
]);
echo $result["id"];
```

Idempotent by default (UUID per call; `"idempotencyKey" => "order_123:receipt"`
for cross-restart binds); 5xx/429/network retry ONCE with jittered backoff;
typed `\Calder\AuthError` / `\Calder\RateLimitError` (`retryAfterSeconds`) /
`\Calder\RequestError` (`status`, `body`). PHP ≥ 8.1, ext-curl only.

**Publication status:** source-available pending Packagist registration —
vendor `src/Calder.php` directly (single file, PSR-4 `Calder\`). Authored
without a PHP runtime in CI; treat as beta and verify against a test key.
