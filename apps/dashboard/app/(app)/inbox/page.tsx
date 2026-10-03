import { Inbox } from "lucide-react";
import { PlanGate } from "../../../components/plan-gate";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export const metadata = { title: "Calder — Inbox" };

export default function InboxPage() {
  return (
    <div>
      <DsPageHeader
        icon={<Inbox size={18} />}
        title="Inbound Inbox"
        badge={<StatusPill status="pro" label="PRO Feature" />}
        description="Receive, parse, and route incoming emails directly into your application via signed webhooks."
      />
      <PlanGate
        title="Inbound email routing is available on Pro"
        description="Accept replies, support tickets, and inbound workflows on your custom domain. Calder parses MIME headers, attachments, and reply chains into clean JSON webhooks."
        tier="PRO"
        features={[
          "Custom MX inbound domains & address wildcards",
          "HMAC-signed JSON webhook for every inbound email",
          "Raw MIME + parsed HTML/Text & attachment extraction",
          "Unified correlation IDs matching outbound threads",
        ]}
        preview={
          <div style={{ textAlign: "left", fontSize: 12 }}>
            <div
              className="mono"
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>inbound.received · reply+ticket_849@mail.acme.com</span>
              <span>200 OK · 94ms</span>
            </div>
            <div
              className="mono"
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 8px",
              }}
            >
              <span>inbound.received · billing@mail.acme.com</span>
              <span>200 OK · 112ms</span>
            </div>
          </div>
        }
      />
    </div>
  );
}
