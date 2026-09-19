# CALDER ROADMAP TO PRODUCTION

*The single guide from current state to production. Replaces all prior roadmap content (2026-09-19). Part A = full evidence audit. Part B = phased build order with milestones, exit criteria, and the Gmail protection track. Rules: no phase starts until prior milestones meet exit criteria; every milestone ends BUILD → UNIT → INTEGRATION → E2E → MANUAL → FAILURE → SECURITY → UI → PROD-LIKE → DONE; not done unless CI is green.*

*Categories: **A** Intended · **B** Implemented · **C** Partial · **D** Broken · **E** Missing · **F** Obsolete · **G** Unclear. Status: NOT STARTED · PARTIAL · IMPLEMENTED · BROKEN · UNVERIFIED · PRODUCTION READY · OBSOLETE.*

*Counts (verified 2026-09-19, commit `9bf5cd9`): 4 apps (api, dashboard, web, worker — no smtp-gateway); ~14 packages; ~0018 Drizzle migrations; 60 control pages, all server-guarded; 25 test files (unit-level, integration gated on live Postgres); 0 TODO/FIXME markers in apps/packages.*

---

# PART A — PROJECT AUDIT

## 1. Executive Summary

**Where is Calder today?** A working single-send pipeline (auth → validate → persist → enqueue → worker → SES/Gmail) with real auth, real tenant isolation, a real happy-path customer dashboard, and a mostly-live, unusually honest Control Plane — on infrastructure that cannot report what happened to mail (no event ingestion), cannot bill for it (no metering), and cannot prove domain ownership (verification theater).

**Genuinely working (B):** password/OTP/magic-link/OAuth with sound crypto (`packages/auth`); session seal/expiry/revocation; tenant scoping on every customer read checked; 60/60 control pages server-guarded; API-key auth with test/live prefixes; payload validation; worker delivery with retries; sender identities; Gmail OAuth onboarding; template versioning; waitlist funnel with confirmation versioning; first-party beacon; onboarding wizard end-to-end.

**Incomplete (C):** queue (no replayable DLQ, drain races itself); worker (cap overcounts, narrow transient classifier); domains (create real, verify fake); webhooks (registry real, delivery absent); usage page (reads tables nobody writes); health score invented; audiences (real counts, wrong labels).

**Broken (D):** webhook secret hashed-then-discarded (customers can never verify HMAC); idempotency race → duplicate sends; `test` keys deliver real mail in prod; forgot-password step 2 verifies nothing; `/templates/new`, `/templates/:id`, `/pricing` are 404s linked from live UI; `/control` + `/control/growth` 500 on repeat render (function prop into client charts).

**Biggest risk:** delivery-truth gap — no SNS route, no `provider_events` table, no signature verification → `delivered/bounced/complained/opened/clicked` write-dead. Bounces never auto-suppress (SES reputation risk), panels show zeros, complaint/bounce alerts can't fire, abuse detection blind. Second: economics — `usage_records` has zero writers, no aggregation cron; pricing sells unenforced limits.

**Stop building immediately:** new control scaffolds, marketing-stream UI, surfaces reading the same four email states. Every new page widens the show-vs-know gap.

**Next:** Phase 0 correctness repairs (one session), then delivery truth (ingestion → states → suppression), then metering. See Part B.

## 2. Repository / Architecture Map

### 2.1 Applications

| App | Deploy | Contents (verified) | Status |
|---|---|---|---|
| `apps/web` | Vercel | Marketing pages, pricing from `lib/plans.ts`, beacon collector (`lib/analytics.ts` → `POST /v1/beacon`) | B, gaps: no Lenis, GSAP decorative, forked logo, zero `@calder/ui` |
| `apps/dashboard` | Vercel (:3001 local) | Customer `(app)` + `/control` + auth pages/API; reads via `getTenantContext` (ADR-015 BFF) | B/C — happy path real, 7 placeholder routes |
| `apps/api` | Vercel serverless (esbuild bundle, fetch-object per ADR-029) | 14 routers: emails, batch, senders, domains, templates, keys, webhooks-registry, suppressions, beacon, waitlist, admin, cron/drain, health + auth/rate-limit/admin middleware | C — ingest real, feedback absent |
| `apps/worker` | Long-lived host | Consumes `email:send` only + health server; transport chain; Gmail caps; SES/mock | C — see §7 |
| ~~`apps/smtp-gateway`~~ | — | DOES NOT EXIST (ARCHITECTURE §2 lists it; `docs/SMTP.md` honestly "specified, not implemented") | E |

### 2.2 Packages

| Package | Contents | Status |
|---|---|---|
| `auth` | sessions, scrypt passwords, OTP, magic-link, OAuth, API keys, Gmail-connect, unsubscribe HMAC, authorization helpers | B, gaps §11 |
| `db` | Drizzle ~0018 migrations. HAS: users(+`platform_role`), orgs, `organization_members` (not `memberships`), projects, api_keys, emails(+`senderIdentityId`, unique project+idempotency), email_events, idempotency_keys, senders, domains, templates(+versions), suppressions, subscriptions/plans/plan_prices, usage_records (**unwritten**), waitlist_* (+confirmation drafts/versions), analytics_events. MISSING: smtp_credentials, provider_accounts/events, credit_ledger | B/C |
| `queue` | `createQueue` (BullMQ iff REDIS_URL else InMemory), retry helpers, string-match `isTransientError` | C — no replayable DLQ construct |
| `providers` | SES sender, Gmail sender (+MIME, token refresh, revoked surfacing), Mock; `resolveEmailProvider` prod fail-closed | C — no SNS ingress |
| `email` | `pickDefaultTransport` (active-default-wins, fail closed), `GMAIL_FREE_DAILY_CAP=400`, domain-verification stub | C |
| `validation` | Send schema (refines, 1MB caps, 10 att/25MB, scheduled ≤1yr), beacon batch ≤20 | B |
| `rate-limit` | Sliding-window **IN-MEMORY ONLY** (`auth 20/min`, `otp 5/min`, `beacon 120/min`); Redis limiter referenced, never built | C |
| `billing` | Abstraction + mock (`cs_mock_*`); HMAC TODO | E (scaffold) |
| `ui` | Tokens (`ink/paper/surface/muted`, `calderBlue #1E3A8A`, `signal #3D5AFE`, spacing, radius, fluid type) + Button/Input/Card/Badge/Logo | B-defined, ~0% adopted (logo only) |
| `config` | Zod env schema (source of truth; `.env.example` drifted — §10) | B |

### 2.3 Verified request path

```
REST:  Client → auth(key→tenant) → rate-limit(POST only) → validate
       → suppression? ★SKIPPED single-send → quota? ★ABSENT
       → persist emails{queued}+events{queued} → idempotency? RACE
       → enqueue {emailId,projectId} → 202 (replay stored 200)
Worker: load row (★missing → SYNTHETIC SEND — must die)
       → suppression check (real, fail-closed) → transport chain
       (sender→project default→global) → Gmail cap? (overcounts)
       → SES/Gmail/mock → emails{sent|failed|suppressed}+events
       → enqueue webhook:deliver → ★NO CONSUMER (piles up)
Truth: ★NO SNS INGRESS → delivered/bounced/complained/opened/clicked never written
Money: ★NO USAGE WRITES → no aggregation → no enforcement → billing unreconcilable
```

### 2.4 Env / CI / local dev (verified)

- Root `.env` is the dev config but Next loads app-dir env — export in shell or the app runs on defaults (localhost PG/Redis, mock provider). `DATABASE_URL` contains `&`: naive `source .env` breaks it.
- Local infra: Postgres :5432 + Redis :6379 (docker compose). Audit verification ran against LOCAL db, never Neon.
- CI `verify`: typecheck + lint + `format:check` + unit tests. Integration tests skip without `RUN_INTEGRATION_TESTS=1` + live Postgres → CI never proves pipeline joints. **Add a Postgres service to CI.**
- Vercel previews per PR (web/api/dashboard); worker needs AWS creds on host; `ALLOW_DEV_LOGIN` must stay unset in prod; `CRON_SECRET` must be set in prod.

## 3. Feature Inventory (full)

| # | Feature | Area | Frontend | Backend | DB | Integration | Tests | Status | Dependencies | Next action |
|---|---|---|---|---|---|---|---|---|---|---|
| 3.1 | Password signup/login + sessions | Auth | IMPL | IMPL | IMPL | — | unit+gated-int | PROD READY | — | Logout-everywhere + revoke-on-reset (M6.1) |
| 3.2 | Email OTP | Auth | IMPL | IMPL | IMPL | SES | unit+gated-int | PROD READY | creds | Pepper code hash (L1) |
| 3.3 | Magic-link | Auth | IMPL | IMPL | IMPL | SES | unit+gated-int | PARTIAL | creds | Limit callback GET; alert on masked NOT-deliverable |
| 3.4 | OAuth Google/GitHub | Auth | IMPL-if-configured | IMPL | IMPL | consoles | gated-int | PROD READY | creds | H4 review: unverified-email link branch |
| 3.5 | Forgot-password | Auth | PARTIAL | IMPL | IMPL | SES | none@step2 | BROKEN-UX | — | Step 2 must verify-without-consume (M0.3) |
| 3.6 | Founder/platform roles + guards | AuthZ | IMPL | IMPL | IMPL | — | unit | PROD READY | FOUNDER_EMAILS prod | Add grant reason; don't swallow audit errors |
| 3.7 | Onboarding wizard | Customer | IMPL | IMPL | IMPL | API, DNS | unit-state | PROD READY | — | Reference implementation |
| 3.8 | Composer + send | Customer | IMPL | IMPL | IMPL | queue/provider | none-e2e | PARTIAL | pipeline | Inherits ingest gaps; else complete |
| 3.9 | REST send API | API | — | PARTIAL | IMPL | queue | unit-sanitize | PARTIAL | — | M0.1 + M2.2 |
| 3.10 | Idempotency keys | API | — | BROKEN-race | IMPL | — | none | BROKEN | — | Atomic claim (M0.1) |
| 3.11 | Queue Redis/BullMQ | Infra | — | PARTIAL | — | Redis | inmemory-only | PARTIAL | REDIS_URL | Replayable DLQ; drain lease (M0.2) |
| 3.12 | Worker SES/Gmail | Pipeline | — | PARTIAL | IMPL | SES/Gmail | none-e2e | PARTIAL | creds | Kill synthetic-send; cap metric; classifier (M0.2) |
| 3.13 | SES event ingestion | Pipeline | — | MISSING | MISSING | SNS+config sets | none | MISSING | AWS | KEYSTONE (M1.1) |
| 3.14 | SMTP gateway | API | PLACEHOLDER | MISSING | MISSING | TCP/TLS | none | MISSING | ADR-014 | Deferred; gate on truth+metering |
| 3.15 | Webhook delivery | API | IMPL-registry | BROKEN | PARTIAL | customer URLs | none | BROKEN | signer+consumer | Secret-once (M0.3) + engine (M3) |
| 3.16 | Domain verification | Domains | IMPL | BROKEN-no-DNS | IMPL | DNS/SES | none | BROKEN | TXT+SES | Real verify (M4.1–M4.2) |
| 3.17 | Sender identities | Domains | IMPL | IMPL | IMPL | — | unit+int | PROD READY | — | None |
| 3.18 | Gmail onboarding | Domains | IMPL | IMPL | IMPL | Google | gated-int | PROD READY | creds | Hardening track §G (M2.4–M2.5) |
| 3.19 | Templates (customer) | Customer | PARTIAL-read | IMPL | IMPL | — | none | PARTIAL | UI | Build /new + /:id + test-send (M5.2) |
| 3.20 | Suppressions (customer) | Customer | PLACEHOLDER | IMPL | IMPL | bounce-auto | none | PARTIAL | ingestion | Manager UI (M5.1); auto-fill (M1.2) |
| 3.21 | Inbox | Customer | PLACEHOLDER | MISSING | — | inbound none | none | MISSING | parser | Defer; remove or keep gated |
| 3.22 | Logs/Deliveries | Customer | IMPL-nosearch | IMPL | IMPL | ingestion | none | PARTIAL | search/page | Query+pagination+filters (M5.1) |
| 3.23 | Analytics (customer) | Customer | PLACEHOLDER+fake | MISSING | — | tracking | none | MISSING | decision | Honest upsell NOW (M0.3); real post-launch |
| 3.24 | Usage page | Customer | IMPL-wrong-period | MISSING-writers | IMPL-unwritten | metering | none | PARTIAL | M2.1 | Period filter + writers + cron |
| 3.25 | Team route / Settings CRUD | Org | PLACEHOLDER/IMPL | IMPL | IMPL | — | none | PARTIAL | — | Consolidate; real plan lookup (M5.2) |
| 3.26 | Audit logs view | Org | PLACEHOLDER | IMPL-writes | IMPL | — | none | PARTIAL | read UI | Render own trail (M5.1) |
| 3.27 | API keys manager | Develop | IMPL | IMPL | IMPL | — | none-e2e | PROD READY | — | Shared confirm (M7.2) |
| 3.28 | SDKs / SMTP pages | Develop | PLACEHOLDER | —/MISSING | — | — | none | PARTIAL | content/gateway | Real-key snippets (M5.2); fix instruction (M0.3) |
| 3.29 | Webhooks manager | Develop | IMPL | PARTIAL-reg | IMPL | delivery | none | PARTIAL | M3 | Registry done; value after engine |
| 3.30 | Billing actions (control) | Billing | SCAFFOLD-honest | MISSING | PARTIAL-no-ledger | Bachs | none | MISSING | metering | Reads real; actions post-launch |
| 3.31 | Broadcasts (control) | Comms | REAL-CLI-honest | PARTIAL-admin | IMPL | ADMIN_API_KEY | unit | PARTIAL | UI (deferred) | Fine as-is |
| 3.32 | Campaigns/Aud/Auto | Comms | SCAFFOLD | MISSING | MISSING | mktg infra | none | MISSING | everything | Defer |
| 3.33 | Alerts evaluator | Control | IMPL-live | IMPL | IMPL | ingestion | none | PARTIAL | ingestion | 3/8 rules unfireable until M1.2 |
| 3.34 | Flags/maintenance/status | Ops | SCAFFOLD-static | MISSING | MISSING | — | none | MISSING | decision | Defer UI |
| 3.35 | Marketing suite | Marketing | MISSING | MISSING | MISSING | — | none | MISSING | launch | Deferred; scrub implying copy |
| 3.36 | Cron drain | Infra | — | C-duplicated | IMPL | Vercel cron/secret | none | PARTIAL | — | Lease + dedupe (M0.2) |
| 3.37 | Beacon ingest | Web/API | IMPL | IMPL | IMPL | — | unit | PROD READY | — | Exemplary (no PII, silent-fail, capped) |
| 3.38 | Waitlist + confirmation versions | Growth | IMPL | IMPL | IMPL | SES | unit | PROD READY | — | Pattern to copy (draft→publish→immutable) |
| 3.39 | Email editor (control) | Control | IMPL | IMPL | IMPL | queue | none-e2e | PARTIAL | — | From-addresses from config; else done |

## 4. Customer Product Audit (per route)

| Route (file) | Verdict | Evidence |
|---|---|---|
| `/` overview (`app/(app)/page.tsx`) | REAL +1 cosmetic | `getTenantContext` + scoped group-by/counts + recent 10 + domain check. COSMETIC: hardcoded `Sending/Webhooks/API ok:true` (:43-47); quota hardcoded 5000 (:37) |
| `/onboarding` (wizard + 8 actions) | REAL | saveProfile/createOrg/createProject/createTestKey/listTransports/sendFirstEmail(real API POST)/addDomain/**real resolveTxt**/complete; all `assertProjectAccess` |
| `/emails` | REAL | `resolveProject` + scoped senders + scoped mails + event counts |
| `/emails/new` (composer) | REAL | Membership + sender-verified checks; suppression block (:76-86); insert + event + enqueue/delayed + touch |
| `/templates` | PARTIAL | Read real. `/templates/new` (:27) → 404; `/templates/:id` (:37) → 404; "preview/test send" copy unbuilt |
| `/senders` + `/[senderId]` | REAL | Domain-enforced create, Gmail create, default/rename/enable/delete, testSend persist+enqueue; detail counts |
| `/inbox` | PLACEHOLDER | Static PlanGate only, zero DB imports |
| `/webhooks` | REAL-registry | Scoped list; https+allowlist validation; `encryptSecret`, secret shown once; enable toggle scoped |
| `/keys` | REAL | list/create/revoke all `assertProject`; secret-once UI |
| `/sdks` | PLACEHOLDER | Static pills + hardcoded snippet; no project/key/copy/DB |
| `/smtp` | PLACEHOLDER + dead instruction | Static; "Create in API Keys → SMTP" (:11) targets UI that doesn't exist |
| `/logs` | REAL-read / search MISSING | Scoped `emailEvents` read; "Search by request_id…" copy (:40) with no input; limit 30, no pagination |
| `/domains` | REAL | Scoped select; adder + `checkDomainDns` real |
| `/integrations` | PLACEHOLDER (1 real link) | Gmail → working `/senders`; GitHub/Vercel static "Soon" |
| `/deliveries` | REAL-read / filters MISSING | Scoped select + group-by; "coming next" chips display-only; no date picker |
| `/analytics` | PLACEHOLDER + fake numbers | Static gate; hardcoded `99.42%/48,291/2.1%` (:18-27) — most trust-damaging placeholder in app |
| `/suppressions` | PLACEHOLDER (worst gap) | Static "That's good"; zero reads despite table existing + composer enforcing it; no list/lift/remove |
| `/usage` | REAL + caveats | Live email count + `usageRecords` + plans/prices reads. BUT counts all-time as monthly; admits cron not running; hardcoded `PLAN_QUOTAS`; `/pricing` link → 404; no upgrade action |
| `/team` | PLACEHOLDER | Static PRO gate; real CRUD lives only in `/settings` |
| `/audit-logs` | PLACEHOLDER | Static PREMIUM gate; writes exist (`member.invited/role_changed/removed`), no view |
| `/settings` | REAL | getTeam + callerRole check; invite (dup-check, sha256 token, 7d expiry, audit); role change (last-owner guard); remove; revoke; wired forms |
| `/invite/[token]` | REAL-preview | Real tokenHash lookup (valid/accepted/expired/invalid); attach at sign-in |
| `/login` (all modes) | REAL +1 bug | Password/OTP/magic-link/OAuth/forgot-1+3 all backed. **BUG:** step-2 advances client-side without verifying code (final POST still enforces — UX-only) |
| `/signup` | REAL | signup + OTP send + verify wired; OAuth links |
| `/admin` | Redirect | `redirect("/control")` legacy shim |
| Marketing suite (campaigns/audiences/contacts/segments/automations/unsub) | MISSING (correctly) | No routes; hits are control-only post-MVP surfaces + waitlist status + one template string |

**Dead links/forms:** `/templates/new`, `/templates/:id`, `/pricing` (PlanGate ×2 + usage), SMTP instruction target, logs search, deliveries filters, unimported `magic-link-form.tsx` (delete). **Tenant scoping:** no unscoped customer read found — all reads start at `getTenantContext` + narrow by project; the gap is inverse (5 routes read nothing). `authorization.ts` helpers unused by dashboard — safety rests on convention; WHERE-clause audit of 6–8 read pages scheduled (M6.2).

## 5. Control Plane Audit (per section; guards 60/60 verified)

| Section | Guard | Verdict | Detail |
|---|---|---|---|
| Overview/Command Center (`control/page.tsx`) | `overview` | REAL | Fully live (billing, customers, db/redis/queue health, traffic, waitlist, conversions, CTAs, sources, confirmations, alerts) with per-dataset `safe()` fallbacks + anti-fabrication copy. ⚠️ Repeat-render 500 (function `footer` prop into client `TrendChart`) |
| Growth overview/acquisition | `growth` | REAL | Live traffic/waitlist/conversion/CTA/source/country; bounce honestly `—`; one labeled roadmap panel |
| Waitlist list/detail/export | `growth` | REAL | Live rows/position/invites/converted/referrer; mutations real (`setWaitlistStatus/addTag/removeTag/setNote` + audit + revalidate, analyst rejected); CSV streams paginated |
| Referrals | `growth` | REAL + scaffold | Live top-referrer/stats; zero-valued rewards panel inside `Planned` (spec, not metric) |
| Customers users/orgs/projects | `customers` | REAL | Live totals/rows/counts; org filters match real `TIERS`; 360° org detail + **plan-grant real but NOT founder-only** (any operator — tighten or document) |
| User/org detail | `customers` | REAL + dead stub | Live detail; lib `userDetail` has unrendered `sql\`false\``/null stub (remove) |
| Customer health | `customers` | PARTIAL | Tables live. Invented `100−5×struggling` score (:43) + illustrative "17/9" cohorts (:121) — compute or reword |
| Support | `customers` | SCAFFOLD | Zero queries; `Planned` bullets only |
| Broadcasts | `communications` | REAL-honest | Live audiences + ADMIN_KEY check; send via CLI curl (no fake UI mutation) |
| Audiences | `communications` | PARTIAL | Live except per-plan `count:0` hardcoded (`queries.ts:1397`), one `void`ed query, mislabeled "inactive"/"users who sent" |
| Templates (confirmation) | `communications` | REAL | Direct materialized-row read + honest empty fallback |
| Delivery | `communications` | REAL | Internal-org sends last 30d + totals live, capped-and-labeled |
| Campaigns/Automations | `communications` | SCAFFOLD | Policy + `Planned`, no queries — correct for post-MVP |
| Billing overview/subs/plans | `billing` | REAL-reads | Live NGN prices/subs/rows; plan controls explicitly unbuilt ("lands with Bachs") |
| Coupons/credits/entitlements/invoices | `billing` | SCAFFOLD-honest | Spec-text examples (`LAUNCH50`, `$25`, `50,000→150,000`), "will never fabricate one" — keep as spec |
| Platform email/deliverability/usage/webhooks/API | `platform` | REAL/PARTIAL | Live totals/pipeline/transports/caps/failures/usage/webhook-stats/key-counts; API latency/errors Planned |
| Infra overview/redis/queues/workers/database/providers/cron | `infrastructure` | REAL | Live `version()`, db size, activity, uptime, table stats, `INFO`/`PING`, Postgres-derived queue state, throughput, fleet, caps; fail-closed fallbacks, never fake zeros |
| Storage/networking | `infrastructure` | SCAFFOLD-honest | Static topology + `Planned`; overview admits it |
| Logs/alerts | `observability` | REAL | Live event rows + counts; `evaluateAlerts()` pure live thresholds (delivery<97/95, complaints>0, bounces>3%, queue>5000/>15m, Redis, mem>80%, conns>80%, past-due>0) |
| Metrics/incidents | `observability` | SCAFFOLD | `Planned` only |
| Abuse/admin-access | `security` | REAL | Live candidates (`sent≥10 && bounce≥10%` etc.), totals, caps; live admin accounts + sessions. Ladder `count:1..6` ordinals restyle as steps |
| Security events/restrictions | `security` | PARTIAL | Live latest-12 audit rows + live suspended/revoked transports; dedicated streams + warn/limit/pause/suspend UI Planned |
| Operations (flags/maintenance/status) | `operations` | SCAFFOLD-honest | Hardcoded flags array, no DB/toggles; maintenance admits switches "must be real before rendered" |
| Administrators/roles/audit-logs | `administration` | REAL | Grant/revoke founder-only + self/founder-target blocked + audit-logged (no reason field — add); roles matrix renders from enforcement source (exemplary); audit rows live |
| Settings | `administration` | PARTIAL | Non-secret env presence live; one unconditional "configured" assertion to fix; runtime editor Planned |
| Email editor | `overview` | REAL | Draft→publish→version→restore→[TEST]-send real, audited, analyst-blocked, analytics-excluded; `Sarah` sample labeled; from-addresses hardcoded (→config) |
| No-access | — | REAL-shell | Role label + back link, no data |

**Lib:** `queries.ts` live w/ honest-zero stubs (opened/clicked 0 with UI disclaimer; bounced flattened into failed; unused `activeSubs:0`; audiences trio; dead userDetail); `analytics-queries.ts` live w/ `hasData` flags; `range.ts` pure + tested; `guard/roles/post-login` live enforcement. `stats.ts`/`alerts.ts`/`gate.ts`/`roles.test.ts` do not exist (docs fixed §18-audit). **NAV:** 52 hrefs, zero dangling; 5 unlisted detail/edit surfaces intentional.

## 6. UI/UX Audit

### 6.1 Token verdict: coherent definition, ~0% adoption

`packages/ui` tokens (ink/paper/surface/muted, two blues, spacing, radius, fluid type) match DESIGN.md — but `styles.css` exposes 6 vars only; spacing/radius/type/signal/success/warning/danger TS-only, never consumed; `Button/Card/Input/Badge` hard-code hex instead of tokens; dashboard imports only `CalderLockup`; control + web import zero components. Dashboard: **573 `style={{` + 465 hex literals** (wizard.tsx 104 inline styles). Token bugs: two blues no rule (`#1E3A8A` vs `#3D5AFE` across 4 files); missing shadow/focus/disabled/overlay/mono-surface tokens → every file invents (`#F0F0F0`, `#B5B5B5`, `rgba(11,12,14,.15)`).

### 6.2 Defects (P0 ship-blocking/a11y/destructive → P2)

**P0:** (1) 0/5 primitives adopted — every fix repeats ~40×; decide adopt-vs-deprecate once. (2) H1 anarchy 28/22/20 + drifting ledes — define `h1/page-title/section/label/mono`, codemod. (3) Zero real tables — div-grids fixed-ratio, no th/sort/keyboard, truncate at 390px — port `cp-table` + scroll wrapper. (4) `window.confirm` revoke (keys) vs hand-rolled two-step (senders) — one `ConfirmButton/DangerZone` with aria. (5) Contrast: `#B5B5B5` (~2.1:1), `#F0F0F0` hairlines, `#d4b06a` on white — lock muted/border floors, lint offenders. (6) Control charts dark-register on Paper (`#1e2126` gridlines near-invisible) + stale "Dark-surface" comment — re-tokenize.
**P1:** (7) No focus/disabled/error system (`:focus` hits 0 in `(app)`; one `role="alert"` repo-wide; 8+ bare selects). (8) 4-nav shell, no `aria-current`, dual tier-badge markup. (9) Fabricated analytics preview behind blur — violates never-fabricate rule. (10) Forked logo (ui vs web, "keep in sync" already drifted) — delete fork. (11) No `error.tsx`; global `loading` only; swallowed health `catch{}`. (12) Dead-end copy/links (§4 table).
**P2:** (13) Radius scatter 6/8/10/12/14/999 — enforce scale. (14) `info→accent` badge alias; gold off-token. (15) Web: Lenis mandated/absent, GSAP decorative entrance, pricing-grid template-y. (16) Empty-state illustration file unverified (`empty-state-narrative.webp` — 404 risk). (17) Deliveries/logs row grids nowrap-ellipsis with no expansion on mobile.

### 6.3 Duplication (fix once in primitives)

Primary-button literal ×6+ (`keys/manager:6`, `webhooks/manager:7`, `wizard:58`, `plan-gate:57/98/110`, `empty-state:88`, `emails/page:72`); input literal ×5+; status-color maps ×4 (incl. lowercase `#16a34a` drift); card shell ×8+; logo geometry ×2.

### 6.4 Surfaces

**Dashboard — poor, causes known.** Shell/hierarchy/density/typography/states/forms/tables/destructive/responsive/a11y all itemized above. **Web — strongest,** near DESIGN.md (tokens, type roles, editorial primitives, accent-as-signal, reduced-motion, no purple). **Control — best-engineered,** ADR-031 ~85% applied, consistent `cp-*` lib, real tables, honest empties.

## 7. Core Logic Audit (with locations)

| Capability | Verdict | Key evidence |
|---|---|---|
| Send validation | B | Schema refines, caps, attachment limits (`packages/validation`) |
| API-key auth/scoping | B | SHA-256+pepper, timing-safe, revocation, tenant attach; legacy `avenor_sk_` compat |
| Test/live isolation | D | `env` carried, never branches; test keys deliver in prod |
| Idempotency | D | Replay works; concurrent same-key duplicates (non-atomic claim + no conflict path on unique index) |
| Suppression | C | Worker/composer/batch enforce; single-send ingest skips (`// In production` comment); bounces never auto-fill |
| Queue/retries | C | Redis/BullMQ + backoff real; no replayable DLQ; drain bare-`UPDATE` claim races |
| Transports/caps/SES/Gmail | C | Chain real; cap counts non-sent rows (overcounts); narrow transient match; **synthetic-send on missing row** (`worker.ts:280-296`) |
| Delivery truth | E | No SNS route/tables/verify; 5 enum states write-dead; no config sets |
| Webhooks | D | Registry real; secret discarded (`routes/webhooks.ts:23-32`); `webhook:deliver` consumer absent; 2/8 events enqueued |
| Usage/quotas | E | Zero writers; no cron; nothing enforced anywhere in `apps/api/src` |
| Billing | E | Reads + mock only; no ledger; launch-check gates SES quota not customer quota |
| Domain verify | D | `POST /:id/verify` marks verified unconditionally; provider passes `token==="verified"`/test only |
| Senders/Gmail/templates | B | Resolver fail-closed + touch; OAuth min-scope + encrypted tokens + idempotent reconnect; versions + latest-wins render + strict missing-variable 400s (no staged publish) |
| Sessions/auth | B + gaps | Seal/expiry/revocation sound; scrypt + dummy-hash; OTP hashed/10m/5-attempt; magic 256-bit/15m/single-use; OAuth state/PKCE + invite accept + founder bootstrap. Gaps: no lockout (20/min forever); no logout-everywhere; reset doesn't revoke; callback GET unlimited; **unverified-email OAuth link (possible takeover — confirm provider guarantees first)**; unsalted OTP hash (1M space) |
| Rate limiting | C | Present on mutations (ip+email keys); InMemory only (multi-instance multiplies); GET sends open; one-bucket-not-per-dimension; blind `x-forwarded-for` |
| Audit logging | B | Real writes (invites/roles/waitlist/editor); customer view missing; grant reasonless; swallowed write errors |
| Cron | C | One logical job in two 320-line twins (API + dashboard, drift risk); no lease; no billing/webhook/purge crons; `x-vercel-cron`-without-secret footgun |

## 8. End-to-End Flow Audit (✓ works · ✗ breaks · ○ missing)

- **A — New developer:** signup→workspace→project→key→sender→first send→queued/sent reflection ✓; never passes `sent` ✗; usage all-time-vs-quota ✗; domain "verified" unproven ✗; inspect-delivery (search/filter/page) ○.
- **B — API developer:** key→request→queue→worker→provider-accept→queued/sent/failed events ✓; test/live identical ✗; idempotency race ✗; narrow classification ✗; webhook enqueued-never-consumed ✗; terminal states ○; webhook delivery ○; usage write ○.
- **C — SMTP:** entirely ○ (spec + placeholder + dead instruction). Do not advertise.
- **D — Domain setup:** add/instructions/DNS-check ✓; final verify theater ✗; SES linkage ○. Users finish believing proof exists.
- **E — Waitlist:** beacon→DB→versioned confirmation→provider→control analytics/export ✓✓ — the loop that closes; copy the pattern.
- **F — Founder:** login→role→`/control`→Command Center→growth/users/platform ✓; repeat-500s ✗; plan-grant not founder-only ✗; 3 alert rules unfireable ○-effective; 4 scaffolds ○-honest.

## 9. Fake / Placeholder / Mock Data Audit

| Occurrence | Location | Verdict |
|---|---|---|
| Analytics preview `99.42%/48,291/2.1%` | `(app)/analytics/page.tsx:16-29` | REPLACE (honest upsell) |
| Overview `Sending/Webhooks/API ok:true` | `(app)/page.tsx:43-47` | REPLACE (probe or remove) |
| Health `100−5n` + "17/9" cohorts | `control/customers/health:43,121` | REPLACE (compute or reword) |
| Audiences `count:0` + `void` + mislabels | `lib/control/queries.ts:1345-1413` | REPLACE (compute/label honestly) |
| Abuse ladder `1..6` ordinals | `control/security/page.tsx:78-83` | REPLACE (restyle as steps) |
| Coupon/credit/entitlement examples | billing scaffolds | KEEP (labeled spec, not metrics) |
| `userDetail` `sql\`false\``/null | `queries.ts:372-380` | REMOVE (dead, unrendered) |
| `dash-soon` branch, `magic-link-form.tsx` | dashboard | REMOVE (dead code) |
| Editor `Sarah` + `[TEST]` sends | `editor-actions.ts` | DEV-ONLY-OK (analytics-excluded by construction) |
| Mock provider/`mock_` IDs/jitter/beacon IDs/DUMMY hashes | providers/queue/api/auth | BENIGN or DEV-ONLY-OK (prod fail-closed verified) |
| `seed-demo.ts` 3.8k deterministic rows | `packages/db` | DEV-ONLY-OK WITH GAP: env-guarded not DB-guarded; FK-broken — fix both |
| Editor from-addresses | `email-editor-client:152,156` | REPLACE (config/DB) |
| Domain `mock_` token | `api/routes/domains.ts:44` | REPLACE (only fake DNS token in repo) |
| TODO/FIXME/lorem in apps/packages | — | NONE FOUND (clean) |
| Fabricated opens/clicks/revenue in control | — | NONE FOUND (protect the discipline) |

## 10. Documentation Audit

**Fixed in this audit:** CONTROL-PLANE phantom `gate.ts`/`stats.ts`/`alerts.ts`/`roles.test.ts` → `guard.ts`, `queries.ts`, `stats.test.ts`, `post-login.test.ts`; `control.css` ADR-029 → ADR-031.
**Contradictions remaining:**
- ARCHITECTURE §2 lists `apps/smtp-gateway` as a service — filesystem has api/dashboard/web/worker only; `docs/SMTP.md` + SYSTEM-EXPLAINED honestly say "specified, not built". **BLOCKING-CONFUSION** — mark planned-vs-present.
- ARCHITECTURE §3 entity list names `smtp_credentials`, `provider_accounts/events`, `memberships` (real: no such tables; members table is `organization_members`) and omits `sender_identities`, `project_transports`, `analytics_events`. **MINOR-STALE** — regenerate from schema.
- SYSTEM-EXPLAINED §2 describes GLOBAL provider routing — superseded by sender-aware delivery + ADR-026 (its own changelog admits it). **BLOCKING-CONFUSION.**
- SYSTEM-EXPLAINED §8c "six steps" vs "five steps" same section; migration count `0000-0002` vs ~0018; body trails changelog. **MINOR-STALE.**
- AGENTS.md: queue rule ("never synchronously") vs ADR-021 inline auth mail — needs the exception; "no DB from frontend" vs ADR-015 tenant-helper BFF — rephrase to "only via tenant helper"; idempotency rule overstates (sends/charges only in reality); microservice-trigger pointer justifies the unbuilt gateway. **Agent-behavior-relevant.**
- DESIGN.md §3 accent "hex not locked" vs ADR-016 locked `#3D5AFE`/`#1E3A8A`; §8 Lenis mandate vs zero adoption — one side must change in each pair.
- `.env.example`: "Avenor" header; missing `CRON_SECRET`, `ALLOW_DEV_LOGIN`, OAuth IDs, `API_KEY_PEPPER`, `DB_POOL_MAX`, `ALLOWED_ORIGINS`; documents `ENCRYPTION_KEY` config doesn't parse. Reconcile against `packages/config`.
- DEPLOYMENT: `ADMIN_API_KEY` "required" vs optional-disable code (503-honest); undecided-hosting section vs decided-Vercel-serverless section.
- CONTROL-PLANE §5 "verified live 23/23" snapshots read as standing guarantees; depend on FK-broken seed — date-stamp, de-absolutize.
- Founder emails: three identities across docs/seed/tests (`emerald@calder.click` vs `oluwadare458@gmail.com`) with no "example only" note — bootstrap confusion + PII-smell. Canonicalize to one documented example.
**Undocumented:** `CRON_SECRET`/`ALLOW_DEV_LOGIN`/OAuth/`PEPPER`/`POOL`/`ORIGINS` envs; `/v1/beacon`, `/v1/admin/*`, `/v1/cron/drain` ops; BullMQ queue names; bundle + launch-check ops; dev-login backdoor (changelog-only); sender/transport model (code+changelog only, no stable spec); `INTERNAL_FROM` allowlist; seed-vs-seed-demo story + volume gotchas.
**Missing for newcomers:** control implementation map refresh; SMTP truth-in-one-place; schema registry; env inventory table; endpoint+job inventory; founder-bootstrap canonical example.

## 11. Architecture & Security Risks (severity = actual consequence)

**CRITICAL**
- **C1 Domain self-verification** (`api/routes/domains.ts:68-85`) — any key holder verifies any domain, no DNS. Spoofing primitive; fix before reputation matters.
- **C2 Delivery truth absent** — no SNS ingress; bounces/complaints unprocessed; SES reputation unmonitored, unsuppressed. Operational-existential.
**HIGH**
- **H1 Test keys deliver in prod** — `env` never branches. Reputation + contract breach in one confused customer.
- **H2 No metering/quotas** — unlimited sends per tier; billing unreconcilable; abuse unbounded.
- **H3 Webhooks broken** — secret discarded (unverifiable by design); no signer/consumer/retry/replay; `webhook:deliver` piles up.
- **H4 OAuth unverified-email link** (`oauth.ts:179-184`) — links on attacker-controllable unverified provider email? Confirm guarantees first; possible takeover. No fix without confirmation.
- **H5 Idempotency race** — concurrent same-key duplicates via non-atomic claim + catch-all-enqueue.
- **H6 Synthetic-send fallback** (`worker.ts:280-296`) — fabricates mail for missing rows. Delete; fail closed.
**MEDIUM**
- **M1** Suppression skipped at single-send ingest (checklist violation). **M2** In-memory limiter (multi-instance multiplies); GET sends open; no per-dimension limits; blind forwarded-for. **M3** Drain twins + no lease (scheduled double-send). **M4** No lockout/logout-everywhere/reset-revoke. **M5** Seed-demo prod-pollutable + FK-broken. **M6** `queries.ts` unguarded-import risk (safety by page-guard convention). **M7** Magic-link callback unlimited + misconfigured-prod masking. **M8** Cron accepts bare `x-vercel-cron` when secret unset.
**LOW**
- **L1** Unsalted OTP hash (1M space, 10-min window — pepper it). **L2** Dead prefix-length code. **L3** Narrow transient classifier. **L4** Gmail cap counts non-sent rows. **L5** Sender sub-fetch scoping (contained). **L6** No CSRF tokens (Lax-standard; document).

## 12. Launch Readiness

**LAUNCH BLOCKERS (reasoned):** (1) SES ingestion — "send and know" unkept without it. (2) Domain DNS verify + SES linkage — self-verify is a spoofing primitive. (3) Usage writers + quotas — pricing sells unenforced limits. (4) Test/live isolation — one branch. (5) Webhook secret-once + engine — registry without delivery is dead. (6) Idempotency atomicity — duplicates violate the API contract. (7) Synthetic-send removal — fabricated mail is a red line. (8) Suppression at ingest — checklist + ARCHITECTURE §9. (9) Drain lease + dedupe — scheduled double-send. (10) Prod env proof (FOUNDER_EMAILS, CRON_SECRET, SES feedback config, ALLOW_DEV_LOGIN unset, limiter topology). (11) UI trust repairs (fake preview, /pricing, templates 404s, SMTP instruction, reset theater). (12) Repeat-render 500s (founder's first screen must not 500).
**POST-LAUNCH (ordered):** error/loading states; logs search + deliveries filters; suppressions manager; customer audit view; /team consolidation; auth hardening (H4, logout-everywhere, reset-revoke, lockout, callback limit, pepper); replayable DLQ + replay; staged template publishing; grant tightening + reasons; seed FK + prod guard; queries hardening; read-page WHERE audit.
**NICE TO HAVE:** SDK snippets; GitHub/Vercel integrations; metrics/incidents; storage/networking probes; maintenance switches; status publishing; SDK libs; MCP/CLI; migration guides.
**LONG-TERM:** SMTP gateway (after truth + metering); marketing suite on separate streams (after launch + demand); inbound; failover/dedicated IPs/SSO/regional.

# PART B — ROADMAP TO PRODUCTION: PHASES & MILESTONES

*Build order. No phase starts until prior milestones meet exit criteria. Every milestone: BUILD → UNIT → INTEGRATION → E2E → MANUAL → FAILURE → SECURITY → UI → PROD-LIKE → DONE. Not done unless CI green.*

## Dependency graph (what must exist before what)

```
AUTH → WORKSPACE/PROJECTS → API KEYS → SENDERS+GMAIL → TEMPLATES → INGEST
  → TRANSPORT/CAPS → WORKER SEND → ★PROVIDER INGESTION (keystone)
  → TERMINAL STATES → LOGS truth + SUPPRESSION automation + ALERTS + ABUSE signal
  → USAGE METERING (parallel track) → QUOTAS → BILLING
  → WEBHOOK ENGINE → DOMAIN TRUST → DASHBOARD TRUTH → CONTROL COMPLETION
  → UI SYSTEM LANDING → SMTP / MARKETING / INBOUND (deferred, gated)
```

## PHASE 0 — Stop the bleeding (correctness in the live path)

> **STATUS (2026-09-19, implemented on `arena/01a0ba35-calder`):** M0.1 ✅ (claim-first idempotency tx, suppression 422 at ingest, prod fail-closed on persist failure) · M0.2 ✅ (synthetic-send deleted, single API drain with `FOR UPDATE SKIP LOCKED` lease + 10-min stale-claim recovery, dashboard twin + its Vercel cron deleted) · M0.3 ✅ (webhook secret shown once + one AES-256-GCM scheme, reset step-2 verifies without consuming, fake analytics preview replaced with honest copy, `/pricing` links resolved to the marketing site, SMTP page honesty, `magic-link-form.tsx` + `dash-soon` deleted). **Tests:** same-key concurrency (1 winner), sequential replay, suppression 422, drain overlap single-send, worker missing-row, secret round-trip, wrong-code, truth-gate fs-scan — all CI-blocking; CI now runs a Postgres service with migrations + `RUN_INTEGRATION_TESTS=1`. **Docs:** ADR-032/033/034, SYSTEM-EXPLAINED §2, API.md, SECURITY.md §6. **Left to later phases per plan:** worker↔drain chain duplication, test/live branching (M2.3), `/control` chart 500s (M7.3), templates 404s (M5.2), login-flow E2E (Phase 5).

**Goal:** the shipped pipeline stops doing wrong things. **Why now:** every later phase assumes these invariants; all small, in-shipped code, no AWS. **Prerequisites:** none.
- **Database:** none new (unique-violation handling in code).
- **Backend:** atomic idempotency (unique-violation → return stored 200); suppression check in single-send ingest (delete the skip comment by deleting the skip); delete synthetic-send branch (missing row → diagnosable `failed`); drain `SELECT FOR UPDATE SKIP LOCKED` lease; delete dashboard drain twin (single `apps/api` implementation); webhook secret returned once at creation; reset-verify verifies without consuming (or remove step 2).
- **Frontend:** analytics preview → honest upsell with zero numbers; `/pricing` links resolved (4 sites); SMTP instruction corrected to the real key flow; delete dead `magic-link-form.tsx` + `dash-soon` branch.
- **Infra/integration:** none (SES sandbox held).
- **Docs:** SYSTEM-EXPLAINED ingest paragraph corrected; CONTROL-PLANE changelog line.
- **Tests:** parallel same-key concurrency (one send); suppressed-recipient 4xx with reason; missing-row failure; overlapping drains single-send; secret-once round-trip; wrong-code-at-step-2 rejected; dead-link crawl; no-fabricated-numbers grep.
- **Manual:** curl matrix (202 / replay-200 / suppressed-4xx / revoked-401); dual-drain run; webhook secret shown exactly once.
- **Failure:** duplicate floods; DB-down ingest (fail closed + diagnosable); queue-down (no silent accept).
- **Security:** re-run §11 — expect H5/H6/M1/M3 cleared; no new bypass.
- **DoD:** new tests green; zero `// In production:` in send path; zero fabricated customer numbers; twins deleted.
- **Next-phase dependency:** trustworthy ingest for Phase 1.
- **Milestones:** M0.1 ingest correctness (idempotency + suppression) · M0.2 worker/drain safety (synthetic-send + lease + dedupe) · M0.3 trust repairs (secret-once, reset, preview, links, dead code).

## PHASE 1 — Delivery truth (SES ingestion → states → suppression → alerts)

**Goal:** every send reaches a terminal known state. **Why now:** keystone — suppression automation, alerts, abuse, logs truth depend on it. **Prerequisites:** Phase 0; AWS SNS topic + subscription + SES configuration set (console work).
- **Database:** `provider_events` (+`provider_accounts` if multi-account) via Drizzle CLI migration; idempotency on SNS message-id.
- **Backend:** SNS ingress route with signature verification (reject unsigned — test both); event → `email_events` + `emails.status`; bounce/complaint → `suppressions` auto-insert; dedupe on redelivery.
- **Frontend:** logs/deliveries render terminal states; bounce/complaint/queue-age alerts verified firing; health score redefined on real rates (remove `100−5n`).
- **Infra:** SNS→endpoint wiring in DEPLOYMENT runbook; ingress-error alerting.
- **Integration:** AWS sandbox + simulator addresses.
- **Docs:** endpoint inventory; ARCHITECTURE §8 liveness; runbook entry.
- **Tests:** signature accept/reject; duplicate-event dedupe; unknown message-id; bounce→suppression; complaint→suppression; full transition matrix.
- **Manual:** simulator seeds; watch terminal states land in dashboard + control.
- **Failure:** bad signature; replayed event; SNS outage (5xx → SNS retry, no loss); malformed payload.
- **Security:** SNS auth mandatory; no PII in logs; tenant-scoped event joins; complaint content never stored.
- **DoD:** sample sends reach `delivered` in-dashboard; simulator bounce/complaint auto-suppress; alerts fire induced.
- **Next-phase dependency:** honest product; abuse signal; Flow B completion.
- **Milestones:** M1.1 ingress+verify · M1.2 transitions+suppression automation · M1.3 truth surfaces + firing alerts.

## PHASE 2 — Metering, quotas, isolation + Gmail hardening

**Goal:** usage counted, limits enforced, test keys safe, Gmail exact. **Why now:** parallel track to Phase 1; required before paid/high-volume traffic. **Prerequisites:** Phase 0 (parallelizable with Phase 1).
- **Database:** metering writes on `usage_records` + period logic; idempotent aggregation cron.
- **Backend:** per-send usage writes (never on replay/test); ingest-time quota checks on REST/batch/scheduled/composer with upgrade pointer; `env` branches delivery (test → mock-persist, never provider).
- **Frontend:** usage page true monthly counts + real quota bars; upgrade route exists (provider later).
- **Integration:** prod-like env asserting test-key non-delivery.
- **Docs:** metering + quota semantics; pricing-copy reconciliation.
- **Tests:** metering-once (no double on retry/replay/scheduled); quota-block every path; test-key-no-delivery; period rollover; cron re-run idempotency.
- **Manual:** exhaust a test quota; test-key send in prod-like env → zero provider traffic.
- **Failure:** quota-boundary race; clock boundary; aggregation crash mid-run.
- **Security:** bypass attempts via batch/scheduled/composer; test-key abuse review.
- **DoD:** free-tier abuse bounded; test keys provably non-delivering; page truthful.
- **Next-phase dependency:** paid launch; abuse backstop.
- **Milestones:** M2.1 writers+aggregation · M2.2 enforcement · M2.3 isolation · M2.4 Gmail exactness (sent-not-created caps, per-project UTC-day accounting, graduation prompts, sender-pinning test, revocation test) · M2.5 Gmail abuse watch (velocity baselines → warn→limit→suspend+appeal audit-logged; connected-account inventory in control).

## PHASE 3 — Webhooks delivered

**Goal:** registry becomes a working feature. **Why now:** signing contract fixed in M0.3; independent of Phases 1–2. **Prerequisites:** M0.3.
- **Database:** `webhook_deliveries` writes (attempt, status, latency, next-retry).
- **Backend:** HMAC signer; `webhook:deliver` consumer with exponential backoff; retry schedule + dead-letter; rotation + replay endpoints.
- **Frontend:** per-webhook delivery log, replay button, secret rotation UI.
- **Integration:** customer test URL (webhook.site class).
- **Docs:** webhook guide (sign → verify → replay → rotate).
- **Tests:** signature vectors; retry-then-success; max-attempts dead-letter; replay dedupe; rotation invalidates old.
- **Manual:** create → receive → verify → break endpoint → recover → replay, unaided.
- **Failure:** endpoint down/5xx/slow/timeout; secret mismatch; oversized payload.
- **Security:** timing-safe verification; secret storage review; SSRF guard (private-range deny) on webhook URLs.
- **DoD:** full customer webhook lifecycle unaided.
- **Next-phase dependency:** Flow B "Receive" half.
- **Milestones:** M3.1 signer+consumer+retry · M3.2 log+replay+rotation UI.

## PHASE 4 — Domain trust

**Goal:** verification means proof. **Why now:** needs DNS + SES linkage; blocks production reputation. **Prerequisites:** Phase 1 recommended (bounce visibility).
- **Database:** challenge state machine (pending/verified/failed/expired) on domains.
- **Backend:** real TXT lookup; SES identity verification linkage; DKIM/SPF storage; cross-tenant verify denial; propagation-tolerant polling.
- **Frontend:** setup wizard with live DNS polling + failure diagnostics (expected record vs found vs fix).
- **Integration:** real test DNS zone; SES identity APIs.
- **Docs:** Flow D rewrite; theater copy removed.
- **Tests:** token mismatch; propagation delay; cross-tenant denial; expiry; SES-link failure.
- **Manual:** full Flow D on a real domain incl. a failing case with diagnosable UI.
- **Failure:** DNS timeout; SES throttling; apex-vs-subdomain edges.
- **Security:** takeover tests; token entropy; verify-attempt rate limits.
- **DoD:** unverified cannot reach verified; every step provable.
- **Next-phase dependency:** production sender reputation. (M4 hard gate: over-cap Gmail must verify a domain — §G.)
- **Milestones:** M4.1 real verification · M4.2 SES linkage + wizard.

## PHASE 5 — Dashboard truth

**Goal:** every customer pixel reflects the system. **Why now:** needs Phases 1–2 data. **Prerequisites:** Phases 1, 2.
- **Database:** none new. **Backend:** search/pagination params on reads (no new tables).
- **Frontend:** logs search + pagination; deliveries filters; suppressions manager (list/add/remove); own audit-log view; `/team` consolidation or removal; templates `/new` + `/:id` + preview/test-send; SDK snippets with real key injection + copy.
- **Tests:** tenant-isolation denial per new read; pagination correctness; **blocking CI gates:** dead-link crawl + no-fabricated-numbers grep.
- **Manual:** Flow A "inspect delivery" completable; every touched page at 1440 + 390.
- **Failure:** empty states for all new queries; forced query failure hits `error.tsx`.
- **Security:** WHERE-clause audit of the 6–8 read pages (with M6.2).
- **DoD:** zero dead in-app links; zero fabricated numbers; every route live or removed.
- **Next-phase dependency:** demoable, sellable product.
- **Milestones:** M5.1 observability reads · M5.2 templates/team/SDKs · M5.3 CI truth gates.

## PHASE 6 — Auth hardening + Control completion

**Goal:** production security posture; control fully operational. **Why now:** features complete; harden before scale. **Prerequisites:** Phases 1–5.
- **Backend:** H4 OAuth-link decision implemented + tested; logout-everywhere + session inventory; reset revokes sessions; lockout/progressive delay; magic-link callback limit; OTP pepper; cron secret mandatory in prod; Redis-limiter decision (document single-instance or build).
- **Frontend (control):** grant-reason field; plan-grant founder-restriction (or documented operator policy); settings presence-check fix; audiences counts/labels; abuse ladder restyle; health cohorts computed or removed.
- **Tests:** takeover-attempt; session inventory; lockout timing; grant-audit assertions; limiter effectiveness single-vs-multi.
- **Manual:** attack walkthrough of §11 H/M items, each cleared.
- **Security:** full §11 re-audit with sign-off.
- **DoD:** §11 H/M auth items cleared; least-privilege holds; no misleading control numbers.
- **Next-phase dependency:** production security sign-off.
- **Milestones:** M6.1 auth gaps · M6.2 control tightening + read-page audit.

## PHASE 7 — Design system landing (runs alongside 4–6)

**Goal:** one system, adopted. **Why now:** lands on real pages, not stubs. **Prerequisites:** adopt-vs-deprecate `packages/ui` decision taken first.
- **M7.1 Tokens + primitives.** Var emission (spacing/radius/type/shadow/focus/disabled/overlay), muted/border floors, blue roles documented; Table/Confirm/Field/ErrorText/Toast/Modal in the one system. *Exit:* new code uses primitives; contrast lint clean.
- **M7.2 Navigation + tables + forms.** Single nav with `aria-current`; `cp-table` port + scroll wrappers; shared controls; `window.confirm` gone. *Exit:* §17 orders 3–6.
- **M7.3 States + charts + responsive.** Per-route loading/error; charts re-tokenized (fixes the 500s); 390px pass. *Exit:* §17 orders 7–9.
- **M7.4 Page migration** in order: overview → emails/composer → senders → keys → logs/deliveries → settings → domains/webhooks → rest. *Exit:* >80% adoption; zero new inline hex.

## 15. Exact Implementation Order (numbered, dependency-linked)

1. Delete synthetic-send → fabricated mail is a red line; test missing-row fails closed.
2. Atomic idempotency → duplicates violate the contract; concurrency test.
3. Ingest suppression check → checklist + ARCHITECTURE §9; blocked-with-reason test.
4. Drain lease + delete twin → overlapping drains double-send; overlap test.
5. Webhook secret-once → verification otherwise impossible; round-trip test.
6. Reset step-2 truly verifies → fake gates erode trust; wrong-code test.
7. Preview/links/SMTP-instruction/dead-code → backend honesty (1–6) must show; crawl + grep gates.
8. Phase-0 matrix green → nothing downstream trustworthy otherwise.
9. SNS ingress + signature → all truth depends on it; forgery tests.
10. Transitions + suppression automation → events must change state; dedupe + simulator tests.
11. Truth surfaces → truth must be visible; induced-alert tests.
12. Usage writers + aggregation → independent of ingestion; once-only + rollover tests (parallel with 9–11).
13. Quota enforcement all paths → limits must bind; block tests.
14. Test/live branch → reputation safety; prod-like non-delivery proof.
15. Gmail exactness + abuse watch → wedge must be exact and defended; cap/pinning/velocity tests.
16. Signer + consumer + retry → registry without delivery is dead (needs 5); vector/retry tests.
17. Delivery log + replay + rotation → self-serve (needs 16).
18. Real domain verification → proof before reputation; denial tests (9 recommended first).
19. SES linkage + wizard → linkage completes trust (needs 18).
20. Logs search + filters + suppressions manager + audit view → Flow A closes (needs 10, 12).
21. Templates routes + team consolidation + SDK snippets → 404s die (time only).
22. CI truth gates → discipline automatic (needs 7, 21).
23. OAuth-link fix + logout-everywhere + reset-revoke + lockout + callback limit + pepper → hold at scale; attack tests.
24. Limiter topology + cron-secret mandatory → multi-instance changes math (needs prod topology).
25. Control tightening + queries hardening + WHERE audit → least-privilege + honesty (needs 23).
26. Design-system decision + M7.1 → all UI flows from it; before 27–28.
27. M7.2–M7.3 → pages compose from primitives (needs 26; lands on 20–21 pages).
28. M7.4 migration → adoption completes (needs 27).
29. Full regression Flows A–F + failure matrix prod-like → launch needs proof (needs 1–28).
30. Launch-gate review → go/no-go with evidence (needs 29). ONLY THEN: SMTP, marketing, inbound as separate slices.

## 16. Testing Strategy (when each runs)

- **Unit** (every PR): pure functions — validation, retry math, role/redirect, chart math, signature vectors. CI-blocking. Already decent; keep.
- **Integration** (every phase; ADD Postgres to CI so `RUN_INTEGRATION_TESTS=1` runs): sender resolution, Gmail persistence, sessions, OTP/magic-link, SNS verify+dedupe, metering-once, quota-block, drain lease, OAuth-link branches.
- **E2E staging** (every phase; SES simulator + real DNS + Redis): Flows A–F incl. failure matrix (invalid payload, bad/revoked key, duplicate idempotency, provider fail, timeout, retry, permanent fail, webhook down, DB/queue outage, quota hit, SNS replay, DNS timeout).
- **API contract** (Phase 0+): status codes, `{error:{code,message,request_id}}`, replay bytes-identical, suppression reason codes.
- **Worker/provider** (Phase 1+): SES error-code classification table; transport failover chain; cap boundary behavior.
- **Security** (Phase 6 + pre-launch): cross-tenant denial per read; takeover attempts; grant escalation; limiter single-vs-multi; SNS forgery; unauthenticated cron; webhook-URL SSRF.
- **UI** (Phase 5+): dead-link crawl gate; fabrication-grep gate; contrast lint; `error.tsx` presence gate; 390px screenshot pass on touched pages.
- **Regression pre-launch:** §12 blockers re-verified prod-like; rollback drill (migration down/up on staging).

## 17. UI Redesign Plan (system before pages)

1. Tokens: emit all vars; lock floors; document blues; lint raw hex. 2. Type roles + H1 codemod. 3. Primitives: decide ui fate; add Table/Confirm/Field/ErrorText/Toast/Modal/Skeletons; delete web logo fork. 4. Navigation: single source + `aria-current` + one badge. 5. Tables: `cp-table` port + scroll + pagination + sort on 5 list pages. 6. Forms: shared controls + labels + inline errors + focus/disabled; kill `window.confirm`. 7. Cards/stats/badges: one shell, one status map, unified badge vocab. 8. States: per-route loading/error; honest empties; no swallowed errors. 9. Charts: light-register re-token; hoist `footer` server-side (fixes 500s). 10. Drawers/modals/toasts for confirms/async feedback. 11. Command/search: deferred post-launch. 12. Suspense-wired skeletons per section. 13. Empty-state audit + illustration 404 check. 14. Diagnosable errors with request-ids. 15. 390px pass per migrated page.
- **Migration order:** overview → emails/composer → senders → keys → logs/deliveries → settings → domains/webhooks → rest.

## 18. Documentation Changes

Audit (§10 header): CONTROL-PLANE phantoms → real files; `control.css` ADR-029 → ADR-031. This file: full replacement with audit + phased plan (authorized). Proposed, awaiting decision: AGENTS.md queue exception (OLD "never synchronously" → NEW "+except ADR-021 auth mail" → WHY code contradicts rule); tenant-helper phrasing (OLD "no DB from frontend" → NEW "only via tenant helper" → WHY ADR-015 BFF); idempotency scope (sends/charges only); ARCHITECTURE §§2–3 planned-vs-present; SYSTEM-EXPLAINED §2 + counts + six/five-step; DESIGN.md hex + Lenis; `.env.example` reconciliation; DEPLOYMENT labels + hosting conflict; CONTROL-PLANE §5 de-absolutized; runbook (endpoints, jobs, seeds, bootstrap, bundle/launch-check).

## 19. What We Should Not Build Yet (with gates)

- SMTP gateway: relay without observability is liability. Gate: Phases 1–2 live.
- Marketing suite: no validation; needs ingestion/metering/separation. Gate: launch + paying-user demand.
- Inbox/inbound: no parser/storage/evidenced need. Remove placeholder instead.
- New control scaffolds (metrics/incidents/storage/networking/status): instrument need first.
- Coupons/credits/invoices/entitlements actions: no ledger/provider; spec text correct.
- Failover/dedicated IPs/SSO/regional: no scale evidence; ADR-007 unmet.
- AI layer/codemods/MCP/`doctor`: marketing before truth.
- DLQ replay UI: after the DLQ exists. Command/search, automations canvas, advanced analytics: deferred by design.

## 20. First Implementation Session (Phase 0 core)

**Slice:** correctness repairs in the live send path. **Files:** `apps/api/src/services/email-service.ts` (atomic claim, ingest suppression); `apps/worker/src/worker.ts` (delete synthetic-send); `apps/api/src/routes/webhooks.ts` (secret-once); `apps/api/src/routes/cron.ts` + delete `apps/dashboard/app/api/cron/drain/route.ts` (lease, single impl); `apps/dashboard/app/api/auth/email-code/verify/route.ts` + `login-form.tsx` (reset step-2). **Systems:** API ingest, worker, queue lease, webhooks registry, OTP. No AWS/DNS/tables. **Result:** no duplicates; suppressed blocked at API; missing rows fail closed; single-send drains; verifiable secrets; honest reset. **Tests:** concurrency, suppression-4xx, missing-row, overlap, secret round-trip, wrong-code (new, CI-blocking) + suite green. **Manual:** curl matrix (202/replay-200/suppressed-4xx/revoked-401); dual-drain run; secret shown once. **Unlocks:** Phase 1 lands on a pipeline that no longer corrupts what it will observe.

## LAUNCH GATE (go/no-go)

All 12 §12 blockers cleared + re-verified prod-like (real SES sandbox + simulator, real DNS, real Redis) · Flows A–F green incl. failure matrix · §11 CRITICAL+HIGH empty · Vercel prod env proof (`FOUNDER_EMAILS`, `CRON_SECRET`, SES feedback config, `ALLOW_DEV_LOGIN` unset, limiter topology decided) · seed-demo prod-guard + FK fixed · pricing copy == enforced behavior · zero fabricated numbers · rollback/migration procedure documented · §G safeguards live.

## POST-LAUNCH BACKLOG (ordered)

Metrics/incidents → storage/networking probes → maintenance switches → status publishing → staged template publishing → SDK libraries → GitHub/Vercel integrations → MCP/CLI → migration guides → SMTP gateway (gated: truth + metering) → marketing suite (gated: demand) → inbound → failover/dedicated IPs/SSO/regional.

## §G — GMAIL QUICKSTART: PROTECTED TRACK

*Why special:* no-domain, no-budget onboarding — the Nigeria-first wedge. Real mail in minutes via OAuth, then graduation to domains. Done safely, the moat; done loosely, a spam relay in our name.
*Present safeguards (verified):* minimum OAuth scope (`gmail.send` + identity, never passwords); AES-256-GCM tokens, in-memory-only decrypt; 400/day cap pre-send; sender pinning (only the connected address); revocation fail-closed with explicit `gmail_revoked`; no bulk by design + cap.
*Abuse scenarios → safeguard → milestone:* burst spam → velocity baselines + warn→limit→suspend+appeal, audit-logged → M2.5 · cap evasion across projects → per-project UTC-day accounting, exact sent-count metric → M2.4 · phishing via self-verified domain → M4.1 kills the primitive; Gmail senders pinned regardless → M2.4 pinning test · credential abuse → revocation surfacing + session review → M2.4/M6.1 · reputation contagion → per-account velocity flags + Gmail inventory dashboard in control → M2.5 · silent over-cap → graduation prompts (M2.4) → hard gate: over-cap Gmail must verify a domain (M4) · demo/prod bleed → seed Gmail transports never touch prod; launch-gate proof.
*PR rule:* any Gmail-path change states how it's abused, what stops it, what pages — or it doesn't merge.




