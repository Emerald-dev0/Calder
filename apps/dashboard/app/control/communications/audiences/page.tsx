import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { systemAudiences } from "@/lib/control/queries";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AudiencesPage() {
  await requireSection("communications");
  const audiences = await systemAudiences();

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Audiences"
        subtitle="System-generated audiences computed live from platform state. Custom campaign segments remain gated."
      />

      <Panel
        title="Internal audiences"
        caption={`${audiences.length} audiences · live counts`}
        flush
      >
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

      <Panel title="Gated capability" caption="Custom segments">
        <Planned
          state="gated"
          title="Custom segments"
          bullets={[
            "Consent-aware filters and audience snapshots",
            "No operator-created segments until campaign consent/suppression engine exists",
          ]}
        >
          Operator broadcasts currently use defined internal/system paths with existing safeguards.
        </Planned>
      </Panel>
    </>
  );
}
