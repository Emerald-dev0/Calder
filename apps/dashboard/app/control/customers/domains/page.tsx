import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { domainOverview, type DomainStatusFilter } from "@/lib/control/queries";
import { READ_ONLY_ROLES } from "@/lib/control/roles";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";
import { reverifyDomain } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: DomainStatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "expired", label: "Expired" },
];

function isFilter(value: string | undefined): value is DomainStatusFilter {
  return FILTERS.some((f) => f.key === value);
}

/** What the DNS re-check actually returned, in the operator's words. */
function verifyNotice(
  code: string | undefined,
  wait: string | undefined
): { tone: "ok" | "warn" | "bad"; text: string } | null {
  switch (code) {
    case "verified":
      return {
        tone: "ok",
        text: "Ownership verified. The TXT record matches the challenge, and sending from this domain is unblocked.",
      };
    case "mismatch":
      return {
        tone: "bad",
        text: "The TXT record exists but does not match the challenge value. The customer's DNS is right in the wrong way — give them the exact expected value.",
      };
    case "dns_error":
      return {
        tone: "bad",
        text: "The DNS lookup failed. That is a resolver problem or a missing record, not a wrong one; nothing was verified.",
      };
    case "expired":
      return {
        tone: "warn",
        text: "The challenge expired before verification completed. The customer has to mint a fresh token from their own dashboard.",
      };
    case "rate_limited":
      return {
        tone: "warn",
        text: `Attempt limit reached for this domain. Try again in ${
          wait ? Number(wait) : 0
        } seconds — the budget is shared with the customer's own clicks.`,
      };
    case "cross_tenant":
      return {
        tone: "bad",
        text: "That domain is verified by a different organization. Check for a duplicate claim before touching anything.",
      };
    case "not_found":
    case "missing":
      return { tone: "bad", text: "That domain no longer exists, so nothing was checked." };
    case "forbidden":
      return { tone: "bad", text: "Read-only role: analysts cannot change verification state." };
    default:
      return null;
  }
}

/**
 * Domain truth, in one place.
 *
 * The platform page used to answer "how many domains are verified?" with a
 * count, and nothing anywhere told an operator *which* domains those were or
 * where they pointed. That is the first question in every deliverability
 * conversation ("is example.com set up yet?"), so it gets its own page: the
 * name, the URL, the workspace it belongs to, and the two states that decide
 * whether mail from it will land — ownership verification and DKIM.
 */
export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; verify?: string; wait?: string }>;
}) {
  const ctx = await requireSection("customers");
  const readOnly = (READ_ONLY_ROLES as string[]).includes(ctx.role);
  const params = await searchParams;
  const notice = verifyNotice(params.verify, params.wait);
  const filter: DomainStatusFilter = isFilter(params.status) ? params.status : "all";
  const search = (params.q ?? "").slice(0, 120);
  const { counts, rows } = await domainOverview(filter, search);

  const verifiedShare =
    counts.total === 0 ? null : Math.round((counts.verified / counts.total) * 100);

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Domains"
        subtitle="Every sending domain in the estate: the name, the public URL, the workspace that owns it, and whether verification and DKIM are actually in place. “Check now” re-reads DNS through the same path the customer's own verify button uses — and shares its attempt budget."
      />

      {notice ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Badge tone={notice.tone}>{params.verify}</Badge>
            <p style={{ margin: 0, fontSize: 13.5 }}>{notice.text}</p>
          </div>
        </div>
      ) : null}

      <div className="cp-stats">
        <Stat
          label="Verified"
          value={fmtInt(counts.verified)}
          hint={
            verifiedShare === null
              ? "no domains yet"
              : `${verifiedShare}% of ${fmtInt(counts.total)} domains`
          }
        />
        <Stat label="Pending" value={fmtInt(counts.pending)} hint="ownership proof not seen yet" />
        <Stat label="Failed" value={fmtInt(counts.failed)} hint="verification refused" />
        <Stat label="Expired" value={fmtInt(counts.expired)} hint="challenge window closed" />
      </div>

      <Panel
        title="All domains"
        caption={`${fmtInt(rows.length)} shown · newest first · counts above cover every domain`}
        action={
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
            <input
              className="ds-input"
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search domain"
              style={{ width: 200 }}
              aria-label="Search domains"
            />
            <button className="ds-btn ds-btn-secondary ds-btn-sm" type="submit">
              Search
            </button>
          </form>
        }
        flush
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            flexWrap: "wrap",
          }}
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            const href = `/control/customers/domains?${new URLSearchParams({
              ...(f.key === "all" ? {} : { status: f.key }),
              ...(search ? { q: search } : {}),
            }).toString()}`;
            return (
              <Link
                key={f.key}
                href={href}
                className={`ds-pill ${active ? "ds-pill-info" : ""}`.trim()}
                style={{ textDecoration: "none" }}
                aria-current={active ? "page" : undefined}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <Empty title={search || filter !== "all" ? "No domains match" : "No domains yet"}>
            {search || filter !== "all"
              ? "Clear the filter or search term to see the rest of the estate."
              : "Domains appear here when a customer adds one to a project."}
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>DKIM</th>
                  <th>Workspace</th>
                  <th>Verified</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={r.url} target="_blank" rel="noreferrer noopener">
                        {r.domain}
                      </a>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--cp-faint)", marginTop: 2 }}
                      >
                        {r.url}
                      </div>
                      {r.lastVerifyError ? (
                        <div
                          title={r.lastVerifyError}
                          style={{
                            fontSize: 11.5,
                            color: "var(--color-danger)",
                            marginTop: 3,
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.lastVerifyError}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.status === "verified" ? (
                        <Badge tone="ok">verified</Badge>
                      ) : r.status === "failed" ? (
                        <Badge tone="bad">failed</Badge>
                      ) : (
                        <Badge tone="warn">{r.status}</Badge>
                      )}
                    </td>
                    <td>
                      {r.dkimStatus ? (
                        // SES reports SUCCESS / PENDING / FAILED / NOT_STARTED in
                        // upper case; older rows carry lower case. Compare folded,
                        // and show the stored value so nobody has to guess.
                        <Badge
                          tone={
                            ["success", "verified"].includes(r.dkimStatus.toLowerCase())
                              ? "ok"
                              : "warn"
                          }
                        >
                          {r.dkimStatus.toLowerCase()}
                        </Badge>
                      ) : (
                        <span className="mono" style={{ fontSize: 12, color: "var(--cp-faint)" }}>
                          not configured
                        </span>
                      )}
                      {r.dkimRecordCount > 0 ? (
                        <div className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                          {r.dkimRecordCount} record{r.dkimRecordCount === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organizationId}`}>
                        {r.organizationName}
                      </Link>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--cp-faint)" }}>
                        {r.projectName} · {r.projectSlug}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {r.verifiedAt ? fmtAgo(new Date(r.verifiedAt)) : "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(r.createdAt))}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {readOnly ? (
                        <span style={{ fontSize: 12, color: "var(--cp-faint)" }}>read only</span>
                      ) : (
                        <form action={reverifyDomain}>
                          <input type="hidden" name="domainId" value={r.id} />
                          <input type="hidden" name="projectId" value={r.projectId} />
                          <button
                            className="ds-btn ds-btn-secondary ds-btn-sm"
                            type="submit"
                            title="Re-check DNS ownership now. Does not email the customer."
                          >
                            {r.status === "verified" ? "Re-check" : "Check now"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
