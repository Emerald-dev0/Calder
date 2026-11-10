import Link from "next/link";
import { ArrowRight, Code2, KeyRound, Server } from "lucide-react";
import { ComingSoon } from "../../../components/coming-soon";
import { DsBanner, DsPageHeader, StatusPill } from "../../../components/design-system";

export const metadata = { title: "Calder — SMTP" };

/**
 * SMTP is specified in docs/SMTP.md and not built.
 *
 * There is no gateway process, no host to connect to and no credential to
 * issue. The page keeps that statement front and centre and points at the one
 * interface that actually works: the REST API.
 */
export default function SmtpPage() {
  return (
    <div>
      <ComingSoon
        feature="smtp_gateway"
        title="SMTP Relay"
        description="The SMTP gateway is not available yet. It is a specification, not a running service: there is no host to connect to and no SMTP credential to create."
        checklist={[
          "No SMTP listener runs in this deployment",
          "No project SMTP username or secret can be issued",
          "Use the REST API for sending today",
        ]}
      />

      <div style={{ marginTop: 20 }}>
        <DsPageHeader
          icon={<Server size={18} />}
          title="Send today over HTTPS"
          badge={<StatusPill status="active" label="REST API · live" />}
          description="Any language that can make an HTTPS request can send through Calder."
          actions={
            <>
              <Link
                href="/sdks"
                className="ds-btn ds-btn-secondary"
                style={{ textDecoration: "none" }}
              >
                <Code2 size={14} />
                <span>HTTP quickstarts</span>
              </Link>
              <Link
                href="/keys"
                className="ds-btn ds-btn-primary"
                style={{ textDecoration: "none" }}
              >
                <KeyRound size={14} />
                <span>Create API key</span>
              </Link>
            </>
          }
        />
        <DsBanner
          tone="info"
          title="POST /v1/emails"
          description="Issue a scoped API key, then send JSON to the API. Test keys deliver through the mock provider and are never metered."
        />
        <p style={{ marginTop: 14 }}>
          <Link
            href="/sdks"
            className="ds-btn ds-btn-secondary ds-btn-sm"
            style={{ textDecoration: "none" }}
          >
            <span>View copy-ready snippets</span>
            <ArrowRight size={13} />
          </Link>
        </p>
      </div>
    </div>
  );
}
