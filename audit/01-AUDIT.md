# 01 — Audit (email scope)

Date: 2026-10-02. Auditor: launch audit, evidence-backed. Scope per owner: **email only**.
Rule: code beats docs. Where they disagree, the finding says so.

## Verdict: NOT READY — not even private alpha without fixes

Plain English: the core email pipe (API → queue → worker → SES → events → webhooks) is genuinely built and mostly correct. Tenant scoping, suppression, idempotency, and webhook signing are real code, not slides. But five things make it unsafe to put even 3 trusted outsiders on it today: (1) the marketing site sells SMTP relay on every plan and SMTP does not exist; (2) nobody can pay you — billing is a mock, so Pro/Premium cannot be purchased and limits are admin-toggled; (3) there are no backups, no tested restore, no rollback procedure, no error tracking, no on-call plan — one bad deploy or one dead database ends you; (4) there is no abuse machinery beyond per-key rate limits — a spammer signup can burn your shared SES reputation and get your AWS account throttled or suspended; (5) dependency scanning claimed in SECURITY.md does not exist in CI, and `pnpm audit` shows 48 vulnerabilities (2 low / 25 moderate / 17 high / 4 critical). Fix the BLOCKERs, then 3 trusted users. Fix the HIGHs, then closed beta. Everything else gates public launch.

## Scorecard

| Area                                    | Status                                  | One line                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Auth & account security              | PARTIAL                                 | Hashing/sessions/magic-link/reset solid; no MFA; no security notification emails; 30-day sessions w/o rotation                                                                |
| B. Authorization & tenant isolation     | PARTIAL                                 | Every public endpoint scopes by project; central helpers are dead code (drift risk); 2 narrow residual spots                                                                  |
| C. API keys & public surface            | PARTIAL                                 | Hashing/prefix/scoping/idempotency/CORS/request-IDs real; expiry never checked; pagination gaps; OpenAPI stale                                                                |
| D. Sending core (email)                 | PARTIAL                                 | Pipe is real incl. retries/DLQ-state/suppression re-checks; InMemory default loses jobs; no email-replay endpoint                                                             |
| E. Deliverability & domains             | PARTIAL                                 | Ownership verify + DKIM + bounce/complaint wiring + suppression + RFC-8058 unsubscribe real; SPF display-only; no DMARC; no warmup; sandbox never blocks at runtime           |
| F. Abuse prevention                     | FAIL                                    | Per-key rate limits + Gmail caps exist; no signup friction, no disposable-email block, no auto-pause on bounce/complaint spikes, no suspend-org tool. A spammer can hurt you. |
| G. Architecture readiness (email scope) | PASS w/ notes                           | Provider abstraction real; message model email-wired; 9 decisions to lock now (see 08)                                                                                        |
| H. Webhooks & events / SMTP / inbound   | PARTIAL                                 | Webhooks genuinely good (sign/retry/replay/SSRF). SMTP: spec only, advertised as live — BLOCKER. Inbound: absent, OOS.                                                        |
| I. Billing, plans, unit economics       | FAIL (as commerce) / PASS (as metering) | Metering exactly-once and honest; but provider is mock — no checkout, no upgrade/downgrade/cancel self-serve, no refunds, no credit ledger; margin math unverifiable          |
| J. Infra, reliability, ops              | FAIL                                    | Env separation/migrations/pooling/health-checks real; backups/restore/RPO/RTO unchecked; rollback open; no error tracking; alerting not wired; no e2e coverage gate           |
| K. Secrets, deps, supply chain          | PARTIAL                                 | No committed secrets (verified); API security headers real; web/dashboard headers not found; dep-scan claim false; 48 vulns open                                              |
| L. Legal, privacy, compliance           | PARTIAL                                 | Legal pages exist and are honest; deletion/export is "ask support" with no tested path; DPA-on-request only                                                                   |
| M. Product UX & onboarding              | PARTIAL                                 | Wizard real with resume; dead links from live UI (`/templates/new`, `/templates/:id`, `/pricing`); login step-2 advances client-side w/o verifying                            |
| N. DX, docs, SDKs                       | PARTIAL                                 | `/v1/openapi.json` served live; route table matches; Node SDK tested-but-unpublished; Python tested; Ruby/PHP runtime-unverified                                              |
| O. Code quality & testing               | PARTIAL                                 | 80 unit tests pass, 57 integration skipped (no DB in this env); CI has Postgres + migrate before test; no coverage gate, no e2e job                                           |
| P. Marketing site, brand, trust         | PARTIAL                                 | Core claims honest w/ `status:"dev"` labels; SMTP-on-every-plan overstates; no 500/error boundary; status page static-but-honest                                              |
| Q. Color & identity                     | recommendation only                     | 3 palettes proposed, one recommended — see 06                                                                                                                                 |
| R. Competitors                          | done                                    | 11 email + 7 adjacent profiled with sources — see 05                                                                                                                          |
| S. Landing redesign                     | prototype only                          | Standalone prototype in `landing-redesign/`, renders, screenshots pending real browser — see 07                                                                               |

## Verification actually run (evidence/)

- `pnpm --filter @calder/api typecheck` → exit 0 (`tsc --noEmit`, 2026-10-02).
- Full `pnpm typecheck` → timed out at 180s (monorepo-wide; NOT VERIFIED clean — need: re-run with larger timeout or per-package).
- `pnpm --filter @calder/api test` → **80 passed, 57 skipped** (19 files: 9 passed, 10 skipped), ~59s. Skips are all `*.integration.test.ts` (need Postgres/Redis). Command output saved in `evidence/`.
- `git status` → one modified file: `apps/dashboard/app/(onboarding)/onboarding/layout.tsx` (uncommitted onboarding redesign; audit does not cover uncommitted diff — re-audit after merge).
- Secret scan (`rg` for private keys / `AKIA` / `sk_live` / `ghp_` / `xox-`, excl. node_modules/.git) → hits are all test fixtures, docs examples, and key-format validators — **no live secret committed**. `.env`/`.env.local` are git-ignored (`git check-ignore` confirms) and untracked; only `.env.example` (placeholders) is tracked. Local `.env` contains a `sk_sandbox_` Bachs key — sandbox prefix, untracked, low risk. Full-history `git log -S 'AKIA'` → only an integration-test diff, no key material. See `evidence/`.
- `pnpm audit --audit-level=high` → **48 vulnerabilities: 2 low / 25 moderate / 17 high / 4 critical** (incl. brace-expansion via typescript-eslint chain). Output saved in `evidence/`.
- Browser walkthrough (signup → verify → send → webhook): NOT VERIFIED — needs running Postgres+Redis+SES creds + real browser. Listed in NOT VERIFIED with exact requirements.
- Load test: NOT VERIFIED — needs staging + Redis. Listed below.

## Findings

Severity: BLOCKER = cannot show to anyone / HIGH = cannot launch publicly / MEDIUM / LOW.

### BLOCKERs

**ABUSE-001 [F] No signup friction; a spammer can burn your SES reputation (and your AWS account).** No disposable-email block, no new-account sending caps beyond per-key rate limits, no content heuristics, no auto-pause on bounce/complaint spikes, no admin suspend-org/key tool found. Evidence: rate limits only per-key/IP (`apps/api/src/middleware/rate-limit.ts:11-22`, preset 100/min `packages/rate-limit/src/index.ts:66`); Gmail caps exist (`packages/email/src/transport.ts:42`, enforced `drain.ts:149-158`) but non-Gmail new accounts have only quota ceilings (`packages/config/src/plan-limits.ts:22-27`). Why it matters: SES suspends senders with high bounce/complaint rates; one malicious signup can throttle the shared identity for every customer. Fix direction: disposable-domain blocklist + lower day-1 caps + bounce/complaint-rate auto-pause + admin suspend endpoint + abuse@ mailbox and runbook. Gate: 0.

**Implementation follow-up (2026-10-03):** The as-found statement above is preserved as the audit baseline. Phase 1 implementation now provides server-side disposable-domain account-creation blocking, a configurable org-wide new-account live-send cap, deterministic recent SES feedback auto-pause, a tested API/worker delivery gate, and founder/admin org suspension with all-project API-key revocation. Migration 0024 was applied in a temporary Postgres 17 integration run; API, worker, SES, password, magic-link, and OAuth integration tests passed. See `docs/PHASE1-ABUSE.md`, `audit/02-LAUNCH_CHECKLIST.md`, and `audit/04-RISK_REGISTER.md`. Residual launch obligations: owner validates production SNS/SES wiring, admin secret access, and daily reputation review; no live abuse was sent through the shared SES identity.

**SMTP-001 [H/P] SMTP relay is advertised as live on every plan; it does not exist.** Marketing `apps/web/components/smtp-section.tsx:18-20,64` + `plans.ts:62-75,94-110` sell "REST API + SMTP relay" in-plan; PRD §10b specifies `smtp.calder.com:587`. Reality: no `apps/smtp-gateway` dir, `docs/SMTP.md:1` "specified, not yet implemented", dashboard `smtp/page.tsx:28` "not available yet" (the dashboard is honest; the marketing site is not). Host even disagrees (`smtp.calder.click` vs `smtp.calder.com`). Why it matters: an SMTP buyer converts, then finds no host, no credentials, no docs path that works. That is a false claim, not a roadmap note. Fix direction: either build the gateway (ADR-014) or relabel every SMTP mention "coming soon" and remove it from plan feature lists. Gate: 0.

**BILL-001 [I] Nobody can pay you: billing provider is a mock.** `packages/billing/src/provider.ts:1-4` "Bachs candidate, pending validation. No fabricated calls"; `MockBillingProvider:48-83`; `packages/config/src/index.ts:49` "Bachs optional until validated". No checkout/webhook/portal route in `apps/api/src/routes/`. Plan changes are admin-only (`routes/admin.ts:248-278`). Why it matters: Pro/Premium prices are displayed but not purchasable; upgrade/downgrade/cancel/refund self-serve do not exist; PRD §20 credit ledger not found in code. Fix direction: validate Bachs (or chosen rail), implement checkout + provider webhook verification + self-serve change/cancel + ledger; until then mark paid plans "early access / contact us". Gate: 1 (beta can be free-only, but this must be explicit).

**OPS-001 [J] No backups, no tested restore, no rollback, no error tracking, no on-call.** `docs/OPERATIONS.md:45-51` (backup schedule, restoration tested, RPO, RTO, provider-outage runbook) all unchecked; `docs/DEPLOYMENT.md:290` rollback explicitly open; `rg sentry|posthog` across api/observability/ops/control docs = zero hits (pino logs only); `docs/OPERATIONS.md:53-57` on-call/severity/postmortem unchecked. SECURITY.md:53-55 admits posture "not yet formalized". Why it matters: one bad migration or one dead database = data loss with no runbook and no alert. Fix direction: managed-Postgres PITR + restore drill + rollback runbook + Sentry-class error tracking + minimal on-call/severity doc. Gate: 0 (backups+rollback), 1 (error tracking+on-call).

**SEC-001 [K] "Dependency scanning in CI" is claimed but absent; 48 vulns open.** SECURITY.md:42 claims scanning; `.github/workflows/ci.yml` = install→format→lint→typecheck→migrate→test→build, no audit step; no dependabot/renovate config. `pnpm audit` (2026-10-02): 48 vulns (2L/25M/17H/4C). Why it matters: you ship known-vulnerable deps while telling customers you scan. Fix direction: add `pnpm audit` (or OSV/Dependabot) to CI + triage the 4 criticals first + correct or fulfill the SECURITY.md claim. Gate: 1.

### HIGHs

**AUTH-001 [A] No MFA; no security notification emails.** No totp/webauthn/passkey in source; auth mail is OTP/magic only (`dashboard/lib/send-auth-email.ts:7-64`); no new-login/password-changed/key-created notifications. Severity HIGH for a platform that holds sending identity (account takeover = spam cannon). Fix direction: TOTP MFA for dashboard + notify on password change, new sign-in, key create/revoke, domain removed, member added. Gate: 2 (MFA), 1 (notifications).

**AUTH-002 [A] 30-day sessions without rotation or idle timeout.** `SESSION_TTL_MS=30d` (`packages/auth/src/session.ts:8`), no sliding refresh (only `lastSeenAt` touch), no rotation. Cookie flags otherwise correct (HttpOnly, Lax, Secure-in-prod, iron-session sealed). Fix direction: shorten + rotate on use + revoke list UI (UI partly exists in settings). Gate: 1.

**AUTH-003 [A] Unverified-account oracle.** Correct password on an unverified account returns `needsVerification:true` (`login/route.ts:62-74`) — confirms existence + password validity. Everything else is enumeration-safe (generic 401, always-`ok` signup/magic/reset). Low exploitability, but fix is cheap: return the same generic response and resend code silently. Gate: 2.

**KEY-001 [C] `expiresAt` on API keys is never checked; `lastUsedAt` never updated.** Column exists (`schema/api-keys.ts:22`) but `authMiddleware` ignores it (`middleware/auth.ts:62` checks only `revokedAt`); revocation itself is immediate and correct. Fix direction: enforce expiry + update last-used (async, non-blocking). Gate: 1.

**KEY-002 [C] Key hashing is fast SHA-256 with possibly-empty pepper.** `packages/auth/src/api-keys.ts:39-56` (`SHA256(pepper+secret)`, pepper `?? ""`). Prefix stored is 20 chars but lookup slices 32 (`:58-61`) — lookup is actually full-hash so it works, but the prefix column is decorative. Legacy `avenor_` honored forever. Fix direction: slow hash (scrypt/argon2) for new keys, require pepper in prod, reconcile prefix semantics. Gate: 2.

**SEND-001 [D] Default queue is in-process memory; jobs die with the process.** `packages/queue/src/index.ts:1-10` BullMQ iff `REDIS_URL` else InMemory; `queue.ts:178-190`. Durable row exists so cron drain can recover, but cross-process/API↔worker split requires Redis and crash-durability does not. Fix direction: require `REDIS_URL` in staging/prod (fail boot otherwise), document InMemory as dev-only (ADR-011 already says never-prod — enforce it). Gate: 1.

**SEND-002 [D] No email-replay endpoint for dead-letter.** OPERATIONS.md:42-44 promises dashboard-replayable DLQ; only webhook replay exists (`routes/webhooks.ts:139-168`). Exhausted jobs sit at `failed/exhausted` (`worker.ts:492-519`). Fix direction: replay endpoint + dashboard button + audit log. Gate: 2.

**DOM-001 [E] SPF display-only; no DMARC verification; sandbox never blocks at runtime.** DKIM is real (`ses.ts:157-196`, link/refresh routes); SPF guidance string only (`domains.ts:191`); DMARC unenforced; sandbox detection exists (`ses.ts:132-142`, launch-check) but rejection surfaces only as a send-time provider error. Fix direction: verify SPF/DMARC records like DKIM, surface sandbox state in dashboard with a pre-send guard. Gate: 2 (1 for the dashboard surfacing).

**DOM-002 [E] No warmup / dedicated-IP machinery despite Scale listing "IP warmup".** `plans.ts:171` claims it; no ramp logic in worker/drain/providers. Fix direction: remove claim or build throttled-ramp + dedicated-IP story (post-launch is fine, the claim is not). Gate: 1 (fix the claim).

**HOOK-001 [H, notes] Webhook rotation is single-secret; aggregate-usage cron unscheduled.** Rotation (`routes/webhooks.ts:87-104`) replaces one secret (no overlap window — rotating breaks in-flight verifications). `/v1/cron/aggregate-usage` has no `vercel.json` schedule (only drain does). Fix direction: dual-secret overlap + schedule the rollup. Gate: 2.

**BILL-002 [I] Plan limits honest in code, but downgrade/cancel/refund/ledger missing.** Ceilings match public table (`plan-limits.ts:23-26` ↔ `plans.ts` ↔ PRD); metering exactly-once (`usage.ts:86-119`); but no self-serve change/cancel/portal/refund/credit-ledger (PRD §20 "built with billing" — not found). `aggregate-usage` unscheduled (above). Currency display correct (separate NGN/USD points, no FX — `PRICING.md:40-48`), charging path unverifiable (mock). Fix direction: same as BILL-001 workstream. Gate: 2.

**OPS-002 [J] Alerting rules rendered but notification channels not wired; status page static.** `docs/CONTROL-PLANE.md:150-154` evaluates; `:219-220` email/Slack "scaffolded UI, not wired"; `apps/web/app/status/page.tsx:38-63` static "No incidents recorded yet" (honest, not data-driven). No metrics TSDB (DB-query projections only). Fix direction: wire one channel (email) + publish status from real checks before public launch. Gate: 2.

**LEGAL-001 [L] Deletion/export is "ask support" with no tested path.** `legal/privacy/page.tsx:41-46` promises export/deletion via support; no self-serve UI, no retention timetable, implementation NOT VERIFIED end-to-end. DPA "on request", SOC2 "scheduled" — honest. Fix direction: tested runbook + retention table + self-serve export; don't promise what support can't execute. Gate: 2.

**UX-001 [M] Dead links from live UI; login step-2 advances without verifying.** ROADMAP Part A residuals: `/templates/new`, `/templates/:id`, `/pricing` linked but missing; `/login` step-2 advances client-side (POST enforces, so UX-only). Onboarding wizard itself real with resume (`(onboarding)/onboarding/page.tsx:24-32`). Uncommitted onboarding redesign in working tree — re-audit after merge. Fix direction: fix/remove dead links, gate step-2 on verify response. Gate: 1.

**DX-001 [N] SDKs tested but unpublished; Ruby/PHP runtime-unverified.** `sdks/README.md:17-22` Node 13 tests, Python 14 tests, Ruby/PHP "authored; runtime-unverified … gem/Packagist pending"; `packages/sdk-node` 0.1.0 `publishConfig.public` but unreleased (ADR-042 owner-manual). Dashboard SDK hub must stay on curl until publishable. OpenAPI served live (`health.ts:32-34`) but stale (says webhook secret "hashed, shown never" — actually encrypted + shown once; missing admin/cron/ses/beacon/waitlist/unsubscribe paths). Fix direction: publish Node+Python, verify or drop Ruby/PHP claims, regenerate OpenAPI. Gate: 2 (publish), 1 (stop claiming unpublished).

**TEST-001 [O] No coverage gate, no e2e job; full typecheck unverified.** 53 test files; CI has Postgres service + migrate-before-test (good); but no coverage % gate, no e2e; full `pnpm typecheck` timed out at 180s in this audit (per-package api passes). Fix direction: coverage threshold on critical paths (auth/send/billing/webhooks/isolation) + one e2e (signup→key→send→webhook) + timed typecheck in CI. Gate: 2.

**SITE-001 [P] No 500/error boundary; SMTP overclaim (see SMTP-001).** 404 is branded and good (`not-found.tsx`); no `error.tsx`/`global-error.tsx` in web or dashboard. SEO/meta/favicon/sitemap/robots all present and correct (`lib/seo.ts`, `layout.tsx:7-32`, `sitemap.ts`, `robots.ts`). Fix direction: add error boundaries; fix SMTP claims. Gate: 1.

### MEDIUMs

- **B-001** Central tenant helpers are dead code (`authorization.ts:30-68`, `lib/tenant.ts:6-22`, zero call sites in api) — per-endpoint scoping is correct today (verified on all 16 mounts), but drift risk is real. Direction: call the helpers or delete them. Gate: 2.
- **B-002** Two narrow spots: `GET /v1/emails/:id` sender-enrichment query by `senderIdentityId` alone (`emails.ts:88-98`, safe only via FK); `PATCH /v1/senders/:id` second UPDATE without project predicate (`senders.ts:173-183`, relies on prior scoped read). Direction: add project predicate to both. Gate: 1.
- **C-001** Pagination gaps: keys/templates/domains/webhooks unbounded; suppressions hard LIMIT 200 (`suppressions.ts:14-30`). Direction: cursor pagination everywhere. Gate: 2.
- **C-002** Error-format inconsistency: `cron.ts:34,46` omit `request_id`, non-catalog code. Direction: route through catalog. Gate: 2.
- **D-001** Batch inefficiency: full suppression table scan per batch (`batch.ts:45-49`); no atomic batch quota pre-check (per-message `skipped`). Direction: single-query suppression check + pre-check quota. Gate: 2.
- **D-002** Tracking depends on SES config-set, no code injection: fine, but dashboard/API imply tracking generally; Gmail declares `supportsTracking:false`. Direction: document per-transport tracking truth. Gate: 2.
- **K-001** Web/dashboard security headers not found (API headers PASS: `middleware/security.ts:5-13`). Direction: add CSP/HSTS/frame headers to both Next apps. Gate: 1.
- **O-001** `aggregate-usage` + analytics-purge cron missing (see HOOK-001). Direction: schedule + implement purge. Gate: 2.
- **P-001** Lighthouse not run in browser (code signals good: `next/image` priority/blur, reduced-motion gates; risk: GSAP + WebGL + Lenis weight). Direction: run Lighthouse + set bundle budget. Gate: 2.

### LOWs

- Cookie `Lax` not `Strict` (acceptable for OAuth/magic-link GET flows); no `__Host-` prefix. `format:check` not confirmed in this pass (CI runs it). `pExpire`-every-op window roll in Redis limiter. Webhook consumer allows http while registry is stricter (document). `M4.1/M4.2` bookkeeping present but failure-message quality NOT VERIFIED in browser.

## What is genuinely good (verified only)

1. Tenant scoping is inline on every public endpoint (16 mounts checked) with unguessable IDs — not middleware-only. (`routes/*.ts` predicates + `admin.ts:11-31`, `cron.ts:9-22`)
2. Suppression is fail-closed on all four send paths (ingest 422, batch skip, worker re-check, drain re-check) with unique `(project,email)` and auto-insert on bounce/complaint. (`email-service.ts:190-226`, `worker.ts:283-315`, `drain.ts:324-344`, `ses-events.ts:471-487`)
3. Idempotency is durable and project-scoped with concurrent-409 replay, 24h TTL. (`email-service.ts:312-392,435-462`)
4. Webhook signing (HMAC-SHA256 `t,v1`, timing-safe, 300s tolerance), 8-attempt ladder (5s…6h), manual replay, SSRF guards at registry + consumer. (`webhook-consumer.ts`, `webhook-secrets.ts`, `webhook-url.ts`)
5. SES feedback: SNS SigV1 RSA + cert-origin + topic allowlist, ledger-first dedupe, sticky terminals, transient-bounce never suppresses. (`ses-events.ts`, `lib/ses-events.ts:259,283-358,386-409`)
6. Auth fundamentals: scrypt-64/salt-16k params + timing-safe verify; 15m single-use magic links (sha256-stored); 10m 5-attempt email codes; unverified-login blocked; reset burns challenge + revokes all sessions; progressive lockout + dual IP+email limiters. (`password.ts`, `magic-link.ts`, `email-code.ts`, `session.ts`)
7. Exactly-once metering (`ur_<emailId>` + `ON CONFLICT DO NOTHING`) separated from throttling counts; test-env never metered, never really sent. (`usage.ts:86-119`, `worker.ts:324-332`, `drain.ts:385-392`)
8. Honest surfacing where it counts: dashboard SMTP page says "not available yet"; status page says "no incidents yet" instead of fabricating uptime; marketing labels in-dev items `status:"dev"`; legal pages admit SOC2-unscheduled/DPA-on-request.
9. Migrations discipline: forward-only, journal-tracked, never-regenerate rule + migration-status gate + launch-check. (AGENTS.md rule, `migration-status.test.ts`, `scripts/launch-check.ts`)
10. 80 unit tests green; CI runs Postgres + migrate-before-test; OpenAPI served live from code.

## NOT VERIFIED (what is needed for each)

1. Browser walkthrough (signup→verify→login→key→domain→send→deliver→bounce→webhook→upgrade→delete). Needs: `docker compose up`, `pnpm db:migrate`, SES sandbox creds, test mailbox owner owns, Playwright/Chromium. All M-area statuses above rest on code, not rendered pixels.
2. Full `pnpm typecheck` (timed out 180s). Needs: re-run per-package or with larger timeout; record output.
3. `pnpm lint`, `pnpm build`, `pnpm format:check`. Needs: run + save outputs (this audit ran typecheck+tests+audit only).
4. Integration tests (57 skipped). Needs: Postgres + Redis (`RUN_INTEGRATION_TESTS=1`).
5. Load behavior at 10x/100x. Needs: staging + Redis + k6/Artillery script against `/v1/emails` + drain lag measurement.
6. SES production-access state, sandbox status, SNS wiring end-to-end (bounce/complaint into suppression). Needs: AWS console (owner) + test identities.
7. Bachs approval status, webhook verification, NGN settlement. Needs: owner/Bachs dashboard.
8. Backup restore drill, RPO/RTO numbers. Needs: hosting provider (owner).
9. TLS config, subdomain-takeover, source-map exposure on prod deployments. Needs: prod URLs (owner).
10. Lighthouse + a11y + 1440/390 screenshots of real site and landing prototype. Needs: browser (prototype screenshots pending — see 07).
11. Ruby/PHP SDK runtime behavior. Needs: `gem`/`composer` run of samples (or drop the claim).
12. Time-to-first-delivered-email on a fresh account. Needs: (1) above.
13. `TODO/FIXME` full count excluding `public/` (output-cap hit binary asset). Needs: `rg -l 'TODO|FIXME' apps packages --glob '!**/public/**'`.
14. Dashboard server-action coverage for tenant checks (B2 residual). Needs: read each `actions.ts` under `apps/dashboard/app/(app)`.
15. FX rate for NGN pricing math + SES $/1k input for margin table. Needs: owner finance inputs (see 03).

## Docs-vs-code mismatches (log)

- SMTP live (ARCHITECTURE §5b, PRD §10b, marketing) vs spec-only (`docs/SMTP.md:1`, no app dir, dashboard honest). → SMTP-001.
- "Dependency scanning in CI" (SECURITY.md:42) vs no step in `ci.yml`. → SEC-001.
- OpenAPI "secret hashed, shown never" vs encrypted + shown once. → DX-001.
- PRD §9 OTP "status undecided" vs ROADMAP "Email OTP IMPL/PROD READY". OOS for this audit; lock before claiming.
- `smtp.calder.click` vs `smtp.calder.com:587`. → SMTP-001.
- OPERATIONS DLQ replay promise vs no email-replay endpoint. → SEND-002.
- Marketing "IP warmup" (Scale) vs no code. → DOM-002.
