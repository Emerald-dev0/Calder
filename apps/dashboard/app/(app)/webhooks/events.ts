/** Client-safe: pure event catalog, no node builtins. */
export const WEBHOOK_EVENTS = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.opened",
  "email.clicked",
] as const;
