/**
 * Delivery-event health: can a "0 delivered" be believed?
 *
 * The failure this exists for: a stream showed 5 sent / 0 delivered / 0
 * bounced and the numbers were entirely honest about the data and entirely
 * dishonest about the world. SES had never been wired to report back, so no
 * delivery event had ever arrived — and a count of zero events rendered as
 * "nothing was delivered", which reads as "everything is failing".
 *
 * The rule: a zero is only a fact when feedback is known to be flowing. When
 * it is not, the UI says "unknown", names the reason, and links to the fix.
 * It never prints a zero it cannot defend.
 *
 * Pure by design — the classifier takes the facts and returns words, so the
 * API readiness route, the senders page and the stream cards cannot drift.
 */

/** Operator-facing setup page for SES feedback (SNS topic → this API). */
export const DELIVERY_SETUP_HREF = "https://calder.click/docs/deliverability#delivery-feedback";

/**
 * The one sentence used everywhere a zero would otherwise be shown.
 * Kept as a constant so the API and the dashboard cannot word it differently.
 */
export const DELIVERY_UNKNOWN_HEADLINE =
  "No delivery events received — Delivered and Bounced are unknown, not zero.";

export type DeliveryEventState =
  /** Events are arriving inside the window: counts are real. */
  | "fresh"
  /** Feedback is configured, sends happened, nothing came back: counts are lies. */
  | "stale"
  /** `SES_SNS_TOPIC_ARNS` is unset, so nothing can report back. */
  | "unconfigured"
  /** Nothing was accepted in the window, so there is nothing to report on. */
  | "idle";

export interface DeliveryEventHealth {
  state: DeliveryEventState;
  /**
   * Whether a count of zero in the same window is a measurement or an absence.
   * The dashboard uses this to swap confident-looking numbers for words.
   */
  zerosTrusted: boolean;
  /** One sentence, safe to show as a card value or banner title. */
  headline: string;
  /** The consequence, in plain language. */
  detail: string;
  /** Where an owner fixes it; null when there is nothing to fix. */
  setupHref: string | null;
  /** ISO timestamp of the newest delivery event, or null if none ever arrived. */
  lastEventAt: string | null;
  /** Whether the SNS topic allowlist is set. */
  configured: boolean;
}

export interface DeliveryEventFacts {
  /** `SES_SNS_TOPIC_ARNS` has at least one ARN. */
  topicArnsConfigured: boolean;
  /** Newest delivered/bounced/complained event, or null if none was ever stored. */
  lastEventAt: Date | null;
  /** Messages the provider accepted inside the window. */
  acceptedInWindow: number;
  /** Start of the window the accepted count covers. */
  windowStart: Date;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * Classify the facts. Order matters: an unconfigured ingress explains a stale
 * window, so it is reported first — telling an operator "the topic is quiet"
 * when it was never subscribed sends them to the wrong place.
 */
export function classifyDeliveryEvents(facts: DeliveryEventFacts): DeliveryEventHealth {
  const { topicArnsConfigured, lastEventAt, acceptedInWindow, windowStart } = facts;
  const now = facts.now ?? new Date();
  const lastEventIso = lastEventAt ? lastEventAt.toISOString() : null;

  if (!topicArnsConfigured) {
    return {
      state: "unconfigured",
      zerosTrusted: false,
      headline: DELIVERY_UNKNOWN_HEADLINE,
      detail:
        "SES is not reporting back to Calder: the SNS topic allowlist (SES_SNS_TOPIC_ARNS) is unset, " +
        "so delivered and bounced mail never reaches this workspace.",
      setupHref: DELIVERY_SETUP_HREF,
      lastEventAt: lastEventIso,
      configured: false,
    };
  }

  if (acceptedInWindow === 0) {
    return {
      state: "idle",
      zerosTrusted: true,
      headline: "No accepted sends in this window",
      detail:
        "Nothing was accepted for delivery here, so there are no delivery events to wait for. " +
        "The zeros below describe an empty window, not a failing one.",
      setupHref: null,
      lastEventAt: lastEventIso,
      configured: true,
    };
  }

  const fresh = lastEventAt !== null && lastEventAt >= windowStart;
  if (!fresh) {
    const sent = acceptedInWindow.toLocaleString("en-US");
    return {
      state: "stale",
      zerosTrusted: false,
      headline: DELIVERY_UNKNOWN_HEADLINE,
      detail:
        `${sent} message${acceptedInWindow === 1 ? " was" : "s were"} accepted for delivery in this ` +
        "window and no delivery event arrived for any of them. The SNS topic is configured but " +
        "not reaching this endpoint, so delivery is not being observed.",
      setupHref: DELIVERY_SETUP_HREF,
      lastEventAt: lastEventIso,
      configured: true,
    };
  }

  const ageMs = Math.max(0, now.getTime() - lastEventAt.getTime());
  return {
    state: "fresh",
    zerosTrusted: true,
    headline: "Delivery events are arriving",
    detail: `Last event ${describeAge(ageMs)}. Delivered and Bounced count real events.`,
    setupHref: null,
    lastEventAt: lastEventIso,
    configured: true,
  };
}

/** Short, monotonic-in-words age. Coarse on purpose: this is not a timer. */
export function describeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * The SNS topic allowlist from the environment, parsed once, here.
 *
 * `ses-events.ts` (the ingress), `/ready` (the report) and the launch check all
 * need to answer "is feedback configured?" — they answer it with this, so one
 * cannot say configured while another refuses the same subscription.
 * Read live rather than memoised: tests flip it between cases.
 */
export function sesTopicArns(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SES_SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function hasSesTopicArns(env: NodeJS.ProcessEnv = process.env): boolean {
  return sesTopicArns(env).length > 0;
}
