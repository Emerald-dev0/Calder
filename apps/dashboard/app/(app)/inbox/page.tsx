import { PlanGate } from "../../../components/plan-gate";

export const metadata = { title: "Calder — Inbox" };

export default function InboxPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Inbox</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Receive email directly into your application.</p>
      <PlanGate
        title="Inbound email is available on Pro"
        description="Route incoming email directly into your application with Calder. Webhooks for every inbound message, same observability as sending."
        tier="PRO"
        features={["Inbound domains", "Webhook for inbound", "Raw + parsed view", "Same IDs as sending"]}
      />
    </div>
  );
}
