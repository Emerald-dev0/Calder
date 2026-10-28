import type { DeliveryEventHealth } from "@calder/observability";

/**
 * The dashboard's half of delivery-event health.
 *
 * Two rules, both learned from a real workspace showing "5 sent / 0 delivered"
 * while SES had never been wired to report back:
 *
 * 1. A zero is only printed when feedback is known to be flowing. Otherwise
 *    the card says "Unknown" — a number the UI cannot defend is worse than no
 *    number.
 * 2. The explanation is the same sentence as the API's readiness check
 *    (`DELIVERY_UNKNOWN_HEADLINE`), so an operator reading `/ready` and an
 *    owner reading the senders page are told the same thing.
 *
 * Deliberately free of data access: the page loads the facts, this renders
 * them, and the test renders this.
 */

export function DeliveryStatValue({
  count,
  health,
  testId,
}: {
  count: number;
  health: DeliveryEventHealth;
  testId?: string;
}) {
  if (health.zerosTrusted || count > 0) {
    // A non-zero count is a measurement even when feedback is patchy: those
    // events arrived. Only the zeros are suspect.
    return <span data-testid={testId}>{count.toLocaleString()}</span>;
  }
  return (
    <span data-testid={testId} title={health.headline}>
      Unknown
    </span>
  );
}

/** The banner above the stream cards. Renders nothing when counts are sound. */
export function DeliveryEventNotice({
  health,
  projectId,
}: {
  health: DeliveryEventHealth;
  projectId: string;
}) {
  if (health.zerosTrusted) return null;
  return (
    <div
      data-testid="delivery-events-unknown"
      role="status"
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--color-warning, #CA8A04)",
        background: "color-mix(in srgb, var(--color-warning, #CA8A04) 8%, transparent)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <div style={{ maxWidth: 720 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{health.headline}</div>
        <div style={{ fontSize: 12, color: "var(--color-muted, #737373)", lineHeight: 1.5 }}>
          {health.detail}
        </div>
      </div>
      {health.setupHref && (
        <a
          className="ds-btn ds-btn-secondary ds-btn-sm"
          href={health.setupHref}
          style={{ textDecoration: "none", whiteSpace: "nowrap" }}
          data-testid="delivery-events-setup"
        >
          Fix delivery feedback
        </a>
      )}
      <a
        href={`/deliveries?project=${projectId}`}
        style={{ textDecoration: "none", fontSize: 12, whiteSpace: "nowrap" }}
        data-testid="delivery-events-log"
      >
        Delivery log
      </a>
    </div>
  );
}

/**
 * What to print in a stream card's sub-line when the zero above it is unknown.
 * Kept next to the components so the wording cannot drift between pages.
 */
export function deliverySubline(health: DeliveryEventHealth, fallback: string): string {
  return health.zerosTrusted ? fallback : "Unknown — no delivery events received";
}
