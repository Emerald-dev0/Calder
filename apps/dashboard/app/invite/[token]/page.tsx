import Link from "next/link";
import { getInvitePreview } from "../../(app)/settings/actions";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const preview = await getInvitePreview(params.token);

  return (
    <div style={{ maxWidth: 480, margin: "12vh auto", padding: 24, textAlign: "center" }}>
      <p style={{ fontWeight: 700, fontSize: 22, margin: "0 0 24px" }}>Calder</p>
      {preview.state === "valid" && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>You&rsquo;re invited</h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 8px" }}>
            Join <b>{preview.orgName}</b> on Calder
            {preview.email ? (
              <>
                {" "}
                as <span className="mono">{preview.email}</span>
              </>
            ) : null}
            .
          </p>
          <p style={{ color: "#737373", fontSize: 13, margin: "0 0 24px" }}>
            Sign in and the membership attaches automatically, no codes to paste.
          </p>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              background: "#0B0C0E",
              color: "#fff",
              borderRadius: 10,
              padding: "12px 28px",
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sign in to accept →
          </Link>
        </>
      )}
      {preview.state === "accepted" && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Already in</h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 24px" }}>
            This invite was already accepted
            {preview.orgName ? (
              <>
                {" "}
                for <b>{preview.orgName}</b>
              </>
            ) : null}
            . Just sign in.
          </p>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              background: "#0B0C0E",
              color: "#fff",
              borderRadius: 10,
              padding: "12px 28px",
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sign in →
          </Link>
        </>
      )}
      {(preview.state === "invalid" || preview.state === "expired") && (
        <>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Link {preview.state}</h1>
          <p style={{ color: "#737373", fontSize: 15, margin: "0 0 24px" }}>
            {preview.state === "expired"
              ? "Invites last 7 days, ask your admin for a fresh one."
              : "We don't recognize this invite. Check the link or ask your admin to resend it."}
          </p>
          <Link href="/login" style={{ color: "#0B0C0E", fontWeight: 600 }}>
            Go to sign in →
          </Link>
        </>
      )}
    </div>
  );
}
