export interface GlossaryTerm {
  slug: string;
  term: string;
  short: string;
  definition: string[];
  calderLink: { href: string; label: string };
  related: string[];
}

export const TERMS: GlossaryTerm[] = [
  {
    slug: "email-api",
    term: "Email API",
    short: "An HTTP interface for sending email from code.",
    definition: [
      "An email API lets applications send mail with an HTTPS request instead of operating an SMTP server: authenticate, POST JSON describing the message, and get back an identifier. The provider handles queueing, retries, delivery, bounces, and events.",
      "What separates good email APIs from thin SMTP wrappers: idempotent sends, structured errors with request IDs, sandbox/test modes, event timelines per message, and webhooks that retry. Calder's reference lives under Documentation.",
    ],
    calderLink: { href: "/docs/api-reference", label: "Calder API reference" },
    related: ["transactional-email", "smtp", "webhook", "idempotency"],
  },
  {
    slug: "smtp",
    term: "SMTP",
    short: "The 40-year-old protocol that moves email between servers.",
    definition: [
      "Simple Mail Transfer Protocol: the standard (RFC 5321) for submitting and relaying email. Clients connect (usually port 587 with STARTTLS, or 465 implicit TLS), authenticate, then issue MAIL FROM, RCPT TO, and DATA commands carrying a MIME message.",
      "Modern providers also expose SMTP relays so legacy stacks, WordPress, Laravel, Django, Nodemailer, can send without code changes. SMTP has no native idempotency or structured errors, which is why APIs exist alongside it.",
    ],
    calderLink: { href: "/docs/smtp", label: "Sending with Calder SMTP" },
    related: ["email-api", "transactional-email", "deliverability"],
  },
  {
    slug: "transactional-email",
    term: "Transactional email",
    short: "Mail the recipient triggered: OTPs, receipts, resets, alerts.",
    definition: [
      "Transactional email is sent in response to a user action or system event: one-time passcodes, verification links, password resets, receipts, shipping alerts. It is the opposite of bulk/marketing email: expected, high-engagement, and time-sensitive.",
      "Because recipients want it, transactional mail earns the best deliverability, provided authentication (SPF, DKIM, DMARC) is correct and bounces are suppressed. Mixing it with marketing blasts on shared infrastructure is how reputations die.",
    ],
    calderLink: { href: "/docs/sending", label: "Sending with Calder" },
    related: ["email-api", "deliverability", "suppression-list", "bounce"],
  },
  {
    slug: "deliverability",
    term: "Deliverability",
    short: "The discipline of reaching inboxes instead of spam folders.",
    definition: [
      "Deliverability is sender reputation made measurable: authentication (SPF/DKIM/DMARC proving you are who you claim), IP and domain history, bounce and complaint rates, engagement, list hygiene, and gradual warmup for new senders.",
      "Gmail's bulk-sender rules made the floor explicit: authenticate everything, keep spam complaints under 0.1%, offer one-click unsubscribe. The ceiling is ongoing: monitor per-domain health, suppress the dead addresses, and never share reputation pools with spammers.",
    ],
    calderLink: { href: "/docs/deliverability", label: "Calder deliverability guide" },
    related: ["transactional-email", "bounce", "complaint", "suppression-list", "email-reputation"],
  },
  {
    slug: "webhook",
    term: "Webhook",
    short: "An HTTP callback your provider fires when something happens.",
    definition: [
      "A webhook is a POST request a service sends to your endpoint on events, delivered, bounced, opened, clicked. Serious implementations sign payloads (HMAC) so you can verify them, retry with backoff on your 5xxs, and let you replay missed deliveries.",
      "Treat webhook handlers as distributed-systems code: acknowledge fast, work asynchronously, dedupe on event IDs. A webhook that fires once into the void is a wish, not infrastructure.",
    ],
    calderLink: { href: "/docs/webhooks", label: "Calder webhooks" },
    related: ["email-api", "idempotency"],
  },
  {
    slug: "idempotency",
    term: "Idempotency",
    short: "Same request twice, same effect once.",
    definition: [
      "An idempotent operation returns the original result when retried with the same key instead of executing twice. Email APIs implement it via an Idempotency-Key header: the first request stores its result durably; repeats within the window replay it.",
      "Without it, every network timeout forces a gamble, retry and risk two receipts, or don't and risk zero. With it, clients retry freely on timeouts and 5xx responses.",
    ],
    calderLink: { href: "/docs/idempotency", label: "Idempotency at Calder" },
    related: ["email-api", "webhook"],
  },
  {
    slug: "bounce",
    term: "Bounce",
    short: "A message the recipient server refused.",
    definition: [
      "Hard bounces (unknown mailbox, invalid domain) are permanent, the address must be suppressed. Soft bounces (mailbox full, greylisted, throttled) may succeed on retry. Sustained hard-bounce rates above ~2% will damage sender reputation everywhere, not just with one provider.",
    ],
    calderLink: { href: "/docs/suppression", label: "Suppression at Calder" },
    related: ["deliverability", "complaint", "suppression-list", "transactional-email"],
  },
  {
    slug: "complaint",
    term: "Complaint",
    short: "A recipient marking mail as spam.",
    definition: [
      "Complaints arrive via feedback loops from mailbox providers when a user clicks 'report spam'. They are reputation poison at tiny volumes, Gmail wants rates under 0.1%, and treats sustained 0.3%+ as an emergency. Complained addresses must be suppressed immediately and automatically.",
    ],
    calderLink: { href: "/docs/suppression", label: "Suppression at Calder" },
    related: ["deliverability", "bounce", "suppression-list"],
  },
  {
    slug: "suppression-list",
    term: "Suppression list",
    short: "Addresses you must never email again.",
    definition: [
      "A suppression list holds bounced, complained, and unsubscribed addresses, checked before every send. Good suppression blocks with a logged reason instead of silently dropping, a blocked send is diagnosable information, usually pointing at list hygiene to fix upstream.",
    ],
    calderLink: { href: "/docs/suppression", label: "Suppression at Calder" },
    related: ["bounce", "complaint", "transactional-email", "deliverability"],
  },
  {
    slug: "email-reputation",
    term: "Email reputation",
    short: "The score mailbox providers keep on your sending identity.",
    definition: [
      "Reputation attaches to sending IPs and domains based on authentication, bounce/complaint history, engagement, volume patterns, and age. It is earned over months and spendable in days, which is why new senders warm up gradually, why transactional and bulk traffic stay separated, and why suppression lists exist.",
    ],
    calderLink: { href: "/docs/deliverability", label: "Calder deliverability guide" },
    related: ["deliverability", "bounce", "complaint", "transactional-email"],
  },
];

export function getTerm(slug: string): GlossaryTerm | undefined {
  return TERMS.find((t) => t.slug === slug);
}
