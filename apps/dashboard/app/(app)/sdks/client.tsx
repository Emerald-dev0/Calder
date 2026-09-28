"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createTestKey } from "../onboarding/actions";

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
    "subject" => "Hello from Calder",
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

/**
 * M5.2: SDK snippets with REAL key injection. The key never leaves the
 * browser when pasted here; it is embedded only into the copy/downloaded
 * snippet. Creating a fresh test key mints server-side and is shown once.
 */
export function SdkHub({ projectId, hasKeys }: { projectId: string; hasKeys: boolean }) {
  const router = useRouter();
  const [lang, setLang] = React.useState("node");
  const [key, setKey] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const snippet = SNIPPETS.find((s) => s.id === lang)!;
  const rendered = snippet.code(key.trim() || KEY_PLACEHOLDER);

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 12px" }}>
        Official SDK packages live in the Calder repository (Node + Python tested in-repo; Ruby /
        PHP source-available) and publish to npm/PyPI with the launch checklist — the Node SDK /
        Python SDK tabs mirror exactly what lands there. Every SDK and raw snippet sends
        idempotently by default.
      </p>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <label
          style={{ fontSize: 12, color: "var(--color-muted)", display: "block", marginBottom: 6 }}
        >
          Paste an API key to inject it into every snippet below (never sent to the server —
          substitution happens in your browser):
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={KEY_PLACEHOLDER}
            className="mono"
            style={{
              flex: 1,
              minWidth: 260,
              height: 38,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "0 12px",
              fontSize: 13,
            }}
          />
          <button
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
            style={{
              height: 38,
              padding: "0 16px",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "#fff",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {hasKeys ? "Mint a new test key" : "Mint my first test key"}
          </button>
        </div>
        {error && (
          <p role="alert" style={{ color: "#DC2626", fontSize: 13, margin: "8px 0 0" }}>
            {error}
          </p>
        )}
        {key && (
          <p style={{ fontSize: 12, color: "#B45309", margin: "8px 0 0" }}>
            New keys are shown once — save the minted key somewhere safe (or copy a snippet below,
            then clear this field).
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            onClick={() => setLang(s.id)}
            style={{
              fontSize: 12,
              border: `1px solid ${lang === s.id ? "#0B0C0E" : "var(--color-border)"}`,
              padding: "4px 10px",
              borderRadius: 6,
              background: lang === s.id ? "#0B0C0E" : "#fff",
              color: lang === s.id ? "#fff" : "inherit",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(rendered);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          style={{
            fontSize: 12,
            border: "1px solid var(--color-border)",
            padding: "4px 12px",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>

      <div
        style={{
          background: "#0B0C0E",
          borderRadius: 12,
          padding: 16,
          color: "#E8E9EA",
          position: "relative",
        }}
      >
        <span style={{ position: "absolute", top: 10, right: 14, fontSize: 11, color: "#B5B5B5" }}>
          {snippet.filename}
        </span>
        <pre
          className="mono"
          style={{ fontSize: 12, lineHeight: 1.6, overflowX: "auto", margin: 0, whiteSpace: "pre" }}
        >
          {rendered}
        </pre>
      </div>

      <p style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 10 }}>
        Full contract: <a href="https://calder.click/docs/api-reference">API reference</a> ·
        templates by alias · <a href="https://calder.click/docs/webhooks">webhook verification</a>{" "}
        snippets in the same four languages.
      </p>
    </div>
  );
}
