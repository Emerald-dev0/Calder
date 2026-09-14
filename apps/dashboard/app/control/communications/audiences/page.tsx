import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { systemAudiences } from "@/lib/control/queries";
import { PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AudiencesPage() {
  await requireSection("communications");
  const audiences = await systemAudiences();

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Audiences"
        subtitle="System-generated audiences, computed live from platform state. When you send, these are the address books — no stale exports, no made-up counts."
      />

      <Panel title="Internal audiences" caption={`${audiences.length} audiences · live counts`} flush>
        <div style={{ overflowX: "auto" }}>
          <table className="cp-table">
            <thead>
              <tr>
                <th>Audience</th>
                <th>Definition</th>
                <th>People</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {audiences.map((a) => (
                <tr key={a.key}>
                  <td style={{ fontWeight: 600 }}>{a.label}</td>
                  <td style={{ color: "var(--cp-muted)" }}>{a.description}</td>
                  <td className="cp-num">{fmtInt(a.count)}</td>
                  <td>
                    <Link href={a.href}>open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Planned: customer-facing audiences" caption="the marketing surface customers get, not the Control Plane">
        <div className="cp-planned">
          <b>Custom segments &amp; dynamic filters</b>
          <p>
            Customers get their own audience builder (country = Nigeria AND plan = Pro AND last active &lt; 30 days).
            Internal audiences stay system-generated so operator mail can never silently widen. Custom internal segments
            arrive with the campaign engine.
          </p>
        </div>
      </Panel>
    </>
  );
}
