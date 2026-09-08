import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart: Shell scripting — Calder Docs",
  description: "Script the Calder API from bash: send, poll status, and automate with curl.",
};

const CODE = `#!/usr/bin/env bash
set -euo pipefail
KEY="calder_sk_test_…"

# Send — the key makes this safe to re-run
ID=$(curl -s https://api.calder.com/v1/emails \\
  -H "Authorization: Bearer $KEY" \\
  -H "Idempotency-Key: deploy-notify-$(date +%F)" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"app@acme.com","to":"team@acme.com",
       "subject":"Deploy done","text":"v2.4.1 is live."}' \\
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Poll until it leaves the queue
for i in $(seq 1 10); do
  STATUS=$(curl -s https://api.calder.com/v1/emails/$ID \\
    -H "Authorization: Bearer $KEY" \\
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
  echo "status: $STATUS"
  [ "$STATUS" = "queued" ] || break
  sleep 2
done`;

export default function CliQuickstart() {
  return (
    <>
      <h1>Quickstart: Shell scripting</h1>
      <p className="docs-lede">
        No official CLI yet — but the API is script-friendly by design. This pattern covers deploy
        notifications, cron alerts, and CI pipelines.
      </p>
      <CodeBlock title="notify.sh" copyText={CODE}>
        <span className="tok-dim">#!/usr/bin/env bash</span>
        {"\n"}
        <span className="tok-key">set</span> -euo pipefail
        {"\n"}
        <span className="tok-path">KEY</span>
        <span className="tok-dim">=</span>
        <span className="tok-str">&quot;calder_sk_test_…&quot;</span>
        {"\n\n"}
        <span className="tok-dim"># Send — dated idempotency key: safe to re-run all day.</span>
        {"\n"}
        <span className="tok-path">ID</span>
        <span className="tok-dim">=$(</span>
        <span className="tok-key">curl</span> -s{" "}
        <span className="tok-path">https://api.calder.com/v1/emails</span> …
        <span className="tok-dim">)</span>
        {"\n\n"}
        <span className="tok-dim"># Poll status until it leaves the queue.</span>
        {"\n"}
        <span className="tok-key">for</span> i <span className="tok-key">in</span> $(seq 1 10);{" "}
        <span className="tok-key">do</span> … <span className="tok-key">done</span>
      </CodeBlock>
      <div className="docs-note">
        <strong>Use dated keys for recurring jobs.</strong>{" "}
        <span className="mono">deploy-notify-$(date +%F)</span> means a retried cron run replays
        instead of double-sending — idempotency doing yard work.
      </div>
      <p>
        Store the key in an environment variable or secret store, never in the script. Then see{" "}
        <Link href="/docs/webhooks">Webhooks</Link> to stop polling entirely.
      </p>
    </>
  );
}
