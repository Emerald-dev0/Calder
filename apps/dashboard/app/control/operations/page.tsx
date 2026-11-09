import { getConfig } from "@calder/config";
import { Badge, PageHeader, Panel, Planned } from "@/control/_components/ui";
import { requireSection } from "@/lib/control/guard";

export const dynamic = "force-dynamic";

/**
 * Feature flags / capability registry with its honest rollout state.
 * Config-derived where a real toggle exists; otherwise stated from how the
 * surface actually ships today. A flag that lies is worse than no flag.
 */
export default async function FeatureFlagsPage() {
  await requireSection("operations");
  const config = getConfig();
  const flags: Array<{
    name: string;
    state: "on" | "off" | "rollout" | "internal";
    note: string;
  }> = [
    {
      name: "Gmail Transport",
      state: "on",
      note: "OAuth quickstart, capped daily, graduates to domains",
    },
    { name: "SMTP Gateway", state: "on", note: "Same pipeline, project-scoped credentials" },
    {
      name: "Inbound Email",
      state: "off",
      note: "Specified post-MVP (user → Calder → app webhook)",
    },
    {
      name: "Marketing (product flag)",
      state: config.FEATURE_MARKETING ? "rollout" : "off",
      note: config.FEATURE_MARKETING
        ? "FEATURE_MARKETING enabled in config"
        : "FEATURE_MARKETING off; campaign engine remains post-MVP",
    },
    { name: "Marketing Automations", state: "off", note: "Lands after campaigns" },
    {
      name: "Advanced Analytics",
      state: "rollout",
      note: "Plan-gated (Pro+) in the customer dashboard",
    },
    { name: "OTP Infrastructure", state: "off", note: "MVP vs post-MVP still undecided (PRD §9)" },
    {
      name: "Broadcasts (internal)",
      state: config.ADMIN_API_KEY ? "internal" : "off",
      note: config.ADMIN_API_KEY
        ? "/v1/admin/waitlist/broadcast, admin-key gated"
        : "ADMIN_API_KEY unset; internal broadcast routes disabled",
    },
  ];

  const tone = { on: "ok", off: "bad", rollout: "warn", internal: "info" } as const;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Capabilities"
        subtitle="Honest rollout state from config and shipped behavior. This is not a runtime flag service; mutating runtime controls are intentionally not exposed until they are real, audited, and safe."
      />

      <Panel
        title="Capability registry"
        caption="Honest state from config and shipped behavior"
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
              {flags.map((f) => (
                <tr key={f.name}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td>
                    <Badge tone={tone[f.state]}>
                      {f.state === "on"
                        ? "ON"
                        : f.state === "off"
                          ? "OFF"
                          : f.state === "rollout"
                            ? "CONFIG/PLAN"
                            : "INTERNAL"}
                    </Badge>
                  </td>
                  <td style={{ color: "var(--cp-muted)" }}>{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Runtime flag service"
        caption="Not implemented; current gating is config + code"
      >
        <Planned
          title="Flag engine"
          bullets={[
            "Target by user, organization, plan, percentage, internal-only",
            "Kill switches wired into the sending path",
            "Audit trail: who changed what, when, and why",
          ]}
        >
          Capability gating lives in config and plan checks today. A runtime flag service is
          warranted when rollouts must be reversed in seconds without a deploy.
        </Planned>
      </Panel>
    </>
  );
}
