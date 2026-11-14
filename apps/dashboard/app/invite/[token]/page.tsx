import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE } from "@calder/auth";
import { previewInvitation } from "../../../lib/invites";
import { acceptInvitationAction } from "./actions";

/**
 * The invitation landing page.
 *
 * Four questions, answered from the state of the row and the identity of the
 * viewer — never from the URL alone:
 *
 *   does this token exist   → valid / revoked / invalid
 *   has it been used        → accepted
 *   has it lapsed           → expired
 *   whose seat is it        → the address it was issued to
 *
 * A signed-in viewer whose address matches can accept here; anyone else is
 * shown who the invitation is for. The link carries `next` into sign-in so the
 * invitee comes back to this page instead of the dashboard home.
 */

const buttonStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#0B0C0E",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "12px 28px",
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
  font: "inherit",
};

const secondaryStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  color: "#0B0C0E",
  border: "1px solid #D4D4D4",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 480, margin: "12vh auto", padding: 24, textAlign: "center" }}>
      <p style={{ fontWeight: 700, fontSize: 22, margin: "0 0 24px" }}>Calder</p>
      {children}
    </div>
  );
}

const ERROR_COPY: Record<string, string> = {
  expired: "That invitation expired before it was accepted. Ask your admin for a new one.",
  invalid: "We don't recognise this invitation. It may have been revoked.",
  already_accepted_elsewhere:
    "This invitation was already used and that membership has since been removed. Ask an admin to invite you again.",
  wrong_account: "This invitation belongs to a different email address.",
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  const jar = await cookies();
  const viewer = await getSessionUser(jar.get(SESSION_COOKIE)?.value);
  const preview = await previewInvitation(token);
  const errorCopy = query.error ? ERROR_COPY[query.error] : undefined;
  const invitePath = `/invite/${token}`;
  const matchesViewer =
    !!viewer &&
    !!preview.email &&
    viewer.email.trim().toLowerCase() === preview.email.toLowerCase();

  return (
    <Shell>
      {errorCopy && (
        <p
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13.5,
            margin: "0 0 20px",
          }}
        >
          {errorCopy}
        </p>
      )}

      {preview.state === "valid" && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>You&rsquo;re invited</h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 8px" }}>
            Join <b>{preview.organizationName}</b> on Calder
            {preview.email ? (
              <>
                {" "}
                as <span className="mono">{preview.email}</span>
              </>
            ) : null}
            .
          </p>

          {!viewer && (
            <>
              <p style={{ color: "#737373", fontSize: 13, margin: "0 0 24px" }}>
                Sign in with that address — or create the account — and you will come straight back
                here to accept.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <Link href={`/login?next=${encodeURIComponent(invitePath)}`} style={buttonStyle}>
                  Sign in to accept →
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(invitePath)}&email=${encodeURIComponent(
                    preview.email ?? ""
                  )}`}
                  style={secondaryStyle}
                >
                  Create an account
                </Link>
              </div>
            </>
          )}

          {viewer && matchesViewer && (
            <>
              <p style={{ color: "#737373", fontSize: 13, margin: "0 0 24px" }}>
                You are signed in as <span className="mono">{viewer.email}</span>. Accepting adds
                you to this workspace as {preview.role ?? "a member"}.
              </p>
              <form action={acceptInvitationAction.bind(null, token)}>
                <button type="submit" style={buttonStyle}>
                  Accept invitation →
                </button>
              </form>
            </>
          )}

          {viewer && !matchesViewer && (
            <>
              <p style={{ color: "#737373", fontSize: 13, margin: "0 0 16px" }}>
                You are signed in as <span className="mono">{viewer.email}</span>, which is not the
                address this invitation was sent to. An invitation can only be accepted by the
                person it names.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <Link href={`/login?next=${encodeURIComponent(invitePath)}`} style={buttonStyle}>
                  Sign in with the invited address
                </Link>
                <Link href="/" style={secondaryStyle}>
                  Back to Calder
                </Link>
              </div>
            </>
          )}
        </>
      )}

      {preview.state === "accepted" && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Already accepted</h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 24px" }}>
            This invitation
            {preview.organizationName ? (
              <>
                {" "}
                to <b>{preview.organizationName}</b>
              </>
            ) : null}{" "}
            has been used.{" "}
            {matchesViewer
              ? "Open it from the switcher."
              : "Sign in with the address it was sent to."}
          </p>
          {viewer && matchesViewer ? (
            <form action={acceptInvitationAction.bind(null, token)}>
              <button type="submit" style={buttonStyle}>
                Open {preview.organizationName ?? "workspace"} →
              </button>
            </form>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(invitePath)}`} style={buttonStyle}>
              Sign in →
            </Link>
          )}
        </>
      )}

      {(preview.state === "expired" ||
        preview.state === "invalid" ||
        preview.state === "revoked") && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>
            {preview.state === "expired" ? "This invitation expired" : "This link is not active"}
          </h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 24px" }}>
            {preview.state === "expired"
              ? "Invitations last 7 days. Ask an admin of the workspace to send a fresh one."
              : "It may have been revoked, or it never existed. Ask an admin to invite you again."}
          </p>
          <Link href="/login" style={{ color: "#0B0C0E", fontWeight: 600 }}>
            Go to sign in →
          </Link>
        </>
      )}
    </Shell>
  );
}
