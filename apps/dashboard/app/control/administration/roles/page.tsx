import { requireSection } from "@/lib/control/guard";
import { ALL_SECTIONS, CONTROL_ROLE_LABEL, FOUNDER_ONLY_ACTIONS, READ_ONLY_ROLES, ROLE_SECTIONS } from "@/lib/control/roles";
import { Badge, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const SECTION_LABEL: Record<string, string> = {
  overview: "Overview",
  growth: "Growth",
  customers: "Customers",
  communications: "Communications",
  billing: "Billing",
  platform: "Platform",
  infrastructure: "Infrastructure",
  observability: "Observability",
  security: "Security",
  operations: "Operations",
  administration: "Administration",
};

const ROLES = ["founder", "platform_admin", "support", "billing", "infrastructure", "security", "analyst"] as const;

export default async function RolesPage() {
  await requireSection("administration");
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Roles"
        subtitle="One hierarchy, enforced in code and rendered from the same source. The sidebar you see is exactly the surface you may touch."
      />

      <Panel title="Permission matrix" caption="section visibility per platform role" flush>
        <div style={{ overflowX: "auto" }}>
          <table className="cp-table">
            <thead>
              <tr>
                <th>Section</th>
                {ROLES.map((r) => (
                  <th key={r} style={{ textAlign: "center" }}>
                    {CONTROL_ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_SECTIONS.map((section) => (
                <tr key={section}>
                  <td style={{ fontWeight: 600 }}>{SECTION_LABEL[section]}</td>
                  {ROLES.map((r) => (
                    <td key={r} style={{ textAlign: "center" }}>
                      {ROLE_SECTIONS[r].includes(section) ? (
                        <span style={{ color: "var(--cp-ok)" }}>●</span>
                      ) : (
                        <span style={{ color: "var(--cp-faint)" }}>·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Founder-only actions" caption="cannot be delegated, by code and by policy">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--cp-muted)", lineHeight: 1.9 }}>
          {FOUNDER_ONLY_ACTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="cp-panel-caption" style={{ marginTop: 10 }}>
          <Badge tone="ok">Founder</Badge> = every admin permission + platform ownership + the dangerous actions +
          business controls. Nobody promotes themselves into it, and it cannot be revoked through the product.
        </p>
      </Panel>

      <Panel title="Read-only roles" caption="observe, never modify">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          {READ_ONLY_ROLES.map((r) => CONTROL_ROLE_LABEL[r]).join(" and ")} see the same live numbers as operators but
          every mutating server action rejects them — enforcement lives in the actions, not the interface.
        </p>
      </Panel>
    </>
  );
}
