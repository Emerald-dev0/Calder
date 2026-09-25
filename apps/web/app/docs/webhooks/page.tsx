import type { Metadata } from "next";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Webhooks, Calder Docs",
  description:
    "Receive Calder lifecycle events: signed (Stripe-style t,v1 HMAC), retried on a 7-step ladder up to a dead-letter, and replayable from the dashboard.",
};

const EVENTS = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.clicked",
];

const NODE_VERIFY = `import crypto from "node:crypto";

// rawBody = the request body EXACTLY as received (no JSON re-stringify)
function verifyCalderWebhook(rawBody: string | Buffer, signature: string, secret: string) {
  const parts = Object.fromEntries(
    signature.split(",").map((kv) => [kv.split("=")[0], kv.split("=").slice(1).join("=")]),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false; // 5-minute replay window
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`, "utf8")
    .digest("hex");
  const a = Buffer.from(parts.v1 ?? "", "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

const PYTHON_VERIFY = `import hashlib, hmac, time

def verify_calder_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    parts = dict(kv.split("=", 1) for kv in signature.split(","))
    t = int(parts.get("t", "0"))
    if t == 0 or abs(time.time() - t) > 300:
        return False  # 5-minute replay window
    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(parts.get("v1", ""), expected)

# Flask: verify_calder_webhook(request.get_data(), request.headers["webhook-signature"], SECRET)`;

const RUBY_VERIFY = `require "openssl"
require "rack"

def verify_calder_webhook(raw_body, signature, secret)
  parts = signature.split(",").map { |kv| kv.split("=", 2) }.to_h
  t = parts["t"].to_i
  return false if t.zero? || (Time.now.to_i - t).abs > 300 # 5-minute window
  expected = OpenSSL::HMAC.hexdigest("sha256", secret, "#{t}.#{raw_body}")
  Rack::Utils.secure_compare(parts["v1"].to_s, expected)
end

# Rails: verify_calder_webhook(request.raw_post, request.headers["webhook-signature"], SECRET)`;

const PHP_VERIFY = `function verify_calder_webhook(string $rawBody, string $signature, string $secret): bool {
    $parts = [];
    foreach (explode(",", $signature) as $kv) { [$k, $v] = explode("=", $kv, 2); $parts[$k] = $v; }
    $t = (int)($parts["t"] ?? 0);
    if ($t === 0 || abs(time() - $t) > 300) return false; // 5-minute replay window
    $expected = hash_hmac("sha256", $t . "." . $rawBody, $secret);
    return hash_equals($expected, $parts["v1"] ?? "");
}

// Laravel: verify_calder_webhook($request->getContent(), $request->header("webhook-signature"), $secret)`;

const ENVELOPE = `POST /hooks/calder HTTP/1.1
content-type: application/json
webhook-id: whd_9f2k41xq
webhook-signature: t=1780272000,v1=8b1a…4f2c

{
  "id": "whd_9f2k41xq",
  "type": "email.delivered",
  "createdAt": "2026-09-24T10:00:00.000Z",
  "data": { "emailId": "em_9f2k41xq", "to": "you@example.com" }
}`;

export default function WebhooksGuide() {
  return (
    <>
      <h1>Webhooks</h1>
      <p className="docs-lede">
        Register an HTTPS endpoint and we POST every subscribed lifecycle event to it — signed
        Stripe-style, retried on a seven-step ladder for up to 24+ hours, and replayable when
        you&rsquo;ve fixed whatever broke on your side.
      </p>

      <div className="docs-note">
        <strong>Events you can subscribe to today:</strong>{" "}
        {EVENTS.map((e) => (
          <span key={e} className="mono" style={{ marginRight: 8 }}>
            {e}
          </span>
        ))}
      </div>

      <h2>1. Register an endpoint</h2>
      <CodeBlock
        title="register"
        copyText={`curl -X POST https://api.calder.click/v1/webhooks \\
  -H "Authorization: Bearer calder_sk_live_…" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://acme.com/hooks/calder","events":["email.delivered","email.bounced"]}'`}
      >
        {`curl -X POST https://api.calder.click/v1/webhooks \\
  -H "Authorization: Bearer calder_sk_live_…" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://acme.com/hooks/calder","events":["email.delivered","email.bounced"]}'`}
      </CodeBlock>
      <p>
        The URL must be public HTTPS — loopback and private RFC1918 addresses are rejected both at
        registration <em>and again at delivery time</em> (DNS-rebinding defense). You get back the
        endpoint ID and a signing secret (<span className="mono">whsec_…</span>), shown exactly
        once. Rotate it any time with{" "}
        <span className="mono">POST /v1/webhooks/:id/rotate</span>; the old secret stops signing
        immediately.
      </p>

      <h2>2. What arrives</h2>
      <CodeBlock title="one delivery" copyText={ENVELOPE}>{ENVELOPE}</CodeBlock>
      <p>
        The signature is over the <em>timestamp plus the body</em>:{" "}
        <span className="mono">v1 = HMAC-SHA256(secret, t + &quot;.&quot; + raw_body)</span>. The
        timestamp binds the signature to a point in time, which is what lets you reject replays
        older than five minutes.
      </p>

      <h2>3. Verify before trusting</h2>
      <p>
        Verify with a constant-time comparison and reject stale timestamps. No official SDKs are
        required — every example below is stdlib-only:
      </p>
      <CodeBlock title="verify.ts (Node 18+, built-in crypto)" copyText={NODE_VERIFY}>{NODE_VERIFY}</CodeBlock>
      <CodeBlock title="verify.py (stdlib)" copyText={PYTHON_VERIFY}>{PYTHON_VERIFY}</CodeBlock>
      <CodeBlock title="verify.rb (stdlib + rack)" copyText={RUBY_VERIFY}>{RUBY_VERIFY}</CodeBlock>
      <CodeBlock title="verify.php (built-ins)" copyText={PHP_VERIFY}>{PHP_VERIFY}</CodeBlock>

      <h2>4. Acknowledge fast, work later</h2>
      <p>
        Respond <span className="mono">2xx within 10&nbsp;seconds</span>. Anything else — timeout,
        4xx, 5xx — counts as a failed attempt. Retries fire at{" "}
        <span className="mono">5s → 30s → 2m → 10m → 30m → 2h → 6h</span>; after the eighth
        failed attempt the delivery lands in the dead-letter state (<span className="mono">failed</span>)
        and stops retrying. Deleting or disabling the endpoint fails in-flight deliveries
        terminally instead of burning the ladder.
      </p>

      <h2>5. Inspect and replay</h2>
      <p>
        Every attempt is recorded with HTTP status, latency, error message, and next-retry time —
        browse it in the dashboard (Webhooks → endpoint → <em>Deliveries</em>) or pull the last 25
        from <span className="mono">GET /v1/webhooks/:id/deliveries</span>. Replay a single
        delivery with{" "}
        <span className="mono">POST /v1/webhooks/:id/deliveries/:deliveryId/replay</span> (or
        the replay button): it creates a <em>new</em> delivery carrying the original{" "}
        <span className="mono">data</span>. Replays are deliberately never auto-deduped — dedupe
        on the business id inside <span className="mono">data</span> (e.g.{" "}
        <span className="mono">emailId</span>) if you must.
      </p>

      <div className="docs-note">
        <strong>Why the timestamp.</strong> Body-only HMACs prove a sender knew the secret, but not
        <em>when</em>. The <span className="mono">t,v1</span> format lets you reject a captured,
        re-played request — Calder&rsquo;s implementation of it is timing-safe and covered by six
        signature-vector tests (<a href="https://github.com/Emerald-dev0/Calder/blob/main/docs/DECISIONS.md">ADR-038</a>).
      </div>
    </>
  );
}
