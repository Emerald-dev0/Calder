import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
 title: "Quickstart: Python, Calder Docs",
 description: "Send your first Calder email from Python with requests.",
};

const CODE = `import requests, uuid

res = requests.post(
 "https://api.calder.click/v1/emails",
 headers={
 "Authorization": "Bearer calder_sk_test_…",
 "Idempotency-Key": str(uuid.uuid4()),
 },
 json={
 "from": "app@acme.com",
 "to": "you@example.com",
 "subject": "Hello from Calder",
 "text": "It works.",
 },
 timeout=10,
)
print(res.json()) # {"id": "em_9f2k41xq", "status": "queued", ...}`;

export default function PythonQuickstart() {
 return (
 <>
 <h1>Quickstart: Python</h1>
 <p className="docs-lede">
 One dependency (<span className="mono">pip install requests</span>) and nine lines.
 </p>
 <CodeBlock title="send.py" copyText={CODE}>
 <span className="tok-key">import</span> <span className="tok-path">requests</span>, {" "}
 <span className="tok-path">uuid</span>
 {"\n\n"}
 <span className="tok-path">res</span> <span className="tok-dim">=</span>{" "}
 <span className="tok-path">requests.post</span>({"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">headers</span>
 <span className="tok-dim">=</span>
 <span className="tok-punct">{"{"}</span>
 {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;Authorization&quot;</span>:{" "}
 <span className="tok-str">&quot;Bearer calder_sk_test_…&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;Idempotency-Key&quot;</span>:{" "}
 <span className="tok-path">str</span>(<span className="tok-path">uuid.uuid4</span>()),
 {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-punct">{"}"}</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">json</span>
 <span className="tok-dim">=</span>
 <span className="tok-punct">{"{"}</span>
 {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;from&quot;</span>:{" "}
 <span className="tok-str">&quot;app@acme.com&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;to&quot;</span>:{" "}
 <span className="tok-str">&quot;you@example.com&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;subject&quot;</span>:{" "}
 <span className="tok-str">&quot;Hello from Calder&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
 <span className="tok-str">&quot;text&quot;</span>:{" "}
 <span className="tok-str">&quot;It works.&quot;</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-punct">{"}"}</span>, {"\n"}
 &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">timeout</span>
 <span className="tok-dim">=</span>
 <span className="tok-num">10</span>, {"\n"}){"\n"}
 <span className="tok-method">print</span>(<span className="tok-path">res.json</span>()){" "}
 <span className="tok-dim">
 # {"{"}&quot;id&quot;: &quot;em_9f2k41xq&quot;, …{"}"}
 </span>
 </CodeBlock>
 <div className="docs-note">
 <strong>Always set a timeout.</strong> The API answers in milliseconds, but your HTTP client
 should never wait forever, on timeout, retry with the <em>same</em> idempotency key.
 </div>
 <p>
 Next: <Link href="/docs/idempotency">why that key matters</Link>, then{" "}
 <Link href="/docs/webhooks">Webhooks</Link>.
 </p>
 </>
 );
}
