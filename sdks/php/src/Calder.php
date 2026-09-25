<?php
declare(strict_types=1);

/**
 * Official Calder PHP SDK — transactional email, durable delivery,
 * idempotent sends. Zero dependencies (ext-curl), PHP ≥ 8.1, PSR-4: Calder\.
 *
 *   $calder = new \Calder\Client($_ENV["CALDER_API_KEY"] ?? null);
 *   $result = $calder->emails->send([
 *       "from" => "app@yourdomain.com",
 *       "to" => "customer@example.com",
 *       "subject" => "Your receipt",
 *       "text" => "Thanks!",
 *   ]);
 *   echo $result["id"]; // em_…
 *
 * Retry contract (parity with the Node/Python/Ruby SDKs): 5xx, 429 and
 * network errors retry once with jittered backoff; 4xx never retries. Sends
 * are idempotent by default — a UUID is generated per call unless
 * "idempotencyKey" is passed to bind retries to your business entity.
 */

namespace Calder;

class Error extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status,
        public readonly mixed $body = null,
    ) {
        parent::__construct($message, $status);
    }
}

/** 401/403 — bad key or missing scope. Never retried. */
class AuthError extends Error
{
    public function __construct(string $message, mixed $body = null)
    {
        parent::__construct($message, 401, $body);
    }
}

/** 429 — rate limit or quota, exposes retry-after seconds when sent. */
class RateLimitError extends Error
{
    public function __construct(
        string $message,
        public readonly ?float $retryAfterSeconds,
        mixed $body = null,
    ) {
        parent::__construct($message, 429, $body);
    }
}

/** 4xx other than 401/429 — the request is wrong. Never retried. */
class RequestError extends Error
{
}

final class Client
{
    private const DEFAULT_BASE_URL = "https://api.calder.click";
    private const MAX_ATTEMPTS = 2;

    public readonly EmailsResource $emails;

    private readonly string $apiKey;
    private readonly string $baseUrl;
    private readonly float $timeoutSeconds;

    public function __construct(
        ?string $apiKey = null,
        string $baseUrl = self::DEFAULT_BASE_URL,
        float $timeoutSeconds = 10.0,
    ) {
        $key = $apiKey ?? (getenv("CALDER_API_KEY") ?: null);
        if ($key === null || $key === "") {
            throw new \InvalidArgumentException(
                "Calder SDK: no API key. Pass it to the constructor or set CALDER_API_KEY."
            );
        }
        $this->apiKey = $key;
        $this->baseUrl = $baseUrl;
        $this->timeoutSeconds = $timeoutSeconds;
        $this->emails = new EmailsResource($this);
    }

    /** Internal transport implementing the shared retry contract. */
    public function request(
        string $method,
        string $path,
        ?array $body = null,
        ?array $query = null,
        ?string $idempotencyKey = null,
    ): mixed {
        $url = rtrim($this->baseUrl, "/") . $path;
        if ($query) {
            $url .= "?" . http_build_query(array_filter($query, static fn ($v) => $v !== null));
        }

        $lastError = null;
        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            $headers = [
                "Authorization: Bearer {$this->apiKey}",
                "Content-Type: application/json",
            ];
            if ($idempotencyKey !== null) {
                $headers[] = "Idempotency-Key: {$idempotencyKey}";
            }

            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => (int) ceil($this->timeoutSeconds),
                CURLOPT_HEADER => true,
            ]);
            if ($body !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR));
            }

            $rawResponse = curl_exec($ch);
            $errno = curl_errno($ch);
            $err = curl_error($ch);
            $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
            curl_close($ch);

            if ($rawResponse === false || $errno !== 0) {
                // Network failure: retry once.
                $lastError = new \RuntimeException("Calder transport error: {$err}");
                if ($attempt < self::MAX_ATTEMPTS) {
                    usleep((int) (($attempt * 250_000) + random_int(0, 250_000)));
                    continue;
                }
                throw $lastError;
            }

            $responseHeaders = substr((string) $rawResponse, 0, $headerSize);
            $rawBody = substr((string) $rawResponse, $headerSize);
            $parsed = $rawBody === "" ? null : json_decode($rawBody, true);
            if ($rawBody !== "" && json_last_error() !== JSON_ERROR_NONE) {
                $parsed = $rawBody;
            }

            if ($httpCode >= 200 && $httpCode < 300) {
                return $parsed;
            }

            $err = \is_array($parsed) ? ($parsed["error"] ?? null) : null;
            $message = \is_array($err) && \is_string($err["message"] ?? null)
                ? $err["message"]            // public API shape { error: { code, message } }
                : (\is_string($err) && $err !== ""
                    ? $err                   // legacy flat-string shape
                    : "Calder API error {$httpCode}");

            if ($httpCode === 401 || $httpCode === 403) {
                throw new AuthError($message, $parsed);
            }
            if ($httpCode === 429) {
                $retryAfter = null;
                if (preg_match('/retry-after:\s*(\d+)/i', $responseHeaders, $m)) {
                    $retryAfter = (float) $m[1];
                }
                throw new RateLimitError($message, $retryAfter, $parsed);
            }
            if ($httpCode >= 500) {
                $lastError = new Error($message, $httpCode, $parsed);
                if ($attempt < self::MAX_ATTEMPTS) {
                    usleep((int) (($attempt * 250_000) + random_int(0, 250_000)));
                    continue;
                }
                throw $lastError;
            }
            throw new RequestError($message, $httpCode, $parsed);
        }
        throw $lastError;
    }
}

final class EmailsResource
{
    public function __construct(private readonly Client $client)
    {
    }

    /**
     * Send one transactional email. Idempotent by default: supply
     * $params["idempotencyKey"] to bind retries to your business entity
     * ("order_123:receipt"); otherwise one UUID is generated per call.
     *
     * @param array{from:string,to:string|array,subject:string,text?:string,html?:string,cc?:string|array,bcc?:string|array,replyTo?:string,headers?:array,metadata?:array,idempotencyKey?:string} $params
     */
    public function send(array $params): array
    {
        foreach (["from", "to", "subject"] as $required) {
            if (empty($params[$required])) {
                throw new RequestError("send() requires from, to and subject.", 400);
            }
        }
        if (empty($params["text"]) && empty($params["html"])) {
            throw new RequestError("send() requires text or html content.", 400);
        }

        $idempotencyKey = $params["idempotencyKey"] ?? null;
        unset($params["idempotencyKey"]);

        return $this->client->request(
            "POST",
            "/v1/emails",
            $params,
            null,
            $idempotencyKey ?? self::uuid(),
        ) ?? [];
    }

    public function get(string $id): array
    {
        return $this->client->request("GET", "/v1/emails/" . rawurlencode($id)) ?? [];
    }

    public function list(?int $limit = null, ?string $cursor = null, ?string $status = null): array
    {
        return $this->client->request("GET", "/v1/emails", null, [
            "limit" => $limit === null ? null : (string) $limit,
            "cursor" => $cursor,
            "status" => $status,
        ]) ?? [];
    }

    private static function uuid(): string
    {
        $d = random_bytes(16);
        $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
        $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
        return vsprintf("%s%s-%s-%s-%s-%s%s%s", str_split(bin2hex($d), 4));
    }
}
