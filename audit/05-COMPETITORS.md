# 05 — Competitors (email scope; accessed 2026-10-02)

Full research output from the deep-dive pass is summarized here. `NOT VERIFIED` = could not confirm from vendor sources in this pass; do not quote as fact.

## Profiles (email players)

**Resend — the DX benchmark.** "Email for developers", React Email native. Free $0: 3k/mo, 100/day cap, 3 domains, 30-day retention. Pro $20/mo 50k; Scale $90/mo 100k; overage $0.90/1k; dedicated IP $30 add-on (Scale). Shared IPs, suppression, tracking, inbound yes, rich webhooks. Complaints: 100/day cap, steep overage, no dedicated IP on Pro. Sources: resend.com/products/transactional-emails; coldletter.com/blog/resend-pricing (Jul 2026); coldmailer.ai/resend-pricing (Aug 2026).

**Postmark — deliverability gold standard.** Streams separate transactional/broadcast reputation. Free: 100/mo (testing only). Paid: $15/mo 10k ($1.80/1k overage); ~$55/mo 50k; ~$115/mo 100k. 45-day logs, strict vetting, best debugging. Complaints: free tier useless for prod, pricey at scale, no React Email. Sources: postmarkapp.com/pricing; suprsend.com/post/resend-vs-postmark (May 2026).

**SendGrid (Twilio) — scale incumbent, exodus risk.** Permanent free REMOVED May 2025 (now 60-day trial, 100/day). Essentials $19.95/mo 50k; Pro $89.95/mo 100k + dedicated IP. Strongest compliance breadth (SOC2/ISO/HIPAA/PCI — per comparisons, NOT VERIFIED primary). Complaints: +33% 2024 hike, dated DX, shared-IP rep, dual bills. Sources: sendgrid.com/pricing; twilio.com/en-us/products/email-api/pricing; smtpedia.com/platforms/sendgrid/pricing (Aug 2026).

**Mailgun (Sinch) — dev infra + deliverability upsell.** Free 100/day trial. Basic $15/mo 10k; Foundation $35/mo 50k; Scale $90/mo 100k (dedicated IP). Optimize sold separately ($49–99/mo). Strongest bundled lab (validation, seed tests, blocklist monitoring). Complaints: free sandbox-only, cost stacks, stingy log retention (1–5d low tiers). Sources: mailgun.com/pricing; usebouncer.com/mailgun-pricing (Sep 2026).

**Amazon SES direct — the price floor.** À la carte $0.10/1k + $0.12/GB; new Essentials/Pro/Enterprise plans from Jul 2026 ($0.16–0.23/1k + monthly). Legacy 62k-free-from-EC2 is outdated; SES 3k-free ended Jul 2026 for new customers. 100k/mo ≈ $10 vs $90 Resend / $115 Postmark. Everything DIY (sandbox approval, SNS wiring, suppression UI). Sources: aws.amazon.com/ses/pricing; AWS messaging blog Jul 21 2026.

**Brevo — all-in-one value.** Free 300/day (~9k/mo). Starter ~$9/mo 5k; Standard ~$18/mo. Transactional reliability incident Jun 19 2026 (49-min, status write-up). Dense marketer UI. Sources: brevo.com/pricing; help.brevo.com pricing article; status.brevo.com incident write-up.

**Loops — SaaS lifecycle bundling.** Free 1k contacts/4k sends rolling-30d. Paid contacts-based ($49 1–5k → $399 100k), unlimited sends, transactional included. Monthly-only. Sources: loops.so/pricing; loops.so/updates/transactional-email-is-now-free (Dec 2024).

**Plunk — open-source pay-per-email.** Free 1k/mo; paid flat $0.001/email ($1.00/1k); self-host AGPL free. Thinnest ops. Source: useplunk.com/pricing.

**Mailtrap — test + send, cheapest at 100k ($30).** Free 4k/mo (150/day, 3-day logs). Basic $15/10k → $20/50k → $30/100k. Business $85/100k (dedicated IP + warmup). Three-product billing (Send/Sandbox/Marketing) confuses. Source: mailtrap.io/pricing (+ pricing.md).

**MailerSend — cheapest starter paid.** Free 500/mo. Hobby $7/mo 5k; Starter ~$25–35/mo (reports vary — NOT VERIFIED exact); SMS API + inbound routing + 7 SDKs + MCP server. Complaints: 500 free tiny, branding until Starter. Sources: mailersend.com/pricing; mailerlite.com/pricing-mailersend.

**Sendly API (Lagos — direct Calder competitor, name-collision warning).** developer.sendlyai.com: "communications infrastructure, built here." Live: transactional + marketing email; SMS/WhatsApp coming soon. Free 3k/mo; Pro $8/mo 50k; Premium $30/mo 200k. USD via Stripe today, Naira promised. Two other "Sendly"s exist (sendly.now US dev-tool; sendlyapp.com bulk-campaign) — disambiguate in migration copy.

## Adjacent (brief — out of email scope)

Twilio (SendGrid's CPaaS parent), Courier (orchestration over providers, free 10k sends/mo, $0.005/send), Novu (open-source, bring-your-own provider), Knock ($250/mo starter — no hobby tier), Termii (NG OTP/SMS-first), Africa's Talking (CPaaS, no email API), Sendchamp (Lagos CPaaS, email NGN price unpublished — Calder opening: publish per-1k Naira).

## Feature matrix (Calder target vs top 6)

✅ yes / ⚠️ partial / ❌ no / ? NOT VERIFIED. REST+SMTP: all ✅. React/templates: Calder ✅-target, Resend native ✅, Postmark Mustache ⚠️, SES ❌. SPF/DKIM/DMARC wizard: Calder ✅-target; SES ❌. Auto-suppression: all ✅ except SES ❌ (build via SNS). Separate streams: Calder ✅-target, Postmark ✅, Resend ⚠️ shared. Webhooks+signing+retry: all ✅ except SES ❌ (SNS/EventBridge). Inbound: all ✅ except Calder planned. Logs ≥30d paid: Calder ✅-target, Resend ✅, Postmark ⚠️ tiered, Mailgun ⚠️ tiered. Dedicated IP: all ⚠️/✅ paid; Calder later. Naira billing + local rails: Calder ✅-target, ALL others ❌. WAT support: Calder ✅-target, all ❌. Free tier usable: Calder ✅-target ≥3k, Resend ✅ 3k, Postmark ❌ 100, SendGrid ❌ trial, Mailgun ❌ trial, Brevo ✅ 9k.

## Pricing at volume (USD, Oct 2026 snapshot)

| Volume | Resend | Postmark | SendGrid | Mailgun | SES | Brevo | Mailtrap | MailerSend | Sendly NG |
|---|---|---|---|---|---|---|---|---|---|
| Free | 3k/mo | 100/mo | trial only | trial | credits | ~9k/mo | 4k/mo | 500/mo | 3k/mo |
| 50k/mo | $20 | ~$50–55 | $19.95 | $35 | ~$5 | ~$29–39 | $20 | ~$35 | $8 |
| 100k/mo | $90 | ~$100–115 | $89.95 | $75–90 | ~$10 | ~$69–129 | $30 | ~$68 | $30 (200k incl) |
| Overage/1k | $0.90 | $1.20–1.80 | ~$0.90–1.30 | $0.80–1.30 | $0.10 | tiered | $1.00–0.55 | $0.90–1.50 | incl |

Nigeria angle: all globals bill USD via card — no Naira, no bank transfer. At ~₦1,500–1,600/$ (illustrative, recheck before publishing), $20 = ₦30–32k + FX fees. A ₦-denominated starter with Paystack/Flutterwave + transfer beats a $2-cheaper USD plan on collectability. Do not compete with SES on raw $/1k; compete on total cost (SES $10/100k + engineering days + FX/card risk > flat Naira + included suppression/logs/webhooks).

## Where Calder loses today

Deliverability reputation/history; compliance certs (SOC2/ISO/HIPAA/DPA); deliverability lab (seed tests, validation); scale proof/SLAs; ecosystem/integrations; log-retention depth; template/migration gravity; raw price floor vs SES/Plunk/Mailtrap.

## Where Calder can win (realistic)

1. Naira-native billing + collectability (nobody in top 6 does it; ship day one, not "coming soon").
2. WAT human support + DNS hand-holding + Resend-compat migration.
3. Generous-but-sustainable free tier (3k/mo, full API+webhooks — beats Postmark/SendGrid/Mailgun/MailerSend).
4. Single-product simplicity (one API, one log, one webhook contract, one bill).
5. Trustworthy transactional defaults (separate streams, auto-suppression, List-Unsubscribe, complaint guardrails) with friendly local vetting.
6. Debuggability as feature (30-day logs paid, per-message timeline, webhook redelivery).
7. SendGrid-exodus + Resend-price-hike harvesting (60-day cliff, 100/day caps) priced between Mailtrap and Resend in Naira terms.
8. Local trust signals (Lagos presence, WAT status page, NDPR posture, pool-protection strictness as deliverability story).

## Positioning (one sentence)

**Calder: the Nigeria-first transactional email API — Resend-simple sending with Naira billing, WAT human support, and deliverability defaults that get Nigerian product email to the inbox.**

## Table-stakes (email MVP — no launch without)

REST send + SMTP relay; scoped/rotatable keys; test vs live; SPF/DKIM/DMARC wizard + verifier; versioned templates + plaintext fallback; pre-send suppression + import/export + List-Unsubscribe; separate transactional/bulk identities; signed/retried/redeliverable webhooks + event API; searchable logs (free 3–7d, paid ≥30d) + per-message timeline; rate limits + idempotency + caps; inbound parse→webhook (lightweight); domains/keys/templates/logs/webhooks/suppression/team/audit dashboard; complaint/bounce guards + Postmaster onboarding; Naira+USD billing with local rails + VAT receipts; public status page + diagnosable failures; TLS/secrets/tenant-isolation/NDPR-DPA; Resend/SendGrid/Postmark migration path.
