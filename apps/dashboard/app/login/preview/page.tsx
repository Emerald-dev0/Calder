import { Globe, KeyRound, Webhook, ShieldBan, Settings } from "lucide-react";
import { AppShell } from "../../../components/app-shell";
import { OverviewView } from "../../(app)/overview-view";
import type { SeriesPoint } from "../../../lib/overview-series";

function makeSeries(n: number, labelFn: (i: number) => string): SeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    key: String(i),
    label: labelFn(i),
    delivered: Math.round(40 + 60 * Math.abs(Math.sin(i / 2.3)) + (i % 5) * 9),
    failed: i % 4 === 0 ? 3 : i % 7 === 0 ? 5 : 0,
  }));
}

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PreviewPage() {
  const now = Date.now();
  return (
    <AppShell
      user={{ userId: "u1", email: "preview@calder.test", name: "Amara Okafor" }}
      memberships={[
        {
          organization: { id: "o1", name: "Northwind Labs", slug: "northwind" },
          role: "owner",
          projects: [{ id: "p1", name: "Production", slug: "production", environment: "production" }],
        },
      ]}
      showAdmin
      usageSummary={{
        sentThisMonth: 1840,
        monthlyQuota: 5000,
        planName: "Free",
        verifiedDomains: 0,
        activeKeys: 1,
      }}
    >
      <OverviewView
        greeting="Good evening, Amara"
        subtitle="Northwind Labs · 1 project"
        secondaryAction={{
          href: "/domains",
          label: "Add domain",
          icon: <Globe size={14} />,
        }}
        setupSteps={[
          {
            id: "domain",
            title: "Verify a sending domain",
            description: "Add the DNS records so mail is signed as you and lands in the inbox.",
            done: false,
            href: "/domains",
            cta: "Add domain",
          },
          {
            id: "key",
            title: "Create an API key",
            description: "Scoped keys for your servers.",
            done: true,
            href: "/api-keys",
            cta: "Create key",
          },
          {
            id: "send",
            title: "Send your first email",
            description: "Use the composer or the API.",
            done: false,
            href: "/emails/new",
            cta: "Send email",
          },
          {
            id: "webhook",
            title: "Add a webhook",
            description: "Get delivery events in your app.",
            done: false,
            optional: true,
            href: "/webhooks",
            cta: "Add webhook",
          },
        ]}
        month={{ total: 1840, delivered: 1791, failed: 49, deliveryRate: 97.3, failureRate: 2.7 }}
        pending={3}
        series={{
          "24h": makeSeries(24, (i) => `${i}:00`),
          "7d": makeSeries(7, (i) => days[i]),
          "30d": makeSeries(30, (i) => `${i + 1}`),
        }}
        recent={[
          { id: "1", to: "jonas@acme.io", subject: "Your receipt from Northwind", status: "delivered", createdAt: new Date(now - 120000) },
          { id: "2", to: "mia@studio.dev", subject: "Reset your password", status: "sent", createdAt: new Date(now - 900000) },
          { id: "3", to: "ops@bounced-domain.com", subject: "Weekly digest", status: "bounced", createdAt: new Date(now - 3600000) },
          { id: "4", to: "li@example.org", subject: "Welcome to Northwind", status: "queued", createdAt: new Date(now - 7200000) },
        ]}
        usage={{ planName: "Free", used: 1840, quota: 5000, percent: 36.8, resetsOn: "Nov 1" }}
        setupRows={[
          { label: "Sending domain", icon: <Globe size={15} />, value: "Not verified", tone: "warning", href: "/domains" },
          { label: "API keys", icon: <KeyRound size={15} />, value: "1 active", tone: "success", href: "/api-keys" },
          { label: "Webhooks", icon: <Webhook size={15} />, value: "None", tone: "neutral", href: "/webhooks" },
          { label: "Suppressions", icon: <ShieldBan size={15} />, value: "2 addresses", tone: "neutral", href: "/suppressions" },
        ]}
        pricingHref="https://calder.click/pricing"
      />
      <span hidden>
        <Settings />
      </span>
    </AppShell>
  );
}
