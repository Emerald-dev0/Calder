import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Templates" };

export default function TemplatesPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Templates</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Reusable email templates for your application.</p>
      <EmptyState
        title="No templates yet"
        description="Create reusable email templates for welcome emails, OTPs, receipts, and notifications. Variables, preview, and test send included."
        actionLabel="Create template"
        actionHref="/templates/new"
      />
    </div>
  );
}
