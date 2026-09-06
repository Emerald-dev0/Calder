import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart: PHP — Avenor Docs",
  description: "Send your first Avenor email from PHP with the cURL extension.",
};

const CODE = `$ch = curl_init("https://api.avenor.com/v1/emails");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer avenor_sk_test_…",
        "Idempotency-Key: " . bin2hex(random_bytes(16)),
        "Content-Type: application/json",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "from" => "app@acme.com",
        "to" => "you@example.com",
        "subject" => "Hello from Avenor",
        "text" => "It works.",
    ]),
]);
$res = curl_exec($ch);
echo $res; // {"id":"em_9f2k41xq","status":"queued",…}`;

export default function PhpQuickstart() {
  return (
    <>
      <h1>Quickstart: PHP</h1>
      <p className="docs-lede">
        The cURL extension (enabled in virtually every PHP build) is all you need.
      </p>
      <CodeBlock title="send.php" copyText={CODE}>
        <span className="tok-path">$ch</span> <span className="tok-dim">=</span>{" "}
        <span className="tok-method">curl_init</span>(
        <span className="tok-str">&quot;https://api.avenor.com/v1/emails&quot;</span>);
        {"\n"}
        <span className="tok-method">curl_setopt_array</span>(<span className="tok-path">$ch</span>,
        [{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">CURLOPT_POST</span>{" "}
        <span className="tok-dim">=&gt;</span> <span className="tok-key">true</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">CURLOPT_RETURNTRANSFER</span>{" "}
        <span className="tok-dim">=&gt;</span> <span className="tok-key">true</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">CURLOPT_TIMEOUT</span>{" "}
        <span className="tok-dim">=&gt;</span> <span className="tok-num">10</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span className="tok-dim">// headers incl. Idempotency-Key, JSON body —</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span className="tok-dim">// full source in the copy button above.</span>
        {"\n"}
        ]);
      </CodeBlock>
      <p>
        Check <span className="mono">curl_errno($ch)</span> for transport failures and retry with
        the same key. Then continue to <Link href="/docs/webhooks">Webhooks</Link>.
      </p>
    </>
  );
}
