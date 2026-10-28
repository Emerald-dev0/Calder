/**
 * Words for the "Transport" row of the message panel.
 *
 * It used to render `message.transport ?? "—"`. The column is only written on
 * success, so every failed message showed a dash, and a dash reads as "nothing
 * was routed" — the opposite of the truth for a message that was handed to two
 * transports and rejected by both.
 *
 * Pure on purpose: the rules are the kind that drift silently inside JSX.
 */
export interface TransportDescription {
  /** What the panel prints. Never a bare dash. */
  value: string;
  /** Only a real transport name is worth monospace. */
  mono: boolean;
}

/** Statuses that mean the provider took the message. */
const ACCEPTED = new Set(["sent", "delivered", "bounced", "complained"]);

export function describeTransport(input: {
  status: string;
  transport: string | null;
  /** Legs the drain tried, oldest first, from the failed event. */
  attempted?: readonly string[];
}): TransportDescription {
  const { status, transport } = input;
  const attempted = (input.attempted ?? []).filter(Boolean);

  if (transport) return { value: transport, mono: true };

  if (ACCEPTED.has(status)) {
    // Accepted by a provider, but the row predates transport being recorded
    // (or the provider accepted it without naming a leg).
    return { value: "Accepted; transport not recorded", mono: false };
  }

  if (status === "failed") {
    return {
      value:
        attempted.length > 0
          ? `Not delivered by any transport (tried ${attempted.join(", ")})`
          : "Not delivered by any transport",
      mono: false,
    };
  }

  if (status === "suppressed") {
    return { value: "Not sent; recipient is suppressed", mono: false };
  }

  // created, queued, sending: nothing has been routed yet, and saying so is
  // more useful than a dash that could mean either of the two above.
  return { value: "Not sent yet", mono: false };
}
