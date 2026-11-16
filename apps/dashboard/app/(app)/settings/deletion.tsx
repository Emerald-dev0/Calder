import type { DeletionStatus } from "@calder/db";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { DsBanner } from "../../../components/design-system";
import {
  cancelAccountDeletionAction,
  cancelWorkspaceDeletionAction,
  requestAccountDeletionAction,
  requestWorkspaceDeletionAction,
} from "./actions";

/**
 * The danger zone: deleting a workspace and deleting your own account.
 *
 * Two properties are visible on purpose. The typing requirement is the
 * workspace's own address (or the account's own email), because a button this
 * destructive must not be reachable by a passing click; and the grace window is
 * stated as a date, because "seven days" is only reassuring if you can see when
 * it ends. Nothing here deletes anything — it schedules, and the page can
 * always take it back until the sweep runs.
 */
export function DeletionZone({
  workspace,
  workspaceStatus,
  canDeleteWorkspace,
  accountEmail,
  accountStatus,
}: {
  workspace: { id: string; name: string; slug: string } | null;
  workspaceStatus: DeletionStatus;
  canDeleteWorkspace: boolean;
  accountEmail: string;
  accountStatus: DeletionStatus;
}) {
  return (
    <div id="danger" style={{ marginTop: 20 }}>
      <div className="ds-card" style={{ borderColor: "rgba(190, 60, 50, 0.35)" }}>
        <div className="ds-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} style={{ color: "#B4433A" }} />
            <div>
              <h2 className="ds-card-title">Deletion</h2>
              <p className="ds-card-subtitle">
                Requested deletions stop sending immediately and can be cancelled until the purge
                runs. Nothing is destroyed in the request itself.
              </p>
            </div>
          </div>
        </div>

        <div className="ds-card-body" style={{ display: "grid", gap: 24 }}>
          {workspace ? (
            <section>
              <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
                Workspace · <span className="mono">{workspace.slug}</span>
              </h3>
              {workspaceStatus.pending && workspaceStatus.scheduledFor ? (
                <>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-muted)" }}>
                    Scheduled for deletion on <b>{formatDay(workspaceStatus.scheduledFor)}</b> —
                    that is {workspaceStatus.daysRemaining} day
                    {workspaceStatus.daysRemaining === 1 ? "" : "s"} from now. Sending has already
                    stopped. Everything in this workspace (projects, domains, senders, keys,
                    webhooks, templates and delivery history) is destroyed when the purge runs.
                  </p>
                  {canDeleteWorkspace ? (
                    <form action={cancelWorkspaceDeletionAction}>
                      <input type="hidden" name="organizationId" value={workspace.id} />
                      <button type="submit" className="ds-btn ds-btn-primary">
                        Keep this workspace
                      </button>
                    </form>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>
                      Only an owner can cancel this deletion.
                    </p>
                  )}
                </>
              ) : canDeleteWorkspace ? (
                <form action={requestWorkspaceDeletionAction} style={{ display: "grid", gap: 8 }}>
                  <input type="hidden" name="organizationId" value={workspace.id} />
                  <label style={{ fontSize: 13, color: "var(--color-muted)" }}>
                    Type <span className="mono">{workspace.slug}</span> to confirm.
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="ds-input"
                      name="confirmation"
                      placeholder={workspace.slug}
                      autoComplete="off"
                      spellCheck={false}
                      style={{ maxWidth: 280 }}
                    />
                    <button type="submit" className="ds-btn" style={{ color: "#B4433A" }}>
                      <CalendarClock size={14} />
                      <span>Schedule deletion</span>
                    </button>
                  </div>
                </form>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>
                  Only an owner can delete this workspace.
                </p>
              )}
            </section>
          ) : null}

          <section style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
              Your account · <span className="mono">{accountEmail}</span>
            </h3>
            {accountStatus.pending && accountStatus.scheduledFor ? (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-muted)" }}>
                  Scheduled for deletion on <b>{formatDay(accountStatus.scheduledFor)}</b>. Your
                  account, its sessions, and any workspace where you are the only member go with it.
                </p>
                <form action={cancelAccountDeletionAction}>
                  <button type="submit" className="ds-btn ds-btn-primary">
                    Keep my account
                  </button>
                </form>
              </>
            ) : (
              <form action={requestAccountDeletionAction} style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 13, color: "var(--color-muted)" }}>
                  Type <span className="mono">{accountEmail}</span> to confirm. Workspaces with
                  other members are refused until you transfer ownership.
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="ds-input"
                    name="confirmation"
                    placeholder={accountEmail}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ maxWidth: 280 }}
                  />
                  <button type="submit" className="ds-btn" style={{ color: "#B4433A" }}>
                    <CalendarClock size={14} />
                    <span>Schedule account deletion</span>
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Feedback for a deletion round trip, so a refusal is readable rather than a crash. */
export function deletionNotice(state: string | undefined) {
  if (!state) return null;
  const copy: Record<string, { tone: "success" | "danger" | "info"; title: string; body: string }> =
    {
      requested: {
        tone: "success",
        title: "Deletion scheduled",
        body: "Sending has stopped. You can cancel any time before the purge runs; after that the data is gone.",
      },
      cancelled: {
        tone: "info",
        title: "Deletion cancelled",
        body: "Nothing was destroyed. Sending resumes where your plan allows it.",
      },
      account_requested: {
        tone: "success",
        title: "Account deletion scheduled",
        body: "You are still signed in. Cancel before the purge date if you change your mind.",
      },
      account_cancelled: {
        tone: "info",
        title: "Account deletion cancelled",
        body: "Your account is unchanged.",
      },
      confirmation_mismatch: {
        tone: "danger",
        title: "That did not match",
        body: "Type the address exactly as shown — the deletion was not scheduled.",
      },
      forbidden: {
        tone: "danger",
        title: "Only an owner can do that",
        body: "Ask a workspace owner to make this request.",
      },
      sole_owner: {
        tone: "danger",
        title: "Transfer ownership first",
        body: "You own a workspace that other people belong to. Transfer it to another member, then delete your account.",
      },
      not_scheduled: {
        tone: "info",
        title: "Nothing to cancel",
        body: "That workspace or account is not scheduled for deletion.",
      },
      error: {
        tone: "danger",
        title: "That did not work",
        body: "Nothing was deleted. Try again, or contact support if it keeps failing.",
      },
    };
  const entry = copy[state];
  if (!entry) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <DsBanner tone={entry.tone} title={entry.title} description={entry.body} />
    </div>
  );
}
