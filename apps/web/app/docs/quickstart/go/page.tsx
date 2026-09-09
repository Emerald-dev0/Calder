import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart: Go — Calder Docs",
  description: "Send your first Calder email from Go with the standard library. Zero dependencies.",
};

const CODE = `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

func main() {
	body, _ := json.Marshal(map[string]string{
		"from":    "app@acme.com",
		"to":      "you@example.com",
		"subject": "Hello from Calder",
		"text":    "It works.",
	})
	req, _ := http.NewRequest("POST", "https://api.calder.click/v1/emails", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer calder_sk_test_…")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	fmt.Println(res.Status) // 202 Accepted
}`;

export default function GoQuickstart() {
  return (
    <>
      <h1>Quickstart: Go</h1>
      <p className="docs-lede">
        Standard library only — except <span className="mono">uuid</span> for the idempotency key (
        <span className="mono">go get github.com/google/uuid</span>).
      </p>
      <CodeBlock title="send.go" copyText={CODE}>
        <span className="tok-key">package</span> <span className="tok-path">main</span>
        {"\n\n"}
        <span className="tok-key">import</span> <span className="tok-punct">(</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">&quot;bytes&quot;</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">&quot;encoding/json&quot;</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">&quot;fmt&quot;</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">&quot;net/http&quot;</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">&quot;github.com/google/uuid&quot;</span>
        {"\n"}
        <span className="tok-punct">)</span>
        {"\n\n"}
        <span className="tok-key">func</span> <span className="tok-method">main</span>(){" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">// marshal payload, POST it, check for 202 —</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">// full source in the copy button above.</span>
        {"\n"}
        <span className="tok-punct">{"}"}</span>
      </CodeBlock>
      <p>
        <span className="mono">go run send.go</span> → expect{" "}
        <span className="mono">202 Accepted</span>. Timeouts deserve the same idempotency-key retry
        discipline as every other language: <Link href="/docs/idempotency">read why</Link>.
      </p>
    </>
  );
}
