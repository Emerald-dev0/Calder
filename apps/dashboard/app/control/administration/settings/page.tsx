import { getConfig } from "@calder/config";
import { requireSection } from "@/lib/control/guard";
import { Badge, KV, PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/** Non-secret platform settings, read from the validated env config. */
export default async function SettingsPage() {
  await requireSection("administration");
  const config = getConfig();

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        subtitle="Platform configuration as it actually is. Secrets are never rendered — presence is shown, values never leave the server."
      />

      <Panel title="Environment" caption="from the central validated config (packages/config)">
        <KV k="NODE_ENV" v={config.NODE_ENV} mono />
        <KV k="App URL" v={config.APP_URL} mono />
        <KV k="Dashboard URL" v={config.DASHBOARD_URL} mono />
        <KV k="API URL" v={config.API_URL} mono />
        <KV k="Redis" v={process.env.REDIS_URL ? "configured" : "default (localhost)"} mono />
        <KV
          k="AWS / SES"
          v={
            config.AWS_ACCESS_KEY_ID
              ? `region ${config.AWS_REGION}`
              : "not configured (mock in dev)"
          }
          mono
        />
        <KV
          k="Billing (Bachs)"
          v={config.BACHS_API_KEY ? "configured" : "not integrated yet"}
          mono
        />
        <KV
          k="Admin API key"
          v={
            config.ADMIN_API_KEY ? (
              <Badge tone="ok">configured</Badge>
            ) : (
              <Badge tone="warn">unset — /v1/admin disabled</Badge>
            )
          }
          mono
        />
        <KV
          k="Founder bootstrap"
          v={
            config.FOUNDER_EMAILS ? (
              `${config.FOUNDER_EMAILS.split(",").length} email(s) on the list`
            ) : (
              <Badge tone="warn">unset</Badge>
            )
          }
          mono
        />
        <KV
          k="Secret envelope (webhook + transport secrets)"
          v={
            config.AUTH_SECRET.length >= 32 ? (
              <Badge tone="ok">AES-256-GCM via AUTH_SECRET (32+ char)</Badge>
            ) : (
              <Badge tone="warn">AUTH_SECRET too short — encryption will throw at write</Badge>
            )
          }
          mono
        />
        <KV
          k="Cron authentication"
          v={
            process.env.CRON_SECRET ? (
              <Badge tone="ok">CRON_SECRET set (mandatory in prod, ADR-040)</Badge>
            ) : config.NODE_ENV === "production" ? (
              <Badge tone="warn">unset — /v1/cron/* rejects everything in prod now</Badge>
            ) : (
              "unset (dev fallback: bare x-vercel-cron accepted locally only)"
            )
          }
          mono
        />
        <KV
          k="Rate limiter backend"
          v={
            process.env.REDIS_URL ? (
              <Badge tone="ok">Redis fixed-window — exact across instances (ADR-041)</Badge>
            ) : config.NODE_ENV === "production" ? (
              <Badge tone="warn">
                no REDIS_URL — per-instance approximation, boot warning emitted
              </Badge>
            ) : (
              "in-memory (dev single instance)"
            )
          }
          mono
        />
        <KV
          k="OTP storage"
          v="v2 peppered HMAC, purpose+email bound (dual-accept window post-deploy, ADR-040)"
          mono
        />
      </Panel>

      <Panel title="Planned: runtime settings" caption="mutable platform configuration with audit">
        <Planned
          title="Settings editor"
          bullets={[
            "Global sending limits and provider routing weights",
            "Default Gmail daily cap",
            "Maintenance windows and banners",
            "Every change requires recent re-authentication and is audit-logged",
          ]}
        >
          Runtime-mutable settings land with the maintenance controls — configuration that can
          change without a deploy, safely.
        </Planned>
      </Panel>
    </>
  );
}
