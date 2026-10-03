# 02 — Launch checklist (email scope, gated)

Every item links to a finding in 01-AUDIT.md. No item without a finding; no finding without an item (traceability table at the end).
Owner note respected: email only. SMS/OTP/push/inbound-marketing excluded; email-OTP status lock included as a claim-hygiene item.

## Gate 0 — private alpha (3 trusted people)
Calder may enter Gate 0 when: no false claim is reachable by a visitor, a spammer cannot burn the shared reputation, backups exist and restore has been drilled once, and rollback is written down. Alpha is free-only and the site says so.

### Workstream: Brand & landing (critical path)
- [ ] SMTP-001a — Relabel every live-SMTP mention "coming soon" and remove SMTP from plan feature lists (or ship gateway; relabel is the 1-day path). Why Gate 0: false claim reachable today. Who: coding agent. Effort: S (2–4h). Depends: none. Done means: `rg -i smtp apps/web/lib/plans.ts apps/web/components` shows only coming-soon language; dashboard + marketing agree; host string single value. Verify: re-run rg + visual check. Critical path: yes.

### Workstream: Abuse (critical path)
- [ ] ABUSE-001a — Day-1 abuse floor: disposable-domain block on signup, reduced day-1 sending caps for new orgs, bounce-rate + complaint-rate auto-pause. Why Gate 0: one malicious signup can suspend shared SES. Who: coding agent. Effort: M (3–5d). Depends: none. Done means: integration tests prove disposable signup rejected, over-cap send rejected with explainable error, org auto-paused at thresholds, audit-logged. Verify: run new tests + manual spammer-sim. Critical path: yes.
- [ ] ABUSE-001b — Admin suspend-org / revoke-key endpoint + runbook. Why Gate 0: no instant kill-switch. Who: coding agent. Effort: S (1–2d). Depends: ABUSE-001a. Done means: founder can suspend org and revoke all its keys with immediate effect (cache-bypass), audit-logged, appeal path documented. Verify: suspend test org, confirm sends fail closed. Critical path: yes.

### Workstream: Ops (critical path)
- [ ] OPS-001a — Backups on + restore drilled + RPO/RTO written. Why Gate 0: data loss with no runbook. Who: me (provider console) + coding agent (docs). Effort: S–M. Depends: hosting decision (see 03-OWNER). Done means: PITR enabled, one restore to scratch DB succeeds, RPO/RTO in OPERATIONS.md. Verify: drill log + screenshot. Critical path: yes.
- [ ] OPS-001b — Rollback procedure written and rehearsed once. Why Gate 0: bad deploy bricks alpha. Who: coding agent + me. Effort: S (1d). Depends: none. Done means: DEPLOYMENT.md rollback section complete; one preview rollback rehearsed. Verify: rehearsal notes. Critical path: yes.

### Workstream: Billing (expectation-setting)
- [ ] BILL-001a — Mark paid plans "early access / contact us"; alpha explicitly free-only. Why Gate 0: prices displayed but not purchasable. Who: coding agent. Effort: XS (2h). Depends: none. Done means: pricing page + plans.ts label paid tiers early-access; no checkout-shaped UI that dead-ends. Critical path: no.

## Gate 1 — closed beta (20–50 real developers)
Calder may enter Gate 1 when: Gate 0 complete, Redis-backed queue enforced in staging/prod, error tracking + on-call exist, key expiry enforced, dead links gone, SDK story honest, SMTP claim fixed, dep-scan in CI with criticals triaged, warmup claim fixed.

### Security
- [ ] AUTH-002 — Session hardening: shorten TTL and/or rotate + document idle timeout. Finding AUTH-002. Who: agent. Effort: S. Depends: none. Done means: rotation or ≤7d TTL + tests; settings session list already exists. Critical: yes.
- [ ] KEY-001 — Enforce `expiresAt`, update `lastUsedAt`. Who: agent. Effort: S. Depends: none. Done means: expired key rejected in test; last-used visible in dashboard. Critical: yes.
- [ ] K-001 — Security headers on web + dashboard (CSP/HSTS/frame). Who: agent. Effort: S. Depends: none. Done means: `curl -I` shows headers on both apps. Critical: no.
- [ ] B-002 — Add project predicate to the two residual queries (`emails.ts:88-98`, `senders.ts:173-183`). Who: agent. Effort: XS. Depends: none. Done means: tests assert cross-project access impossible at both spots. Critical: yes.

### Email core
- [ ] SEND-001 — Require `REDIS_URL` in staging/prod (fail boot otherwise); InMemory dev-only. Who: agent. Effort: S. Depends: hosting/Redis decision (03). Done means: boot without REDIS_URL in prod errors loudly; docs updated. Critical: yes.
- [ ] DOM-002 — Remove "IP warmup" claim or scope Scale honestly. Who: agent. Effort: XS. Depends: none. Done means: plans.ts + site agree with code. Critical: no.
- [ ] DOM-001a — Surface SES sandbox + SNS-wiring state in dashboard with pre-send guard. Who: agent. Effort: M. Depends: none. Done means: unverified-identity send fails fast with explainable error before provider call. Critical: yes.

### Abuse / Ops
- [ ] SEC-001 — CI dep-scan + triage 4 criticals + reconcile SECURITY.md claim. Who: agent. Effort: M (scan XS, triage M). Depends: none. Done means: `ci.yml` has audit step; criticals fixed or waived with reason; claim true. Critical: yes.
- [ ] OPS-001c — Error tracking (Sentry-class) DSN + wired in api/worker/apps. Who: agent + me (account). Effort: S–M. Depends: owner creates project (03). Done means: test exception appears in dashboard with request_id. Critical: yes.
- [ ] OPS-001d — Minimal on-call + severity + postmortem template (OPERATIONS.md §53-57 boxes checked). Who: me + agent. Effort: S. Depends: none. Done means: doc names who gets paged and how. Critical: no.

### Product / DX
- [ ] UX-001 — Fix dead links (`/templates/new`, `/templates/:id`, `/pricing` from live UI); gate login step-2 on verify; re-audit uncommitted onboarding diff. Who: agent. Effort: S. Depends: none. Done means: crawler finds no dead internal links from app shell; step-2 waits for server. Critical: yes.
- [ ] DX-001a — SDK honesty: publish Node+Python or dashboard stays on curl; verify or drop Ruby/PHP. Who: agent + me (registry publish). Effort: M. Depends: owner npm/PyPI access (03). Done means: install-from-registry works and quickstart sample runs green. Critical: no.
- [ ] SITE-001a — Add 500/error boundaries to web + dashboard. Who: agent. Effort: S. Depends: none. Done means: forced-error route renders branded boundary in both apps. Critical: no.
- [ ] AUTH-001a (notifications part) — Security notification emails (password changed, new sign-in, key created/revoked, domain removed, member added) + welcome after verification. Who: agent. Effort: M. Depends: none. Done means: each event produces exactly one email; tests assert. Critical: no.

## Gate 2 — public launch
Calder may enter Gate 2 when: Gate 1 complete, commerce works end-to-end on real rails, MFA available, all MEDIUMs closed or scheduled with dates, Lighthouse + a11y pass, status page data-driven, legal deletion/export tested, load test done.

### Security / Legal
- [ ] AUTH-001b — TOTP MFA for dashboard. Finding AUTH-001. Who: agent. Effort: M. Depends: none. Done means: enroll/verify/recover tested; recovery codes. Critical: yes.
- [ ] AUTH-003 — Remove unverified-account oracle. Who: agent. Effort: XS. Done means: identical generic response; code silently resent. Critical: no.
- [ ] KEY-002 — Slow-hash new API keys; require pepper in prod; reconcile prefix semantics. Who: agent. Effort: S–M. Depends: migration for existing keys. Done means: new keys argon2/scrypt; prod boot fails without pepper. Critical: no.
- [ ] LEGAL-001 — Tested deletion/export runbook + retention table; DPA ready to send. Who: agent + me. Effort: M. Depends: owner legal review (03). Done means: export + delete executed against scratch account end-to-end; retention timetable published. Critical: yes.

### Email core / deliverability
- [ ] SEND-002 — Email replay endpoint + dashboard button + audit log. Who: agent. Effort: S. Depends: none. Done means: exhausted job replayed to new delivery; logged. Critical: no.
- [ ] DOM-001b — SPF/DMARC verification like DKIM; re-verification when records vanish. Who: agent. Effort: M. Depends: DOM-001a. Done means: dashboard shows SPF/DKIM/DMARC per domain; vanishing record flips status + notifies. Critical: yes.
- [ ] D-001 — Batch efficiency (single-query suppression + quota pre-check). Who: agent. Effort: S. Depends: none. Done means: 100-msg batch does O(1) suppression queries; quota failure atomic-skips with clear code. Critical: no.
- [ ] D-002 — Per-transport tracking truth documented + surfaced. Who: agent. Effort: XS. Done means: docs + dashboard state what Gmail vs SES tracks. Critical: no.
- [ ] HOOK-001 — Dual-secret webhook rotation overlap + schedule `aggregate-usage` + analytics purge. Who: agent. Effort: S. Depends: none. Done means: rotation keeps old secret valid for overlap window; cron scheduled; purge runs. Critical: no.
- [ ] B-001 — Central tenant helpers called or deleted. Who: agent. Effort: S. Depends: none. Done means: zero dead authz helpers; coverage on helpers. Critical: no.
- [ ] C-001/C-002 — Cursor pagination everywhere; error format uniform. Who: agent. Effort: M. Depends: none. Done means: no unbounded list endpoint; all errors carry `request_id`. Critical: no.

### Billing (commerce)
- [ ] BILL-001b — Real checkout + provider webhook verification on live rails. Who: agent + me + external (Bachs approval). Effort: L (2–4 wks incl. approval). Depends: 03 owner actions. Done means: test purchase settles; webhook flips subscription; receipts issued. Critical: yes.
- [ ] BILL-002 — Self-serve upgrade/downgrade/cancel + refunds + credit ledger (PRD §20). Who: agent. Effort: M–L. Depends: BILL-001b. Done means: each flow tested incl. failed payment + refund + ledger audit. Critical: yes.
- [ ] BILL-003 — Margin math signed off (SES $/1k + infra + support vs price at full usage per plan; flag losers). Who: me (inputs) + agent (table). Effort: S. Depends: owner finance inputs (03). Done means: PRICING.md gate table complete; any losing plan repriced or capped. Critical: yes.

### Ops / trust
- [ ] OPS-002 — Alerting wired to one channel + status page data-driven + metrics sink. Who: agent + me. Effort: M. Depends: error-tracking (Gate 1). Done means: alert fires to email/Slack on rule breach; status reflects `/ready` + queue depth. Critical: yes.
- [ ] TEST-001 — Coverage gate on critical paths + one e2e (signup→key→send→webhook) + recorded full typecheck/lint/build. Who: agent. Effort: M. Depends: none. Done means: CI fails below threshold; e2e green; outputs saved. Critical: yes.
- [ ] P-001 — Lighthouse + a11y pass + bundle budget; 1440/390 screenshots attached. Who: agent. Effort: S. Depends: none. Done means: scores recorded; no new regression allowed. Critical: no.
- [ ] DX-001b — OpenAPI regenerated + complete; quickstart samples all run green. Who: agent. Effort: S. Depends: none. Done means: spec matches routes; sample matrix in N-area all PASS. Critical: no.
- [ ] OTP-LOCK — Lock email-OTP status (PRD §9 vs ROADMAP conflict) and label accordingly. Who: me (decision) + agent (labels). Effort: XS. Done means: one status everywhere; no premature claim. Critical: no.

## Gate 3 — first 30 days after launch
Calder operates in Gate 3 when public. Items: daily abuse-metric review (bounce/complaint/velocity per org) for 30 days; weekly restore-spot-check; first postmortem published internally even if "no incidents" (prove the process); pricing/margin review at real usage; support inbox SLA measured; competitor re-check (Sendly NG status, Resend pricing) quarterly.

- [ ] G3-001 — Abuse review cadence (daily week 1–2, twice-weekly week 3–4). Finding ABUSE-001. Who: me. Effort: ongoing. Done means: 30-day log; at least one threshold-tuning from data. Critical: yes.
- [ ] G3-002 — Restore spot-check + incident-process proof. Finding OPS-001. Who: me + agent. Effort: S. Done means: one restore to scratch; one postmortem filed. Critical: no.
- [ ] G3-003 — Unit-economics review at real usage; reprice or cap losers. Finding BILL-003. Who: me. Effort: S. Done means: margin table with actuals. Critical: yes.

## Recommended order + realistic 30-day timeline

- Days 1–2: SMTP-001a, BILL-001a, DOM-002, OTP-LOCK (claim hygiene; all XS/S, unblocks honesty).
- Days 3–7: OPS-001a/b (backups+rollback), ABUSE-001a/b (abuse floor + kill-switch) — parallel tracks; owner runs hosting/error-tracking accounts in parallel (03).
- Days 8–14: SEND-001, KEY-001, B-002, AUTH-002, UX-001, SEC-001, SITE-001a, K-001 — beta hardening batch.
- Days 15–21: DOM-001a, AUTH-001a, DX-001a, internal beta with 5 users; fix fallout.
- Days 22–30: expand to 20–50; BILL-001b approval track starts (long pole); Gate 2 work (MFA, SPF/DMARC, replay, pagination, legal runbook, e2e, Lighthouse) begins in priority order.
- Public launch follows commerce (BILL-001b/002/003) + MFA + legal + load test — not within 30 days unless Bachs approval is already in hand (ask owner; see 03).

## Traceability (finding → item)

ABUSE-001→ABUSE-001a/b,G3-001; SMTP-001→SMTP-001a,SITE-001a-note; BILL-001→BILL-001a/b; BILL-002→BILL-002; BILL-003→BILL-003,G3-003; OPS-001→OPS-001a/b/c/d,G3-002; OPS-002→OPS-002; SEC-001→SEC-001; AUTH-001→AUTH-001a/b; AUTH-002→AUTH-002; AUTH-003→AUTH-003; KEY-001→KEY-001; KEY-002→KEY-002; SEND-001→SEND-001; SEND-002→SEND-002; DOM-001→DOM-001a/b; DOM-002→DOM-002; HOOK-001→HOOK-001; B-001→B-001; B-002→B-002; C-001→C-001; C-002→C-002; D-001→D-001; D-002→D-002; K-001→K-001; O-001→HOOK-001; LEGAL-001→LEGAL-001; UX-001→UX-001; DX-001→DX-001a/b; TEST-001→TEST-001; SITE-001→SITE-001a; P-001→P-001; OTP-LOCK→OTP-LOCK.
