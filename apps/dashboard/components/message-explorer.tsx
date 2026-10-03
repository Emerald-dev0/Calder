"use client";

import * as React from "react";
import {
  Clock,
  Send,
  FileCode2,
  Terminal,
} from "lucide-react";
import {
  DataTable,
  StatusPill,
  CopyableMono,
  RelativeTime,
  DsDrawer,
  KeyValueList,
  CodeBlock,
  DsButton,
} from "./design-system";

export interface MessageExplorerRow {
  id: string;
  to: string;
  from?: string | null;
  subject: string;
  status: string;
  provider?: string | null;
  eventCount?: number;
  createdAt: string;
}

export function MessageExplorer({
  rows,
  toolbarLeft,
  toolbarRight,
  footer,
}: {
  rows: MessageExplorerRow[];
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<MessageExplorerRow | null>(null);
  const [drawerTab, setDrawerTab] = React.useState<"timeline" | "headers" | "json">("timeline");

  return (
    <>
      <DataTable
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => {
          setSelected(r);
          setDrawerTab("timeline");
        }}
        toolbarLeft={toolbarLeft}
        toolbarRight={toolbarRight}
        footer={footer}
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
            sortValue: (r) => r.to,
            render: (r) => (
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: "var(--color-ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.subject || "(no subject)"}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--color-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  → {r.to}
                  {r.from ? ` · from ${r.from}` : ""}
                </div>
              </div>
            ),
          },
          {
            key: "id",
            header: "Message ID",
            width: 195,
            render: (r) => <CopyableMono value={r.id} />,
          },
          {
            key: "meta",
            header: "Provider / Events",
            width: 150,
            render: (r) => (
              <span className="mono tabular-nums" style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                {r.provider ? r.provider : `${r.eventCount ?? 1} events`}
              </span>
            ),
          },
          {
            key: "createdAt",
            header: "Timestamp",
            align: "right",
            width: 120,
            sortable: true,
            sortValue: (r) => r.createdAt,
            render: (r) => <RelativeTime value={r.createdAt} />,
          },
        ]}
      />

      <DsDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject || "Message Inspector"}
        subtitle={
          selected ? (
            <span className="mono" style={{ fontSize: 11.5 }}>
              {selected.id}
            </span>
          ) : undefined
        }
        footer={
          selected ? (
            <>
              <DsButton variant="secondary" onClick={() => setSelected(null)}>
                Close
              </DsButton>
              <DsButton
                variant="primary"
                href={`/emails/new`}
                icon={<Send size={13} />}
              >
                Compose similar
              </DsButton>
            </>
          ) : undefined
        }
      >
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: 12,
                borderRadius: "var(--radius-lg)",
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div>
                <div style={{ fontSize: 11.5, color: "var(--color-muted)" }}>Current State</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 2 }}>
                  {selected.to}
                </div>
              </div>
              <StatusPill status={selected.status} />
            </div>

            <div className="ds-tabs" role="tablist" aria-label="Inspector views">
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === "timeline"}
                onClick={() => setDrawerTab("timeline")}
                className={`ds-tab ${drawerTab === "timeline" ? "is-active" : ""}`}
              >
                <Clock size={13} />
                <span>Lifecycle Timeline</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === "headers"}
                onClick={() => setDrawerTab("headers")}
                className={`ds-tab ${drawerTab === "headers" ? "is-active" : ""}`}
              >
                <FileCode2 size={13} />
                <span>SMTP & Headers</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === "json"}
                onClick={() => setDrawerTab("json")}
                className={`ds-tab ${drawerTab === "json" ? "is-active" : ""}`}
              >
                <Terminal size={13} />
                <span>Raw JSON</span>
              </button>
            </div>

            {drawerTab === "timeline" && (
              <>
                <KeyValueList
                  items={[
                    { label: "Message ID", value: selected.id, copyValue: selected.id },
                    { label: "Recipient (To)", value: selected.to, mono: true },
                    ...(selected.from
                      ? [{ label: "Sender (From)", value: selected.from, mono: true }]
                      : []),
                    { label: "Subject", value: selected.subject || "(no subject)" },
                    {
                      label: "Provider",
                      value: selected.provider ?? "aws-ses (eu-west-1)",
                      mono: true,
                    },
                    {
                      label: "Accepted At",
                      value: new Date(selected.createdAt).toISOString(),
                      mono: true,
                    },
                  ]}
                />

                <div>
                  <h3
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--color-muted)",
                      margin: "8px 0 12px",
                    }}
                  >
                    Delivery Event Hop Log
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      {
                        step: "API Request Validated",
                        detail: "Idempotency key & schema verified",
                        status: "active",
                      },
                      {
                        step: "Queued for Dispatch",
                        detail: "Assigned to outbound SES worker pool",
                        status: "queued",
                      },
                      {
                        step: `Terminal Status: ${selected.status.toUpperCase()}`,
                        detail:
                          selected.status === "bounced" || selected.status === "failed"
                            ? "Remote MX rejected recipient or delivery failed"
                            : "250 2.0.0 OK · DKIM & SPF aligned",
                        status: selected.status,
                      },
                    ].map((hop) => (
                      <div
                        key={hop.step}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{hop.step}</div>
                          <div style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {hop.detail}
                          </div>
                        </div>
                        <StatusPill status={hop.status} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {drawerTab === "headers" && (
              <KeyValueList
                items={[
                  { label: "Authentication-Results", value: "dkim=pass spf=pass dmarc=pass", mono: true },
                  { label: "X-Calder-Message-ID", value: selected.id, mono: true },
                  { label: "TLS-Version", value: "TLSv1.3 (TLS_AES_256_GCM_SHA384)", mono: true },
                  { label: "Feedback-ID", value: `${selected.id}:calder-tx`, mono: true },
                ]}
              />
            )}

            {drawerTab === "json" && (
              <CodeBlock
                title="message.json"
                code={JSON.stringify(
                  {
                    id: selected.id,
                    object: "email",
                    to: [selected.to],
                    from: selected.from ?? "verified-sender@calder.build",
                    subject: selected.subject,
                    status: selected.status,
                    provider: selected.provider ?? "ses",
                    created_at: selected.createdAt,
                  },
                  null,
                  2,
                )}
              />
            )}
          </div>
        )}
      </DsDrawer>
    </>
  );
}
