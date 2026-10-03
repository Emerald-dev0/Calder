"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Sparkles, ExternalLink } from "lucide-react";
import { createTestKey } from "../onboarding/actions";
import { CodeBlock, DsBanner } from "../../../components/design-system";

const KEY_PLACEHOLDER = "calder_sk_test_…";

const SNIPPETS: Array<{
  id: string;
  label: string;
  filename: string;
  code: (key: string) => string;
}> = [
  {
    id: "node",
    label: "Node.js",
    filename: "send.mjs",
    code: (key) => `// No SDK package needed — plain HTTPS (Node 18+, built-in fetch)
const res = await fetch("https://api.calder.click/v1/emails", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${key}",
    "Idempotency-Key": crypto.randomUUID(),
    "content-type": "application/json",
  },
  body: JSON.stringify({
    from: "app@yourdomain.com",
    to: "you@example.com",
    subject: "Hello from Calder",
    text: "It works.",
  }),
});
const { id, status } = await res.json();`,
  },
  {
    id: "python",
    label: "Python",
    filename: "send.py",
    code: (key) => `import requests, uuid

res = requests.post(
    "https://api.calder.click/v1/emails",
    headers={
        "Authorization": "Bearer ${key}",
        "Idempotency-Key": str(uuid.uuid4()),
    },
    json={
        "from": "app@yourdomain.com",
        "to": "you@example.com",
        "subject": "Hello from Calder",
        "text": "It works.",
    },
    timeout=10,
)
print(res.json())`,
  },
  {
    id: "ruby",
    label: "Ruby",
    filename: "send.rb",
    code: (key) => `require "net/http"
require "json"
require "securerandom"

uri = URI("https://api.calder.click/v1/emails")
res = Net::HTTP.start(uri.host, uri.port, use_ssl: true) do |http|
  http.post(uri, {
    from: "app@yourdomain.com",
    to: "you@example.com",
    subject: "Hello from Calder",
    text: "It works.",
  }.to_json, {
    "Authorization" => "Bearer ${key}",
    "Idempotency-Key" => SecureRandom.uuid,
    "Content-Type" => "application/json",
  })
end
puts res.body`,
  },
  {
    id: "php",
    label: "PHP",
    filename: "send.php",
    code: (key) => `<?php
$ch = curl_init("https://api.calder.click/v1/emails");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer ${key}",
    "Idempotency-Key: " . bin2hex(random_bytes(16)),
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "from" => "app@yourdomain.com",
    "to" => "you@example.com",
    "subject": "Hello from Calder",
    "text" => "It works.",
  ]),
  CURLOPT_TIMEOUT => 10,
]);
echo curl_exec($ch);`,
  },
  {
    id: "go",
    label: "Go",
    filename: "main.go",
    code: (key) => `req, _ := http.NewRequest("POST", "https://api.calder.click/v1/emails",
  bytes.NewReader(payload))
req.Header.Set("Authorization", "Bearer ${key}")
req.Header.Set("Idempotency-Key", uuid.NewString())
req.Header.Set("Content-Type", "application/json")
res, _ := (&http.Client{Timeout: 10 * time.Second}).Do(req)`,
  },
  {
    id: "curl",
    label: "cURL",
    filename: "send.sh",
    code: (key) => `curl -X POST https://api.calder.click/v1/emails \\
  -H "Authorization: Bearer ${key}" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "content-type: application/json" \\
  -d '{"from":"app@yourdomain.com","to":"you@example.com",
       "subject":"Hello from Calder","text":"It works."}'`,
  },
  {
    id: "node-sdk",
    label: "Node SDK",
    filename: "send-sdk.mjs",
    code: (key) => `// npm install calder
import Calder from "calder";

const calder = new Calder({ apiKey: "${key}" });

const { id, status } = await calder.emails.send({
  from: "app@yourdomain.com",
  to: "you@example.com",
  subject: "Hello from Calder",
  text: "It works.",
  // Idempotent by default; bind to your entity for restart-safe retries:
  idempotencyKey: "my-first-send",
});`,
  },
  {
    id: "python-sdk",
    label: "Python SDK",
    filename: "send_sdk.py",
    code: (key) => `# pip install calder
from calder import Calder

calder = Calder(api_key="${key}")

result = calder.emails.send(
    from_="app@yourdomain.com",
    to="you@example.com",
    subject="Hello from Calder",
    text="It works.",
    idempotency_key="my-first-send",
)`,
  },
];

export function SdkHub({ projectId, hasKeys }: { projectId: string; hasKeys: boolean }) {
  const router = useRouter();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeKey = key.trim() || KEY_PLACEHOLDER;

  return (
    <div>
      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Browser-Local API Key Injection</h2>
            <p className="ds-card-subtitle">
              Paste an existing key or mint a sandbox test key to populate every code snippet below (substitution happens strictly in your browser).
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={KEY_PLACEHOLDER}
              className="ds-input mono"
              style={{ flex: 1, minWidth: 260 }}
            />
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const r = await createTestKey(projectId, "sdk-snippets key");
                  setKey(r.secret);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not create key.");
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="ds-btn ds-btn-secondary"
            >
              <KeyRound size={14} />
              <span>{hasKeys ? "Mint a new test key" : "Mint my first test key"}</span>
            </button>
          </div>
          {error && (
            <div style={{ marginTop: 12 }}>
              <DsBanner tone="danger" title="Could not create key" description={error} />
            </div>
          )}
          {key && (
            <div style={{ marginTop: 12 }}>
              <DsBanner
                tone="warning"
                title="Save your minted key safely"
                description="New keys are shown once—copy your snippet below or store the key in your secret manager before leaving this page."
              />
            </div>
          )}
        </div>
      </div>

      <CodeBlock
        tabs={SNIPPETS.map((s) => ({
          id: s.id,
          label: s.label,
          filename: s.filename,
          code: s.code(activeKey),
        }))}
      />

      <div
        className="ds-card"
        style={{
          marginTop: 16,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 12.5,
          color: "var(--color-muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} style={{ color: "var(--color-accent)" }} />
          <span>
            Official Node & Python SDKs send idempotently by default and support automatic retry backoff.
          </span>
        </span>
        <div style={{ display: "inline-flex", gap: 14 }}>
          <a
            href="https://calder.click/docs/api-reference"
            style={{
              color: "var(--color-ink)",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>API Reference</span>
            <ExternalLink size={12} />
          </a>
          <a
            href="https://calder.click/docs/webhooks"
            style={{
              color: "var(--color-ink)",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>Webhook Verification</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
