import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, ArrowLeft } from "lucide-react";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { DsPageHeader, DsBanner } from "../../../../components/design-system";
import { broadcastOptions, createBroadcastAction } from "../actions";

export const metadata = { title: "Calder — New broadcast" };

export default async function NewBroadcastPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) notFound();

  const options = await broadcastOptions(scope.project.id);
  const ready = options.senders.length > 0 && options.audiences.length > 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link href={`/broadcasts?project=${scope.project.id}`} className="ds-btn" style={{ fontSize: 12, textDecoration: "none" }}>
          <ArrowLeft size={12} />
          <span>All broadcasts</span>
        </Link>
      </div>

      <DsPageHeader
        icon={<Megaphone size={18} />}
        title="New broadcast"
        description="Write it, test it, then send. Nothing leaves until you press send on the next screen."
      />

      {!ready && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="warning"
            title="Not ready to send yet"
            description={
              options.senders.length === 0
                ? "You need a verified sender before a broadcast can go out. Verify a domain and add a sender first."
                : "You need an audience with at least one contact."
            }
          />
        </div>
      )}

      <form action={createBroadcastAction} className="ds-card">
        <input type="hidden" name="projectId" value={scope.project.id} />
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">The message</h2>
            <p className="ds-card-subtitle">
              Personalisation tokens: <code>{"{{first_name}}"}</code>, <code>{"{{last_name}}"}</code>,{" "}
              <code>{"{{email}}"}</code>. Links are rewritten for click counting; the unsubscribe
              link is never wrapped.
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>Internal name</span>
              <input name="name" required maxLength={255} className="ds-input" placeholder="October product update" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>From</span>
              <select name="senderId" required className="ds-input" style={{ height: 38 }}>
                <option value="">Choose a verified sender</option>
                {options.senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.name} &lt;{sender.email}&gt;
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>Audience</span>
              <select name="audienceId" required className="ds-input" style={{ height: 38 }}>
                <option value="">Choose an audience</option>
                {options.audiences.map((audience) => (
                  <option key={audience.id} value={audience.id}>
                    {audience.name} · {audience.subscribed.toLocaleString("en-US")} subscribed
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span>Subject</span>
            <input name="subject" required maxLength={998} className="ds-input" placeholder="What shipped this month" />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span>Preview text (optional)</span>
            <input name="previewText" maxLength={255} className="ds-input" placeholder="Shown next to the subject in most inboxes" />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span>HTML body</span>
            <textarea
              name="html"
              required
              rows={14}
              className="ds-input"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
              placeholder={'<h1>What shipped</h1>\\n<p>Hi {{first_name}} — three things landed this month.</p>\\n<p><a href="https://calder.click/changelog">Read the changelog</a></p>'}
            />
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="submit" className="ds-btn ds-btn-primary" disabled={!ready}>
              Create draft
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
