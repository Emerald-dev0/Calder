import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Logs" };

export default function LogsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Logs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Every request, queued to delivered, with request_id.</p>
      <EmptyState
        title="No events yet"
        description="Once your application sends its first message, its lifecycle — queued → provider → delivered — will appear here with request_id and message_id."
        actionLabel="Send test email"
        actionHref="/emails/new"
      />
    </div>
  );
}
