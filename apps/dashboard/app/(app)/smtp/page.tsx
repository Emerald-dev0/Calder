import Link from "next/link";
import { Server, KeyRound, Code2 } from "lucide-react";
import { DsPageHeader, StatusPill, DsBanner } from "../../../components/design-system";

export const metadata = { title: "Calder — SMTP" };

/**
 * Honest placeholder: the SMTP gateway is specified (docs/SMTP.md) but NOT
 * built, so this page must not show connection details or point at a
 * credential-creation flow that doesn't exist. Today, the only working way
 * to send is the REST API with an API key.
 */
export default function SmtpPage() {
  return (
    <div>
      <DsPageHeader
        icon={<Server size={18} />}
        title="SMTP Relay"
        badge={<StatusPill status="pending" label="Roadmap Specification" />}
        description="Connect Nodemailer, Laravel Mail, Rails ActionMailer, and Django SMTP clients to Calder."
        actions={
          <>
            <Link
              href="/sdks"
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <Code2 size={14} />
              <span>REST Quickstarts</span>
            </Link>
            <Link
              href="/keys"
              className="ds-btn ds-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <KeyRound size={14} />
              <span>Create API Key</span>
            </Link>
          </>
        }
      />

      <DsBanner
        tone="warning"
        title="SMTP relay is not available yet"
        description="The SMTP gateway is specified on the architecture roadmap, but it is not shipping yet—there is no host to connect to and no SMTP credentials to create."
      />

      <div className="ds-card" style={{ marginTop: 16 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Send Today via the HTTP REST API</h2>
            <p className="ds-card-subtitle">
              Zero external dependencies required—any language with HTTPS can call <code className="mono">POST /v1/emails</code>.
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-ink-secondary)" }}>
          <p style={{ margin: "0 0 12px" }}>
            Today, send with the REST API: create a scoped API key under{" "}
            <Link href="/keys" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
              API Keys
            </Link>{" "}
            and call <code className="mono">POST /v1/emails</code> from any language or framework.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href="/keys"
              className="ds-btn ds-btn-primary ds-btn-sm"
              style={{ textDecoration: "none" }}
            >
              <KeyRound size={13} />
              <span>Issue API Key</span>
            </Link>
            <Link
              href="/sdks"
              className="ds-btn ds-btn-secondary ds-btn-sm"
              style={{ textDecoration: "none" }}
            >
              <Code2 size={13} />
              <span>View Language Snippets</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
