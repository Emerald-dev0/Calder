import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Deliveries" };

export default function DeliveriesPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Deliveries</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Delivery intelligence per sender, domain, and provider.</p>
      <EmptyState
        title="No deliveries yet"
        description="Send your first email and see delivery rate, bounces, and provider breakdown here. Filter by sender, status, and date."
        actionLabel="Go to Email"
        actionHref="/emails"
      />
    </div>
  );
}
