import { Reveal } from "./reveal";
import { CodeBlock } from "./code";

/**
 * Two interfaces, one pipeline. API for modern stacks, SMTP for everything
 * that already speaks it — converging into the same queue, worker, events.
 */
export function SmtpSection() {
  return (
    <section className="section" id="smtp" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Two ways in</p>
          <h2 className="h2">
            Use the interface <em>you already know.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Modern app? POST JSON. Existing stack, WordPress, Laravel, cron scripts? Point your SMTP
            client at us. Either way there&rsquo;s no mail server to run, no queue to babysit, no
            retries to implement — and delivery lands in the same observable pipeline.
          </p>
        </Reveal>
        <div className="dev-grid">
          <Reveal>
            <CodeBlock
              title="api — POST /v1/emails → 202"
              copyText={`curl https://api.calder.com/v1/emails -H "Authorization: Bearer calder_sk_live_…" -d '{"from":"app@acme.com","to":"ada@example.com","subject":"Hi","text":"…"}'`}
            >
              <span className="tok-method">POST</span> <span className="tok-path">/v1/emails</span>{" "}
              <span className="tok-method">→ 202</span>
              {"\n"}
              <span className="tok-punct">{"{"}</span>{" "}
              <span className="tok-key">&quot;id&quot;</span>:{" "}
              <span className="tok-str">&quot;em_9f2k41xq&quot;</span>,{" "}
              <span className="tok-key">&quot;status&quot;</span>:{" "}
              <span className="tok-str">&quot;queued&quot;</span>{" "}
              <span className="tok-punct">{"}"}</span>
            </CodeBlock>
          </Reveal>
          <Reveal delay={120}>
            <CodeBlock
              title="smtp — smtp.calder.com:587"
              copyText={`host: smtp.calder.com
port: 587 (STARTTLS)
user: <project SMTP username>
pass: <generated secret, shown once>`}
            >
              <span className="tok-key">host</span>:{" "}
              <span className="tok-str">smtp.calder.com</span>
              {"\n"}
              <span className="tok-key">port</span>: <span className="tok-num">587</span>{" "}
              <span className="tok-dim">(STARTTLS)</span>
              {"\n"}
              <span className="tok-key">user</span>:{" "}
              <span className="tok-str">&lt;project username&gt;</span>
              {"\n"}
              <span className="tok-key">pass</span>:{" "}
              <span className="tok-str">&lt;generated secret&gt;</span>
              {"\n"}
              <span className="tok-method">→ 250 Queued</span>{" "}
              <span className="tok-dim">(same pipeline)</span>
            </CodeBlock>
          </Reveal>
        </div>
        <Reveal delay={80}>
          <div className="pipeline-return" style={{ marginTop: "1.4rem" }}>
            <span>you never operate →</span>
            <span className="event-pill">mail servers</span>
            <span className="event-pill">queues</span>
            <span className="event-pill">retries</span>
            <span className="event-pill">webhooks</span>
            <span className="event-pill">provider infra</span>
            <span>bring a domain when ready — test keys need nothing</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
