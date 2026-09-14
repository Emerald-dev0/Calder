import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Suppressions" };

export default function SuppressionsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Suppressions</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Bounced or complained addresses are blocked before send.</p>
      <EmptyState
        title="No suppressed addresses"
        description="Calder hasn't recorded any bounced or complained addresses for this project. That's good."
        illustration="abstract"
      />
    </div>
  );
}
