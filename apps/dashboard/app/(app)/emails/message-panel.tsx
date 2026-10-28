"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Clock,
  Code2,
  Download,
  FileCode2,
  FileText,
  Monitor,
  RotateCw,
  ShieldBan,
  Terminal,
} from "lucide-react";
import {
  CodeBlock,
  ConfirmDialog,
  DsBanner,
  DsButton,
  DsDrawer,
  KeyValueList,
  StatusPill,
  useToast,
} from "../../../components/design-system";
import { redactHeaders, redactText, redactedJson } from "../../../lib/emails/redact";
import { describeTransport } from "../../../lib/emails/transport";
import { addMessageRecipientToSuppressions, resendEmail } from "./actions";

export interface PanelMessage {
  id: string;
  to: string;
  from: string;
  fromName: string | null;
  cc: string | null;
  bcc: string | null;
  replyTo: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  status: string;
  stream: string;
  provider: string | null;
  providerMessageId: string | null;
  transport: string | null;
  env: string;
  lastError: string | null;
  attemptCount: number;
  idempotencyKey: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: unknown;
}

export interface PanelEvent {
  id: string;
  type: string;
  data: unknown;
  createdAt: string;
}

type Tab = "timeline" | "preview" | "html" | "text" | "headers" | "json";

const TAB_META: Array<{
  id: Tab;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
}> = [
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "preview", label: "Preview", icon: Monitor },
  { id: "html", label: "HTML", icon: FileCode2 },
  { id: "text", label: "Text", icon: FileText },
  { id: "headers", label: "Headers", icon: Code2 },
  { id: "json", label: "Raw JSON", icon: Terminal },
];

/** Block remote loads so a tracking pixel cannot report an open. */
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data:;";

function previewDocument(html: string): string {
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_blank">',
    "<style>html,body{margin:0;padding:16px;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#111;}</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

export function MessagePanel({
  projectId,
  message,
  events,
  alreadySuppressed,
  closeHref,
  templateName,
  apiKeyUsed,
}: {
  projectId: string;
  message: PanelMessage;
  events: PanelEvent[];
  alreadySuppressed: boolean;
  closeHref: string;
  templateName: string | null;
  apiKeyUsed: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<Tab>("timeline");
  const [busy, setBusy] = React.useState<null | "resend" | "suppress">(null);
  const [resendId, setResendId] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<null | "resend" | "suppress">(null);

  const metadata = (message.metadata ?? {}) as Record<string, unknown>;

  // The legs the drain actually handed this message to, from the failed event.
  // The row's `transport` column is only written when a leg succeeds, so it
  // cannot answer "what did we try" for a message that never went out.
  const failedEvent = events.find((e) => e.type === "failed");
  const attemptedLegs = Array.isArray((failedEvent?.data as { legs?: unknown })?.legs)
    ? ((failedEvent!.data as { legs: string[] }).legs ?? [])
    : [];
  const transport = describeTransport({
    status: message.status,
    transport: message.transport,
    attempted: attemptedLegs,
  });
  const headers = redactHeaders(metadata.headers);

  const close = () => router.push(closeHref, { scroll: false });

  const curl = buildCurl(projectId, message);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: `${label} copied` });
    } catch {
      toast({
        tone: "danger",
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
      });
    }
  }

  async function resend() {
    setBusy("resend");
    try {
      const result = await resendEmail(projectId, message.id);
      setResendId(result.newId);
      toast({
        tone: "success",
        title: "Queued a new message",
        description: `${result.newId} — it goes through the same checks as any send.`,
      });
      router.refresh();
    } catch (e) {
      toast({
        tone: "danger",
        title: "Resend refused",
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function suppress() {
    setBusy("suppress");
    try {
      await addMessageRecipientToSuppressions(projectId, message.id);
      toast({
        tone: "success",
        title: "Added to suppressions",
        description: `${message.to} will not be mailed again from this project.`,
      });
      router.refresh();
    } catch (e) {
      toast({
        tone: "danger",
        title: "Could not add suppression",
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    } finally {
      setBusy(null);
    }
  }

  // Suppressing is offered for any recipient, not just bounced ones — an
  // operator may need to stop mail to an address for reasons the provider
  // never reports. The address is named in the confirm step.
  const canSuppress = !alreadySuppressed;

  return (
    <>
      <DsDrawer
        open
        onClose={close}
        title={message.subject || "(no subject)"}
        subtitle={
          <span className="mono" style={{ fontSize: 11.5 }}>
            {message.id}
          </span>
        }
        footer={
          <>
            <DsButton variant="secondary" onClick={close}>
              Close
            </DsButton>
            {canSuppress && (
              <DsButton
                variant="secondary"
                onClick={() => setConfirming("suppress")}
                loading={busy === "suppress"}
                icon={<ShieldBan size={13} />}
              >
                Add to suppressions
              </DsButton>
            )}
            <DsButton
              variant="primary"
              onClick={() => setConfirming("resend")}
              loading={busy === "resend"}
              icon={<RotateCw size={13} />}
            >
              Resend
            </DsButton>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--color-muted)" }}>Recipient</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {message.to}
              </div>
            </div>
            <StatusPill status={message.status} />
          </div>

          {message.lastError && (
            <DsBanner
              tone={
                message.status === "failed" || message.status === "bounced" ? "danger" : "warning"
              }
              title="Last provider message"
              description={redactText(message.lastError)}
            />
          )}

          {resendId && (
            <DsBanner
              tone="info"
              title="Resent as a new message"
              description={
                <span className="mono">
                  {resendId}{" "}
                  <Link href={`?project=${projectId}&message=${resendId}`} scroll={false}>
                    open
                  </Link>
                </span>
              }
            />
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <DsButton variant="secondary" size="sm" onClick={() => copy(message.id, "Message ID")}>
              Copy message ID
            </DsButton>
            <DsButton variant="secondary" size="sm" onClick={() => copy(curl, "cURL")}>
              Copy cURL
            </DsButton>
            {message.html && (
              <DsButton
                variant="secondary"
                size="sm"
                onClick={() => downloadFile(`${message.id}.html`, message.html ?? "", "text/html")}
                icon={<Download size={12} />}
              >
                Download HTML
              </DsButton>
            )}
          </div>

          <div className="ds-tabs" role="tablist" aria-label="Message views">
            {TAB_META.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`ds-tab ${tab === t.id ? "is-active" : ""}`}
                >
                  <Icon size={13} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {tab === "timeline" && <Timeline events={events} />}

          {tab === "preview" && (
            <div>
              {message.html ? (
                <>
                  <p style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 8 }}>
                    Rendered in a sandboxed frame with scripts disabled and remote content blocked,
                    so tracking pixels and external images will not load.
                  </p>
                  <iframe
                    title="Rendered message preview"
                    // Empty sandbox: no scripts, no forms, no same-origin access,
                    // no top-level navigation. This is the whole security model
                    // for rendering customer HTML.
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={previewDocument(message.html)}
                    style={{
                      width: "100%",
                      height: 460,
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      background: "#fff",
                    }}
                  />
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
                  This message has no HTML part.
                </p>
              )}
            </div>
          )}

          {tab === "html" && (
            <CodeBlock title="message.html" code={message.html ?? "— no HTML part —"} />
          )}

          {tab === "text" && (
            <CodeBlock title="message.txt" code={message.text ?? "— no text part —"} />
          )}

          {tab === "headers" && <HeadersView message={message} headers={headers} />}

          {tab === "json" && (
            <CodeBlock
              title="message.json"
              code={redactedJson({
                id: message.id,
                object: "email",
                to: message.to,
                from: message.from,
                reply_to: message.replyTo,
                subject: message.subject,
                status: message.status,
                stream: message.stream,
                provider: message.provider,
                provider_message_id: message.providerMessageId,
                transport: message.transport,
                env: message.env,
                attempt_count: message.attemptCount,
                idempotency_key: message.idempotencyKey,
                scheduled_for: message.scheduledFor,
                created_at: message.createdAt,
                updated_at: message.updatedAt,
                metadata: message.metadata,
              })}
            />
          )}

          {/* Metadata: the facts about *this send*, not the message body. */}
          <div>
            <h3 className="ds-label" style={{ marginBottom: 8 }}>
              Send metadata
            </h3>
            <KeyValueList
              items={[
                {
                  label: "API key used",
                  value: apiKeyUsed
                    ? apiKeyUsed === "dashboard"
                      ? "Dashboard session"
                      : apiKeyUsed
                    : "Not recorded",
                  mono: true,
                },
                {
                  label: "Template",
                  value: templateName ?? "None (raw content)",
                  mono: Boolean(templateName),
                },
                {
                  label: "Idempotency key",
                  value: message.idempotencyKey ?? "None",
                  mono: true,
                  copyValue: message.idempotencyKey ?? undefined,
                },
                {
                  label: "Sender identity",
                  value: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
                  mono: true,
                },
                { label: "Environment", value: message.env, mono: true },
                { label: "Transport", value: transport.value, mono: transport.mono },
              ]}
            />
          </div>
        </div>
      </DsDrawer>

      <ConfirmDialog
        open={confirming === "resend"}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          setConfirming(null);
          await resend();
        }}
        busy={busy === "resend"}
        danger={false}
        title={`Resend to ${message.to}?`}
        description={`A new message is queued to ${message.to}. It passes the same suppression, sender and monthly-quota checks as any other send, so it may be refused.`}
        confirmLabel="Resend"
      />

      <ConfirmDialog
        open={confirming === "suppress"}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          setConfirming(null);
          await suppress();
        }}
        busy={busy === "suppress"}
        title={`Suppress ${message.to}?`}
        description={`${message.to} will not receive email from this project again, in either stream. Transactional mail is included.`}
        confirmLabel="Add to suppressions"
        confirmPhrase={message.to}
      />
    </>
  );
}

function HeadersView({
  message,
  headers,
}: {
  message: PanelMessage;
  headers: Array<{ name: string; value: string }>;
}) {
  const standard = [
    {
      name: "From",
      value: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
    },
    { name: "To", value: message.to },
    ...(message.cc ? [{ name: "Cc", value: message.cc }] : []),
    ...(message.replyTo ? [{ name: "Reply-To", value: message.replyTo }] : []),
    { name: "Subject", value: message.subject },
    { name: "X-Calder-Message-ID", value: message.id },
    ...(message.providerMessageId
      ? [{ name: "X-Provider-Message-ID", value: message.providerMessageId }]
      : []),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h3 className="ds-label" style={{ marginBottom: 6 }}>
          Envelope
        </h3>
        <KeyValueList
          items={standard.map((h) => ({ label: h.name, value: h.value, mono: true }))}
        />
      </div>
      <div>
        <h3 className="ds-label" style={{ marginBottom: 6 }}>
          Custom headers
        </h3>
        {headers.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            No custom headers were sent with this message.
          </p>
        ) : (
          <KeyValueList
            items={headers.map((h) => ({ label: h.name, value: h.value, mono: true }))}
          />
        )}
        <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 8 }}>
          Authorization, API-key, secret and token values are masked before render.
        </p>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: PanelEvent[] }) {
  if (events.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
        No lifecycle events recorded yet. A queued message should produce one immediately; if this
        stays empty, check the delivery worker.
      </p>
    );
  }
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {events.map((e, i) => {
        const detail = describeEvent(e);
        return (
          <li
            key={e.id}
            style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr",
              gap: 10,
              paddingBottom: i === events.length - 1 ? 0 : 14,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                aria-hidden
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  marginTop: 5,
                  background:
                    e.type === "bounced" || e.type === "failed" || e.type === "complained"
                      ? "var(--color-danger)"
                      : e.type === "delivered"
                        ? "var(--color-success)"
                        : "var(--color-border-strong)",
                }}
              />
              {i < events.length - 1 && (
                <span
                  aria-hidden
                  style={{ width: 1, flex: 1, marginTop: 4, background: "var(--color-border)" }}
                />
              )}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <StatusPill status={e.type} />
                <span
                  className="tabular-nums"
                  style={{ fontSize: 11.5, color: "var(--color-muted)" }}
                >
                  {new Date(e.createdAt).toISOString()}
                </span>
              </div>
              {detail && (
                <div
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--color-muted)",
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {detail}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One line of provider detail per event, never raw JSON. */
function describeEvent(e: PanelEvent): string | null {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const push = (k: string, v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(`${k}: ${redactText(v)}`);
  };
  push("smtp", d.smtpResponse);
  push("bounce", d.bounceType);
  push("sub-type", d.bounceSubType);
  push("feedback", d.complaintFeedbackType);
  push("reason", d.reason);
  push("link", d.link);
  push("sns", d.snsMessageId);
  push("via", d.via);
  push("resend of", d.resendOf);
  // The failed event now carries a cause (`code`), the leg that produced it
  // and the error's class — never its message. Show all three: "provider_error"
  // alone sends an operator hunting in the wrong place.
  push("code", d.code);
  push("leg", d.leg);
  push("error", d.errorName);
  if (e.type === "unattributed") {
    // The stored reason is a machine code; say what it means.
    return "No registered sender matches this From address";
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A curl the customer can replay, with a placeholder — never a real key. */
function buildCurl(projectId: string, message: PanelMessage): string {
  const body: Record<string, unknown> = {
    from: message.from,
    to: message.to,
    subject: message.subject,
  };
  if (message.replyTo) body.reply_to = message.replyTo;
  if (message.html) body.html = message.html;
  if (message.text) body.text = message.text;
  if (message.stream === "marketing") body.stream = "marketing";

  const lines = [
    `curl -X POST "${typeof window !== "undefined" ? window.location.origin : "https://api.calder.click"}/v1/emails" \\`,
    `  -H "Authorization: Bearer $CALDER_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: $(uuidgen)" \\`,
    `  -d '${JSON.stringify(body, null, 2)}'`,
  ];
  return lines.join("\n");
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
