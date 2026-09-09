import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
 title: "Quickstart: Ruby, Calder Docs",
 description: "Send your first Calder email from Ruby with net/http from the standard library.",
};

const CODE = `require "net/http"
require "json"
require "securerandom"

uri = URI("https://api.calder.click/v1/emails")
res = Net::HTTP.post(uri, {
 from: "app@acme.com",
 to: "you@example.com",
 subject: "Hello from Calder",
 text: "It works.",
}.to_json, {
 "Authorization" => "Bearer calder_sk_test_…",
 "Idempotency-Key" => SecureRandom.uuid,
 "Content-Type" => "application/json",
})
puts res.body # {"id":"em_9f2k41xq", "status":"queued", …}`;

export default function RubyQuickstart() {
 return (
 <>
 <h1>Quickstart: Ruby</h1>
 <p className="docs-lede">
 Standard library only, <span className="mono">net/http</span>, {" "}
 <span className="mono">json</span>, <span className="mono">securerandom</span>. Nothing to
 install.
 </p>
 <CodeBlock title="send.rb" copyText={CODE}>
 <span className="tok-key">require</span>{" "}
 <span className="tok-str">&quot;net/http&quot;</span>
 {"\n"}
 <span className="tok-key">require</span> <span className="tok-str">&quot;json&quot;</span>
 {"\n"}
 <span className="tok-key">require</span>{" "}
 <span className="tok-str">&quot;securerandom&quot;</span>
 {"\n\n"}
 <span className="tok-path">uri</span> <span className="tok-dim">=</span>{" "}
 <span className="tok-path">URI</span>(
 <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>){"\n"}
 <span className="tok-path">res</span> <span className="tok-dim">=</span>{" "}
 <span className="tok-path">Net::HTTP.post</span>(<span className="tok-path">uri</span>, {" "}
 <span className="tok-dim">{/* payload */}</span>, <span className="tok-punct">{"{"}</span>
 {"\n"}
 &nbsp;&nbsp;<span className="tok-str">&quot;Authorization&quot;</span>{" "}
 <span className="tok-dim">=&gt;</span>{" "}
 <span className="tok-str">&quot;Bearer calder_sk_test_…&quot;</span>, {"\n"}
 &nbsp;&nbsp;<span className="tok-str">&quot;Idempotency-Key&quot;</span>{" "}
 <span className="tok-dim">=&gt;</span> <span className="tok-path">SecureRandom.uuid</span>,
 {"\n"}
 <span className="tok-punct">{"}"}</span>){"\n"}
 <span className="tok-path">puts</span> <span className="tok-path">res.body</span>{" "}
 <span className="tok-dim">
 # {"{"}&quot;id&quot;: &quot;em_9f2k41xq&quot;, …{"}"}
 </span>
 </CodeBlock>
 <p>
 Wrap the call with a short read timeout in production, and keep going to{" "}
 <Link href="/docs/idempotency">Idempotency</Link>.
 </p>
 </>
 );
}
