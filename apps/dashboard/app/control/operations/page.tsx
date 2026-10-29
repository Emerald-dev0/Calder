import { Badge, PageHeader, Panel, Planned } from "@/control/_components/ui";
import { requireSection } from "@/lib/control/guard";

export const dynamic = "force-dynamic";

/**
 * Feature flags: the capability registry with its honest rollout state.
 * Values are stated from how each surface actually ships today — a flag
 * that lies is worse than no flag.
 */
const FLAGS: Array<{ name: string; state: "on" | "off" | "rollout" | "internal"; note: string }> = [
  {
    name: "Gmail Transport",
    state: "internal",
    note: "Adapter implemented; production OAuth setup and live send not verified",
  },
  {
    name: "SMTP Gateway",
    state: "off",
    note: "Specification only; no gateway implementation in this checkout",
  },
  { name: "Inbound Email", state: "off", note: "specified post-MVP (user → Calder → app webhook)" },
  {
    name: "Marketing Campaigns",
    state: "off",
    note: "campaign engine is post-MVP; Gmail excluded by rule",
  },
  { name: "Marketing Automations", state: "off", note: "lands after campaigns" },
  {
    name: "Advanced Analytics",
    state: "rollout",
    note: "Existing reporting surfaces; full instrumentation and hosted verification pending",
  },
  { name: "OTP Infrastructure", state: "off", note: "MVP vs post-MVP still undecided (PRD §9)" },
  {
    name: "Broadcasts (internal)",
    state: "on",
    note: "/v1/admin/waitlist/broadcast, admin-key gated",
  },
];

const TONE = { on: "ok", off: "bad", rollout: "warn", internal: "info" } as const;

export default async function FeatureFlagsPage() {
  await requireSection("operations");
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Feature Flags"
        subtitle="Implementation inventory, not runtime controls or proof of production availability. No switches on this page change platform behavior."
      />

      <Panel
        title="Capability registry"
        caption="Code/configuration inventory · not a deployment health check"
        flush
      >
        <div style={{ overflowX: "auto" }}>
          <table className="cp-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>State</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {FLAGS.map((f) => (
                <tr key={f.name}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td>
                    <Badge tone={TONE[f.state]}>
                      {f.state === "on"
                        ? "ON"
                        : f.state === "off"
                          ? "OFF"
                          : f.state === "rollout"
                            ? "PARTIAL"
                            : "UNVERIFIED"}
                    </Badge>
                  </td>
                  <td style={{ color: "var(--cp-muted)" }}>{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Planned: flag service" caption="runtime targeting without deploys">
        <Planned
          title="Flag engine"
          bullets={[
            "Target by user, organization, plan, percentage, internal-only",
            "Kill switches wired into the sending path",
            "Audit trail: who changed what, when, and why",
          ]}
        >
          Today capability gating lives in code and plan checks. A runtime flag service earns its
          place the first time a rollout needs to be reversed in seconds, not minutes.
        </Planned>
      </Panel>
    </>
  );
}
