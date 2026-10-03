"use client";

import * as React from "react";
import {
  Palette,
  Send,
  KeyRound,
  Globe,
  Sparkles,
  Trash2,
  Bell,
  PanelRightOpen,
  Layers,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import {
  DsPageHeader,
  DsButton,
  DsInput,
  DsSelect,
  DsTextarea,
  DsSwitch,
  DsCheckbox,
  DsRadioCards,
  StatusPill,
  CopyField,
  CodeBlock,
  DsBanner,
  StatCard,
  KeyValueList,
  DsEmptyState,
  DsSkeleton,
  Avatar,
  Kbd,
  ThemeToggle,
  useToast,
  DsDialog,
  ConfirmDialog,
  DsDrawer,
  DataTable,
  RelativeTime,
  CopyableMono,
} from "../../../../components/design-system";

const SAMPLE_ROWS = [
  {
    id: "msg_01j8x9a2b4c6d8e0f2",
    recipient: "ada@analytical.dev",
    subject: "Production DKIM verification complete",
    status: "delivered" as const,
    latencyMs: 184,
    createdAt: "2026-10-02T10:15:00.000Z",
  },
  {
    id: "msg_01j8x8y7z6w5v4u3t2",
    recipient: "ops@acme-payments.io",
    subject: "Webhook endpoint signature rotation",
    status: "queued" as const,
    latencyMs: 42,
    createdAt: "2026-10-02T09:30:00.000Z",
  },
  {
    id: "msg_01j8x7p0q9r8s7t6u5",
    recipient: "bounced-user@invalid-mx.example",
    subject: "Invoice #INV-2094 receipt",
    status: "bounced" as const,
    latencyMs: 612,
    createdAt: "2026-10-02T04:00:00.000Z",
  },
];

export default function DesignSystemShowcasePage() {
  const { toast } = useToast();
  const [switchOn, setSwitchOn] = React.useState(true);
  const [checked, setChecked] = React.useState(true);
  const [radioVal, setRadioVal] = React.useState("production");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const colorSwatches = [
    { name: "--color-bg", label: "Canvas Background" },
    { name: "--color-surface", label: "Primary Surface" },
    { name: "--color-surface-elevated", label: "Elevated Surface" },
    { name: "--color-ink", label: "Primary Ink" },
    { name: "--color-muted", label: "Secondary Muted" },
    { name: "--color-accent", label: "Brand Accent" },
    { name: "--color-success", label: "Semantic Success" },
    { name: "--color-warning", label: "Semantic Warning" },
    { name: "--color-danger", label: "Semantic Danger" },
    { name: "--color-info", label: "Semantic Info" },
  ];

  return (
    <div>
      <DsPageHeader
        icon={<Palette size={18} />}
        title="Living Design System"
        description="Single-source tokens, typography, status semantics, and interactive primitives powering the Calder dashboard in Light and Dark modes."
        badge={<StatusPill status="verified" label="v2.0 Tokens" />}
        actions={
          <>
            <ThemeToggle />
            <DsButton
              variant="secondary"
              icon={<Bell size={14} />}
              onClick={() =>
                toast({
                  title: "Webhook test dispatched",
                  description: "Delivered 200 OK in 118ms with HMAC-SHA256 signature.",
                  tone: "success",
                })
              }
            >
              Trigger Toast
            </DsButton>
          </>
        }
      />

      {/* Section 1: Color Tokens */}
      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">1. Color & Surface Tokens</h2>
            <p className="ds-card-subtitle">
              CSS custom properties adapt automatically between Warm Paper (Light) and Carbon Obsidian (Dark).
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {colorSwatches.map((s) => (
              <div
                key={s.name}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  background: "var(--color-surface)",
                }}
              >
                <div
                  style={{
                    height: 52,
                    background: `var(${s.name})`,
                    borderBottom: "1px solid var(--color-border)",
                  }}
                />
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    {s.name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 2: Buttons, Badges & Status Pills */}
      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">2. Buttons & Semantic Status Pills</h2>
            <p className="ds-card-subtitle">
              Every status indicator pairs an icon with a label—never relying on color alone.
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <DsButton variant="primary" icon={<Send size={14} />}>
              Primary Action
            </DsButton>
            <DsButton variant="secondary" icon={<KeyRound size={14} />}>
              Secondary
            </DsButton>
            <DsButton variant="ghost" icon={<Globe size={14} />}>
              Ghost Button
            </DsButton>
            <DsButton variant="danger" icon={<Trash2 size={14} />}>
              Revoke Key
            </DsButton>
            <DsButton variant="primary" loading>
              Provisioning…
            </DsButton>
            <DsButton variant="secondary" disabled>
              Disabled State
            </DsButton>
            <DsButton variant="secondary" size="sm">
              Small (30px)
            </DsButton>
            <DsButton variant="primary" size="lg" icon={<Sparkles size={15} />}>
              Large Action (40px)
            </DsButton>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              paddingTop: 12,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <StatusPill status="delivered" />
            <StatusPill status="verified" />
            <StatusPill status="active" />
            <StatusPill status="queued" />
            <StatusPill status="pending" />
            <StatusPill status="bounced" />
            <StatusPill status="complained" />
            <StatusPill status="failed" />
            <StatusPill status="revoked" />
            <StatusPill status="test" label="Test Mode" />
            <StatusPill status="pro" label="PRO Feature" />
          </div>
        </div>
      </section>

      {/* Section 3: Form Controls & Copy Fields */}
      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">3. Form Controls, Copy Fields & Code Blocks</h2>
            <p className="ds-card-subtitle">
              Accessible inputs with explicit labels, descriptions, error states, and one-click clipboard actions.
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <div className="ds-grid-2" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <DsInput
                label="Sending Domain"
                description="Use a subdomain dedicated to transactional traffic."
                placeholder="mail.acme.dev"
                defaultValue="notify.analytical.dev"
              />
              <DsInput
                label="Invalid Input Example"
                defaultValue="not-a-valid-domain"
                error="Domain must be a valid FQDN without protocol prefix."
              />
              <DsSelect label="Delivery Region" description="Primary AWS SES ingestion endpoint">
                <option value="eu-west-1">eu-west-1 (Ireland)</option>
                <option value="us-east-1">us-east-1 (N. Virginia)</option>
              </DsSelect>
              <DsTextarea
                label="Webhook Description"
                placeholder="Describe what events this endpoint processes…"
                defaultValue="Primary billing & receipt event receiver"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <CopyField
                label="Scoped API Key"
                value="cal_live_98f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0"
                secret
              />
              <CopyField
                label="DKIM CNAME Record"
                value="calder1._domainkey.analytical.dev.dkim.calder.build"
              />
              <div
                style={{
                  padding: 14,
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface-elevated)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <DsSwitch
                  checked={switchOn}
                  onChange={setSwitchOn}
                  label="Enforce TLS 1.3 Opportunistic Encryption"
                  description="Reject outbound SMTP hops that fail STARTTLS negotiation."
                />
                <DsCheckbox
                  checked={checked}
                  onChange={setChecked}
                  label="Automatically suppress hard bounces"
                  description="Prevent repeated sends to addresses returning 550 5.1.1."
                />
              </div>
              <DsRadioCards
                value={radioVal}
                onChange={setRadioVal}
                options={[
                  {
                    value: "production",
                    title: "Live Production",
                    description: "Deliver real emails via verified SES identities",
                    badge: <StatusPill status="verified" label="Live" />,
                  },
                  {
                    value: "sandbox",
                    title: "Sandbox Simulator",
                    description: "Capture payloads without external SMTP delivery",
                    badge: <StatusPill status="test" label="Test" />,
                  },
                ]}
              />
            </div>
          </div>

          <CodeBlock
            title="POST /v1/emails"
            tabs={[
              {
                id: "ts",
                label: "TypeScript",
                code: `import { Calder } from "@calder/sdk";

const calder = new Calder(process.env.CALDER_API_KEY!);

await calder.emails.send({
  from: "Ada Lovelace <ada@analytical.dev>",
  to: ["charles@babbage.org"],
  subject: "Analytical Engine Deck #42",
  html: "<p>All Bernoulli numbers verified.</p>",
});`,
              },
              {
                id: "curl",
                label: "cURL",
                code: `curl -X POST https://api.calder.build/v1/emails \\
  -H "Authorization: Bearer $CALDER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"ada@analytical.dev","to":["charles@babbage.org"],"subject":"Hello"}'`,
              },
            ]}
          />
        </div>
      </section>

      {/* Section 4: Stat Cards, Banners, Overlays */}
      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">4. Metric Cards, Callouts & Overlays</h2>
            <p className="ds-card-subtitle">
              Tabular-numeral telemetry cards, contextual banners, modals, confirmation dialogs, and side drawers.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <DsButton variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
              Open Dialog
            </DsButton>
            <DsButton variant="secondary" size="sm" onClick={() => setDrawerOpen(true)} icon={<PanelRightOpen size={13} />}>
              Open Inspector Drawer
            </DsButton>
            <DsButton variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
              Destructive Confirm
            </DsButton>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ds-grid-4">
            <StatCard
              label="Delivered (30d)"
              value="99.42%"
              delta={{ value: "+0.18%", positive: true }}
              sublabel="14,820 of 14,906 accepted"
              icon={<CheckCircle2 size={15} />}
            />
            <StatCard
              label="Median Latency"
              value="184ms"
              delta={{ value: "-22ms", positive: true }}
              sublabel="p95: 410ms · eu-west-1"
              icon={<Terminal size={15} />}
            />
            <StatCard
              label="Bounce Rate"
              value="0.14%"
              delta={{ value: "Well below 2% threshold", positive: true }}
              sublabel="21 hard bounces suppressed"
              icon={<Layers size={15} />}
            />
            <StatCard
              label="Active Identity"
              value="Ada Lovelace"
              sublabel="ada@analytical.dev"
              icon={<Avatar name="Ada Lovelace" size={22} />}
            />
          </div>

          <div className="ds-grid-2">
            <DsBanner
              tone="info"
              title="DKIM propagation in progress"
              description="DNS resolvers typically cache CNAME records for 5–15 minutes. Calder polls automatically."
            />
            <DsBanner
              tone="warning"
              title="Approaching monthly sandbox quota"
              description="You have used 82% of your monthly allocation. Upgrade to Pro for 50,000+ messages."
            />
          </div>
        </div>
      </section>

      {/* Section 5: DataTable */}
      <section style={{ marginBottom: 20 }}>
        <DataTable
          data={SAMPLE_ROWS}
          getRowId={(r) => r.id}
          selectable
          toolbarLeft={
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              5. Interactive Data Table (Sortable, Density Toggle, Copyable IDs)
            </span>
          }
          columns={[
            {
              key: "status",
              header: "Status",
              width: 130,
              sortable: true,
              sortValue: (r) => r.status,
              render: (r) => <StatusPill status={r.status} />,
            },
            {
              key: "recipient",
              header: "Recipient & Subject",
              sortable: true,
              sortValue: (r) => r.recipient,
              render: (r) => (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.recipient}</div>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{r.subject}</div>
                </div>
              ),
            },
            {
              key: "id",
              header: "Message ID",
              width: 210,
              render: (r) => <CopyableMono value={r.id} />,
            },
            {
              key: "latency",
              header: "Latency",
              align: "right",
              width: 110,
              sortable: true,
              sortValue: (r) => r.latencyMs,
              render: (r) => (
                <span className="mono tabular-nums" style={{ fontSize: 12 }}>
                  {r.latencyMs}ms
                </span>
              ),
            },
            {
              key: "createdAt",
              header: "Sent",
              align: "right",
              width: 120,
              sortable: true,
              sortValue: (r) => r.createdAt,
              render: (r) => <RelativeTime value={r.createdAt} />,
            },
          ]}
        />
      </section>

      {/* Section 6: Empty State & Skeletons */}
      <div className="ds-grid-2">
        <DsEmptyState
          icon={<Globe size={22} />}
          eyebrow="First-run Experience"
          title="No verified domains yet"
          description="Add your root or subdomain to generate 2048-bit RSA DKIM keys and start sending authenticated email."
          primaryAction={<DsButton variant="primary">Add Sending Domain</DsButton>}
          secondaryAction={<DsButton variant="secondary">Read DNS Guide</DsButton>}
        />
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h3 className="ds-card-title">Skeleton Loading Placeholders</h3>
              <p className="ds-card-subtitle">Smooth shimmer state matching final layout geometry</p>
            </div>
            <Kbd>⌘K</Kbd>
          </div>
          <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <DsSkeleton height={22} width="45%" />
            <DsSkeleton height={14} width="80%" />
            <DsSkeleton height={64} width="100%" radius={10} />
            <KeyValueList
              items={[
                { label: "Font Sans", value: "var(--type-sans-family)", mono: true },
                { label: "Font Mono", value: "var(--type-mono-family)", mono: true },
              ]}
            />
          </div>
        </div>
      </div>

      <DsDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Sample Modal Dialog"
        description="Keyboard-accessible dialog with backdrop blur and Escape handling."
        footer={
          <>
            <DsButton variant="secondary" onClick={() => setDialogOpen(false)}>
              Close
            </DsButton>
            <DsButton variant="primary" onClick={() => setDialogOpen(false)}>
              Save Changes
            </DsButton>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--color-ink-secondary)" }}>
          All dialogs trap focus contextually and close cleanly via Escape or backdrop click.
        </p>
      </DsDialog>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          toast({ title: "Key revoked", tone: "danger" });
        }}
        title="Revoke Production API Key?"
        description="Any services authenticating with this key will immediately receive 401 Unauthorized responses."
        confirmPhrase="revoke"
        confirmLabel="Revoke Key"
      />

      <DsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Message Inspector Drawer"
        subtitle="msg_01j8x9a2b4c6d8e0f2"
      >
        <KeyValueList
          items={[
            { label: "Status", value: <StatusPill status="delivered" /> },
            { label: "Recipient", value: "ada@analytical.dev", mono: true },
            { label: "Region", value: "eu-west-1 (SES)", mono: true },
            { label: "TLS Cipher", value: "TLS_AES_256_GCM_SHA384", mono: true },
          ]}
        />
      </DsDrawer>
    </div>
  );
}
