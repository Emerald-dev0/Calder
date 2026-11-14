import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { activationFunnel } from "@/lib/control/growth-funnel";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/** Hours → the shortest honest phrasing a human reads without arithmetic. */
function duration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 36) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export default async function ActivationPage() {
  await requireSection("growth");
  const funnel = await activationFunnel();
  const { cohort, stages } = funnel;
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const activated = byKey.get("first_send")?.orgs ?? 0;
  const stillSending = byKey.get("active_7d")?.orgs ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Activation"
        subtitle={`Of the accounts created in the last ${funnel.windowDays} days, how far each one actually got: project, key, first email, and whether it is still sending.`}
      />

      <div className="cp-stats">
        <Stat
          label="Signed up"
          value={fmtInt(cohort)}
          hint={`organizations created since ${funnel.since.toISOString().slice(0, 10)}`}
        />
        <Stat
          label="Sent an email"
          value={fmtInt(activated)}
          hint={
            cohort === 0
              ? "no cohort yet"
              : `${fmtPct((activated / cohort) * 100, 0)} of this cohort`
          }
        />
        <Stat
          label="Still sending"
          value={fmtInt(stillSending)}
          hint="a send the provider took, last 7 days"
        />
        <Stat
          label="Median time to first send"
          value={duration(funnel.medianHoursToFirstSend)}
          hint={activated === 0 ? "nobody has sent yet" : "signup → first send"}
        />
      </div>

      <Panel
        title="The funnel"
        caption="a fixed cohort; every stage is measured as of this page load"
        flush
      >
        {cohort === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty title="No accounts in this window yet">
              A cohort appears here as soon as an organization is created. Nothing is inferred from
              the waitlist: a signup counts when the account exists.
            </Empty>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="cp-num">Accounts</th>
                  <th className="cp-num">Of cohort</th>
                  <th className="cp-num">Lost at this step</th>
                  <th>Requires</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage, index) => {
                  const previous = index === 0 ? stage.orgs : (stages[index - 1]?.orgs ?? 0);
                  const lost = Math.max(0, previous - stage.orgs);
                  return (
                    <tr key={stage.key}>
                      <td>
                        <b>{stage.label}</b>
                      </td>
                      <td className="cp-num">{fmtInt(stage.orgs)}</td>
                      <td className="cp-num">{fmtPct((stage.orgs / cohort) * 100, 0)}</td>
                      <td className="cp-num">
                        {index === 0 ? (
                          <span style={{ color: "var(--cp-muted)" }}>—</span>
                        ) : lost > 0 ? (
                          <span style={{ color: "var(--color-warning)" }}>−{fmtInt(lost)}</span>
                        ) : (
                          <span style={{ color: "var(--cp-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>{stage.requires}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Newest accounts and where each one stopped"
        caption={`last ${funnel.recent.length} of this cohort, newest first`}
        flush
      >
        {funnel.recent.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty title="Nothing to show yet" />
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Signed up</th>
                  <th className="cp-num">Projects</th>
                  <th className="cp-num">Live keys</th>
                  <th>First send</th>
                  <th>Last send</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {funnel.recent.map((row) => {
                  const stage =
                    row.firstSendAt && row.lastSendAt
                      ? "sending"
                      : row.activeKeys > 0
                        ? "key"
                        : row.projects > 0
                          ? "project"
                          : "signup";
                  return (
                    <tr key={row.organizationId}>
                      <td>
                        <Link
                          href={`/control/customers/organizations/${row.organizationId}`}
                          style={{ color: "inherit" }}
                        >
                          <b>{row.name}</b>
                        </Link>{" "}
                        <span className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                          {row.slug}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5 }}>{row.createdAt.toISOString().slice(0, 10)}</td>
                      <td className="cp-num">{fmtInt(row.projects)}</td>
                      <td className="cp-num">{fmtInt(row.activeKeys)}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {row.firstSendAt
                          ? row.firstSendAt.toISOString().slice(0, 16).replace("T", " ")
                          : "—"}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {row.lastSendAt
                          ? row.lastSendAt.toISOString().slice(0, 16).replace("T", " ")
                          : "—"}
                      </td>
                      <td>
                        {stage === "sending" ? (
                          <Badge tone={row.sentLive ? "ok" : "warn"}>
                            {row.sentLive ? "sending live" : "sending (test)"}
                          </Badge>
                        ) : stage === "key" ? (
                          <Badge tone="warn">has a key, never sent</Badge>
                        ) : stage === "project" ? (
                          <Badge tone="bad">project only</Badge>
                        ) : (
                          <Badge tone="bad">signed up only</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="cp-grid cp-grid-2">
        <Panel title="What this measures" caption="the units, plainly">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>
              The unit is the <b>organization</b> — one signup creates one. A human with two
              accounts counts twice; a team of five counts once.
            </li>
            <li>
              Test-mode mail counts. The question is whether an account got an email out of the
              product at all; the last column says whether any of it was live. &ldquo;Sent&rdquo;
              means a provider took the message — a bounce counts, a queued row does not.
            </li>
            <li>
              The cohort never changes. Accounts created in this window stay in the denominator
              after they go quiet, which is why &ldquo;still sending&rdquo; can only fall.
            </li>
            <li>
              The steps are not a staircase. A send from the dashboard needs no API key, so an
              account can appear at &ldquo;sent an email&rdquo; without appearing at &ldquo;created
              a key&rdquo; — the drop-off column shows a dash rather than inventing a loss there.
            </li>
          </ul>
        </Panel>

        <Panel title="What this does not measure" caption="so nobody reads it as more than it is">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>
              <b>Visitors → signup.</b> That is the website funnel on{" "}
              <Link href="/control/growth">the growth overview</Link>; the two are not joined by a
              person-level id, so no cohort here follows someone from a landing page.
            </li>
            <li>
              <b>Why</b> an account stopped. Agents, support threads and onboarding replays live on
              the organization page — this page only reports where the stop happened.
            </li>
            <li>
              <b>Revenue.</b> Nothing here is a payment. Money lives in{" "}
              <Link href="/control/billing">billing</Link> and stays closed while paid plans are
              frozen.
            </li>
            <li>
              Seed and test organizations created by the suites are real rows and will appear. Read
              the shape, not the absolute count.
            </li>
          </ul>
        </Panel>
      </div>

      <p className="cp-caption">
        Read as one snapshot: every count above comes from a single repeatable-read transaction, so
        the stages cannot disagree with each other or with the cohort they are drawn from.
      </p>
    </>
  );
}
