# Platform audit and hardening plan — November 2026

Status: **audit complete, no product code changed.** This document is the findings
report and the prioritised plan requested before any implementation begins.

Scope note: **Calder Inbox is postponed.** Inbound/inbox code that already exists
on this branch is documented as-is in §7 and is not expanded.

---

## 1. How this was produced

Every claim below was checked against the repository, not against older audits or
roadmap documents — several of those are stale (they are superseded by this file).
What was actually executed:

| Check                                   | Command                                                 | Result                          |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| Type safety (all 18 workspace projects) | `tsc --noEmit -p tsconfig.json` per project             | **18/18 clean**                 |
| Formatting (what CI runs first)         | `prettier --check "**/*.{ts,tsx,js,jsx,json,md,css}"`   | **FAILS on 2 files** — see F-01 |
| Unit tests, unit + integration          | `vitest run`, then again with `RUN_INTEGRATION_TESTS=1` | §6                              |
| Migrations                              | `tsx src/migrate.ts`, `tsx src/schema-drift.ts`         | 44/44 applied, drift clean      |
| Dashboard production build              | `next build`                                            | passes                          |
| Schema inventory                        | 71 `pgTable` definitions across 30 schema modules       | —                               |
| API surface                             | 23 route modules mounted under `/v1/*` + `/health`      | —                               |
| Dashboard surface                       | 100 `page.tsx` routes (product + control plane)         | —                               |
| Test inventory                          | 159 test files                                          | —                               |

"Verified" in this document means **executed in this sandbox** with a real
Postgres 17 and the integration gate open. Anything that needs AWS, a browser
session, or a deployed origin is classed as _implemented but unverified_ and is
called out explicitly — a green unit test is not production evidence.

---

## 2. Classification key

| #   | Class          | Meaning                                                                                                                       |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Verified**   | Implemented, covered by an executed test, and the test exercises the real dependency (Postgres).                              |
| 2   | **Unverified** | Implemented and tested in isolation, but the real dependency (SES, S3, SNS, DNS, browser, registry) has never been exercised. |
| 3   | **Partial**    | Some of the requirement exists; a named part does not.                                                                        |
| 4   | **Missing**    | No implementation.                                                                                                            |
| 5   | **Broken**     | Implemented and known not to work, with a reproduced root cause.                                                              |
| 6   | **Disabled**   | Implemented but deliberately not launched (`features.ts` says `coming_soon` / plan gate).                                     |

---

## 3. Scoreboard

| Area                                                            | Class | One-line verdict                                                                           |
| --------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| Authentication (password, magic link, OAuth, sessions, lockout) | 1     | Solid; 55 auth tests green with Postgres                                                   |
| Authorisation (org roles, project scoping, control-plane RBAC)  | 1     | Single permission sources, server-side                                                     |
| Users and profiles                                              | 3     | Fixed (§8d): account deletion with a typed confirmation and 7-day window                   |
| Organisations and memberships                                   | 1     | Roles, transfer, remove member, last-owner guard; deletion in §8d                          |
| Organisation switching                                          | 1     | Fixed on this branch (`1bcc8c0`); see §5.1                                                 |
| Project switching                                               | 1     | Same context resolver; stale hints cleared                                                 |
| Team invitations                                                | **5** | **Acceptance link 404s** — see F-01                                                        |
| Project transfers                                               | 1     | Fully transactional; 8 integration tests                                                   |
| Domain management and DKIM                                      | 2     | Real SES identity + polled status; never exercised against AWS                             |
| SPF / DMARC / custom MAIL FROM                                  | 4     | SPF+DMARC shown as copy-paste guidance only; MAIL FROM absent                              |
| Sender identities                                               | 1     | Verification enforced by id; bare-address path is a gap (§F-07)                            |
| API keys                                                        | 1     | SHA-256 + `timingSafeEqual`, revocation checked per request, scopes, expiry                |
| Outbound sending                                                | 1     | One pipeline, idempotency, quota, suppression, sender resolution                           |
| Email templates                                                 | 3     | Versions exist; **no draft/publish, no variables schema, no React Email**                  |
| Queues and workers                                              | 1     | `FOR UPDATE SKIP LOCKED`, leases, recovery, dead-letter                                    |
| Scheduled and batch sending                                     | 2     | Implemented; live behaviour depends on cron/Redis not configured here                      |
| Webhooks                                                        | 1     | HMAC signatures, backoff, dead-letter, replay, auto-disable                                |
| Suppressions                                                    | 3     | Enforced before send; **no SES account-level list sync** (§F-04)                           |
| Deliverability / event tracking                                 | 3     | send/delivery/bounce/complaint/open/click handled; **no deferred/rejected states** (§F-03) |
| Billing and subscriptions                                       | 3     | Schema + Paystack adapter; not configured, no dunning/grace                                |
| Usage metering                                                  | 1     | `usage_records` + `usage_summaries`, org-attributed, quota in the same transaction         |
| Platform email analytics                                        | 3     | Two separate views; no unified customer-vs-Calder total (§F-02)                            |
| Customer notifications page                                     | **3** | Fixed (§8d); catalogue + previews are operator-only (§F-05)                                |
| Admin / control plane                                           | 1     | 40 routes, section RBAC, audit log, no customer body access                                |
| Logging and monitoring                                          | 3     | Structured logs, health/ready; no inbound or ingest alerting                               |
| API docs and SDKs                                               | 3     | OpenAPI served, docs page; Node/Python tested, Ruby/PHP unverified, none published         |
| Marketing (broadcasts, audiences)                               | 6     | Deliberately `coming_soon`, API returns 403                                                |
| SMTP gateway                                                    | 6     | Spec only, no implementation                                                               |
| Inbound / inbox                                                 | 6     | `inbound_email: coming_soon`; routes 404 while `INBOUND_ENABLED=false`                     |

---

## 4. Findings, ordered by cost of leaving them

### F-01 — Invitation links 404 (Broken, P0) — reproduced root cause

**Symptom:** `https://calder.click/invite/{token}` returns the marketing site's
404 page.

**Root cause: the link is built from the wrong base URL.** There are two deployed
apps (`docs/DEPLOYMENT.md` §hosting):

| App              | Host               | Contains                                     |
| ---------------- | ------------------ | -------------------------------------------- |
| `apps/web`       | `calder.click`     | marketing, docs, pricing                     |
| `apps/dashboard` | `app.calder.click` | the product, **including `/invite/[token]`** |

`apps/dashboard/app/(app)/settings/actions.ts:197` builds the invite URL from
`APP_URL` (the marketing host, and in dev `localhost:3000` = web) however
`/invite/[token]` exists only in the dashboard. The route, the middleware
allowlist (`/invite/` is public) and the token lookup are all correct — the user
is simply sent to the wrong application. There is no test anywhere asserting the
host of a link the product sends, which is why this shipped.

**The same defect exists in six more places**, all dashboard paths built from the
marketing host:

| File                                         | Link                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `settings/actions.ts:197`                    | invite acceptance                                                                |
| `settings/actions.ts:576`                    | email-change confirmation                                                        |
| `settings/actions.ts:607`                    | data export download                                                             |
| `api/unsubscribe/company/route.ts:92`        | "manage preferences" footer link                                                 |
| `apps/api/src/lib/ses-events.ts:704`         | suppressions deep link in an ops email                                           |
| `apps/api/src/services/email-service.ts:102` | usage-warning "pricing" link (this one is marketing, so `APP_URL` is right here) |

So the bug is not one string: **`APP_URL` is overloaded** to mean both
"marketing site" and "product app". Fixing one call site would leave six.

**Secondary defects in the same flow:**

1. `acceptPendingInvites()` (`packages/auth/src/oauth.ts:312`) returns the
   organisations it joined and every caller discards it — the invitee is not
   placed into the invited organisation, they land in whichever organisation sorts
   first. Requirement 2 of the brief ("redirected into the correct organisation")
   is not met.
2. The invite page's "Sign in" button drops the token (`/login`, no `next=`), so
   after signing in there is no path back to the invitation context.
3. `getInvitePreview` is imported from a `"use server"` module by a public page —
   it works, but the preview and the acceptance are different code paths, so the
   page can say "valid" for an invite the acceptance will refuse.

### F-02 — Platform vs customer email analytics are two islands (Partial, P1)

`/control/platform` counts `emails` (customer sends). `/control/communications/company`
counts `company_emails` (Calder's own mail). Nothing computes the requested
breakdown — total outbound, customer outbound, Calder platform, failed, delivered

- in one place, so "how much mail did we send today" cannot be answered without
  adding two screens. The pieces are all present (`ACCEPTED_EMAIL_STATUSES`,
  `company_emails.status`, `providerEvents` dedupe), so this is a query and a page,
  not a schema change.

### F-03 — Delivery states are lossy (Partial, P1)

`email_status` has `created, queued, sending, sent, delivered, bounced,
complained, failed, suppressed`. The brief asks for a distinct **deferred** and
**rejected** state. Today `ses-events.ts` maps SES `Reject` and
`rendering failure` to `failed`, and **`DeliveryDelay` is not handled at all** —
a deferred message looks stuck, and an operator cannot tell "SES is retrying" from
"this will never be delivered". Bounce subtypes are captured on the event but not
surfaced as a first-class status.

### F-04 — No SES account-level suppression sync (Partial, P1)

`findBlockingSuppression` is enforced in `email-service.ts` and `drain.ts` against
our own `suppressions` table, populated from bounce/complaint SNS events and
manual entries. Nothing reads or writes SES's account-level suppression list. Two
consequences: (a) an address SES has suppressed for the whole account can be
"sent" by Calder and silently vanish, and our status says `sent`; (b) a customer
who removes a suppression in Calder still cannot deliver, and the product gives no
hint why. This is a correctness issue for customers, not just a feature gap.

### F-05 — Customer notifications page exposes the internal catalogue (Partial, P1)

`/settings/notifications` renders **every** entry in `COMPANY_EMAILS` — ids,
categories, trigger descriptions and a `?preview=` renderer for any of them — to
any signed-in customer. The brief requires the opposite: customers manage the two
optional categories and see their own history; the full catalogue, triggers,
variables, previews and send history belong behind an operator guard (the control
plane already has `/control/communications/company`, which is the right home).

### F-06 — SPF / DMARC are advice, not verification; no custom MAIL FROM (Missing, P1)

`/domains` displays `v=spf1 include:amazonses.com ~all` and
`v=DMARC1; p=none; …` as copy-paste strings. Neither is looked up, so a domain can
show "verified" with a broken SPF or a `p=reject` DMARC policy that will land the
customer's mail in spam. There is no custom MAIL FROM (return-path) support at
all; `grep MailFromDomain` finds only SDK error-name mapping.

### F-07 — Bare `from` addresses bypass identity verification (Partial, P1)

`resolveSender` (`apps/api/src/services/sender-service.ts`) enforces status for
`sender_xxx` references **and** for bare addresses that match an existing
identity. A bare address with no identity is allowed through and recorded as
`unattributed`. That is a deliberate backwards-compatibility decision, but it
means the product-level answer to "can a customer send from any address at their
verified domain?" is currently **yes**, with SES as the only gate. The brief asks
for the opposite, and the "verified domain" vs "verified sender identity"
distinction is exactly where this leaks.

### F-08 — No account, organisation or project deletion; retention unenforced (Missing, P1)

There is a data export (`requestDataExport` → signed `/api/account/export`) but no
delete path for an account, an organisation or a project, and
`plan-limits.retentionDays` (7/14/30/90) is catalogue data that nothing sweeps. A
customer asking "delete my workspace and everything in it" cannot be answered with
the product.

### F-09 — Rate limiting covers sending, not reading (Partial, P2)

`rateLimitMiddleware` is applied to `POST /v1/emails`, batch, beacon, waitlist and
unsubscribe. Reads (`GET /v1/emails`, `/keys`, `/domains`, `/suppressions`,
`/templates`, `/jobs`) and key creation/rotation are unmetered, so one key can
hammer the database, and key creation has no abuse ceiling.

### F-10 — CI is red, so nothing is protected (Broken, P0)

`prettier --check` fails on exactly two files
(`apps/api/src/lib/inbound/ingest.integration.test.ts`,
`apps/api/src/lib/inbound/parse.test.ts`). Because formatting is the first gate,
**lint, typecheck, tests, migrations and build have not run in CI**. Every other
finding here is unguarded until this is fixed. (Two sandbox-only caveats that are
not CI failures: `turbo run` cannot spawn `pnpm` here, and
`apps/api/src/scripts/verify-deploy.test.ts` fails 5/5 because it spawns `pnpm`
too. Both pass where `pnpm` is on `PATH`.)

### F-11 — Template system is half a product (Partial, P2)

`templates` + `template_versions` support name, alias, description, subject, html,
text and "latest version wins" send-by-alias with missing-variable detection
(`email-service.ts:194-258`). Missing versus the brief: draft/published states,
a declared variable schema, preview data, pinned versions, validation on publish,
React Email, and the AI prompt button. Today "a draft cannot accidentally be used
in production" is true only because drafts do not exist.

### F-12 — Scope inconsistency: inbox is reachable while marked coming-soon (P2)

`features.ts` says `inbound_email: coming_soon` and `COMING_SOON_NAV` greys out
`/inbox`, but `/inbox` and `/receiving` are directly reachable by URL, and only the
API 404s (via `INBOUND_ENABLED=false`). With the feature postponed, the pages
should 404 too rather than half-exist.

---

## 5. What is already fixed on this branch (do not rebuild it)

The brief assumes three core-correctness items are open. Two of them are **already
implemented and tested here**; one is the F-01 bug above.

### 5.1 Organisation and project switching — working, with tests

`apps/dashboard/lib/context.ts` + `app/(app)/context-actions.ts` +
`components/context-switcher.tsx` resolve context as
`requested project → requested org → remembered project → remembered org → first org`,
with every step filtered through the caller's own memberships. Cookies are
`httpOnly`, a stale cookie is cleared, a switch clears a project that belongs to
the previous organisation, and an unknown id is refused rather than trusted.
`lib/context.test.ts` (15 tests) covers ordering, staleness, and refused
cross-organisation hints. **What is missing is a browser-level test** — the pure
resolver is proven, the click path is not.

### 5.2 Project transfer — implemented, transactional, tested

`apps/dashboard/lib/projects/transfer.ts` (preview + apply) and
`/settings/projects/[id]/move` exist: destination picker, typed-name confirmation,
consequence copy, `SELECT … FOR UPDATE` on the project, limit re-checks **inside**
the transaction, suppression rows rewritten (the denormalised `organization_id`
would otherwise leak across tenants), usage history left with the billed
organisation, one audit row written to each side. `transfer.integration.test.ts`
runs 8 cases. Remaining polish: billing attribution copy in the confirmation, and
a cross-check that a project's SES identities remain valid at the destination.

### 5.3 Also solid, and worth protecting

Single permission matrices (`inboxCapabilities`, control-plane `roles.ts`),
idempotency keys as a unique index, quota + plan catalogue in
`packages/config/src/plan-limits.ts` as the only limit source, abuse pause with a
minimum sample size, `FOR UPDATE SKIP LOCKED` job claiming with lease recovery,
webhook HMAC + backoff + dead-letter + replay, API-key hashing with
`timingSafeEqual`, audit logging, and a control plane that does not read customer
message bodies.

---

## 6. Verification results (executed today)

Integration gate open (`RUN_INTEGRATION_TESTS=1`, local Postgres 17):

| Suite                                              | Result                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/db`                                      | **139 passed / 0 failed**                                                  |
| `apps/api`                                         | **338 passed / 5 failed** (all 5 = `verify-deploy.test.ts`, spawns `pnpm`) |
| `apps/dashboard`                                   | **327 passed / 0 failed**                                                  |
| `packages/auth`                                    | 55 / 55                                                                    |
| `apps/worker`                                      | 23 / 23                                                                    |
| `packages/notify`                                  | 19 / 27 (8 are provider integration, gated)                                |
| `packages/config`                                  | 56 / 56                                                                    |
| `packages/observability`                           | 59 / 59                                                                    |
| `packages/providers`                               | 27 / 27                                                                    |
| `packages/queue`                                   | 29 / 38 (9 Redis-gated)                                                    |
| `packages/validation`                              | 31 / 31                                                                    |
| `packages/sdk-node`                                | 17 / 17                                                                    |
| others (audiences, billing, email, rate-limit, ui) | 37 / 37                                                                    |

Not run / not runnable here: `playwright` browser suite (no deployed origin),
`verify:deploy` against a real host, any S3/SNS/SES/DNS call, Redis-backed queue
consumer, and the web app's production build (only the dashboard's was run).

**What none of this proves:** that SES accepts our sends in production today, that
DNS verification works against real zones, that webhooks reach a real endpoint, or
that a customer can complete onboarding in a browser. Those are Stage 6 items and
they need a deployed origin, not more unit tests.

---

## 7. Inbound / inbox — documented, not expanded (postponed)

Existing on this branch: receiving domains with TXT+MX proof, SES receipt ingest
with unique `ses_message_id` claim and separate `inbound_emails` allowance, MIME
parsing, attachments, routing/threading, inboxes with mailbox-level permissions,
notifications with per-conversation email cadence, and per-thread unread state.
`docs/INBOUND.md`, `docs/INBOUND-SETUP.md` and
`docs/INBOUND-SHARED-INBOX-REPORT.md` describe it, including the AWS work that has
**not** been done.

Recommendation for this hardening cycle: **gate it, do not delete it.** Set
`inbound_email` to remain `coming_soon`, make `/inbox` and `/receiving` return 404
while `INBOUND_ENABLED=false` (F-12), and leave the code and tests in place. No
further inbox work.

---

## 8. Implementation plan

Ordered by risk removed per day of work. Estimates are focused engineering days
for one agent working with tests, not calendar promises.

### Stage 2 — Core correctness (≈2 days)

| #   | Task                                                                                                                                                                                                                                                                       | Acceptance criteria                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | **URL split.** Introduce `dashboardUrl()` / `marketingUrl()` helpers in `@calder/config` (or a small `lib/urls.ts`), migrate all seven call sites from F-01, and make production config refuse to start when a required URL is missing instead of defaulting to localhost. | A test asserts every link emitted by a dashboard action and by the API's ops emails resolves to the dashboard origin, and that `/pricing` still uses the marketing origin.     |
| 2.2 | **Invite lifecycle.** Acceptance page carries `next=/invite/<token>`; acceptance sets the org cookie and redirects into the invited organisation; preview and acceptance share one service function; expired/revoked/accepted/invalid states covered.                      | New `invite.integration.test.ts`: create → email link host → preview → accept as the matching email → membership + org cookie → wrong-email account refuses → expired refuses. |
| 2.3 | **CI green.** Fix F-10 (two files), add a `format:check` guard note, and record the local `turbo`/`pnpm` caveat in `docs/OPERATIONS.md`.                                                                                                                                   | `prettier --check` clean repo-wide; CI reaches lint, typecheck, tests, migrate and build.                                                                                      |
| 2.4 | **Gate inbound UI** (F-12).                                                                                                                                                                                                                                                | `/inbox` and `/receiving` 404 while the feature is `coming_soon`; nav unchanged; tests assert the 404.                                                                         |

### Stage 3 — Email infrastructure safety (≈3–4 days)

| #   | Task                                                                                                                                                                                                                              | Acceptance criteria                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **SES suppression list is the authority.** Query SES `ListSuppressedDestinations`/`GetSuppressedDestination` before a live send (cached, short TTL, fail-closed on outage with an explicit reason), and reconcile into our table. | Sending to an address suppressed at the account level returns a clear `suppressed` refusal rather than a phantom `sent`; test with a stubbed SES client.            |
| 3.2 | **Deferred and rejected states** (F-03). Add `deferred` (and keep `failed` for reject with a stored reason) to the status enum, handle `DeliveryDelay`, surface "SES is retrying" in the UI.                                      | Migration + event tests: delay → `deferred` with `nextAttemptAt`-style visibility; reject → `failed` with provider reason; no state regression on a later delivery. |
| 3.3 | **Close the bare-address hole** (F-07). Require a known, verified sender identity for live sends; allow raw addresses only in test mode, or when the domain is verified _and_ the project has opted in.                           | A live send from an unknown address at a verified domain is refused with a message naming Senders.                                                                  |
| 3.4 | **SPF/DMARC checks + MAIL FROM** (F-06). Verify published SPF includes the SES include and DMARC is not `p=reject` without alignment; add custom MAIL FROM setup if SES-side work is acceptable.                                  | Domain readiness shows four independent facts: ownership, DKIM, SPF, DMARC — with the DNS value read live and the failure explained.                                |
| 3.5 | **Rate limits for reads and key operations** (F-09).                                                                                                                                                                              | `GET /v1/emails` and key create/rotate have named limits with tests; 429 carries `Retry-After`.                                                                     |

### Stage 4 — Developer experience (≈5–7 days, the largest net-new build)

| #   | Task                                                                                                                                                                  | Acceptance criteria                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **Template lifecycle:** draft vs published, immutable published versions, declared variables, preview data, validation before publish, stable id sent by API.         | A draft can exist without being sendable; publishing is additive; send-by-id uses the published version only; tests cover both refusals. |
| 4.2 | **React Email:** accept React source, render server-side to HTML + text with an email-safe renderer, store the rendered output as a normal version.                   | Rendered output is plain HTML in the version row (no components at send time); one end-to-end template → send test.                      |
| 4.3 | **Copy AI Prompt** per template, generated from the template's own metadata (purpose, variables, subject, branding, compatibility notes, Calder integration snippet). | Button exists in the template editor; output is deterministic for a given template and includes its real variable names.                 |

### Stage 5 — Billing, operations, privacy (≈3–4 days)

| #   | Task                                                                                                                                                     | Acceptance criteria                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | **Unified platform email analytics** (F-02): one `/control/platform/email` view, customer vs Calder split, failed/delivered, dedupe-aware.               | Numbers reconcile: customer `emails` + `company_emails` = total, with no double count on retries.                                     |
| 5.2 | **Notification separation** (F-05): customer page shows optional categories + own history; catalogue stays admin-only, enforced server-side.             | A customer request for a catalogue preview or another user's history returns 404/403; control plane unchanged.                        |
| 5.3 | **Deletion and retention** (F-08): account/org/project deletion with a typed confirmation and a grace window; retention sweep honouring `retentionDays`. | Deleting an org removes memberships, projects, keys, webhooks and data with an audit trail; retention sweep is idempotent and logged. |
| 5.4 | **Abuse review workflow:** a review queue with notes, reinstate/pause/suspend actions and audit rows.                                                    | Every enforcement action is attributable to an operator and reversible.                                                               |

### Stage 6 — Verification (≈1 day, plus your environment)

| #   | Task                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Full suite with integration on, lint, typecheck, `format:check`, `next build` for both apps, migrations + drift on a fresh database.                            |
| 6.2 | Browser end-to-end: signup → create org → create project → switch org/project → invite → accept in a second browser profile → verify domain → send → see event. |
| 6.3 | One real live send with a verified sender, then a bounce and a complaint to a test address, checking state transitions and suppressions.                        |
| 6.4 | A written "what is still unverified" list for launch — same discipline as `docs/LAUNCH-STATUS.md`.                                                              |

## 8a. Stage 2 — closed (this cycle)

Recorded here so the findings above are read as a snapshot, not as current
state. Each row below is a commit on this branch, with the tests that hold it.

| Finding                                                                       | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invite links 404** (§5, 7 call sites built on `APP_URL`)                    | Fixed  | Links are now built by `dashboardUrl()` / `marketingUrl()` / `apiUrl()` in `@calder/config`, which name the surface instead of inheriting one. Migrated: invite creation and reminder sweep, email-change, account export, notification-email dashboard links, company-email preference footer, abuse-pause suppression link, webhook re-enable. Broadcast unsubscribe and click-tracking URLs moved to the API origin (they were on the marketing host). Tests: 12 URL-helper cases, 4 notification-default cases, 1 live-Postgres sweep case asserting the accept link is on `DASHBOARD_URL`. |
| **Silent localhost links in a hosted deployment**                             | Fixed  | `dashboardUrl()`/`marketingUrl()`/`apiUrl()` throw (`UrlConfigError`) when called in staging/production with the matching variable unset and the value still the localhost default. An explicit value — including a preview host — is always honoured.                                                                                                                                                                                                                                                                                                                                          |
| **Dashboard pricing link resolved to localhost in the browser** (new finding) | Fixed  | `apps/dashboard/lib/pricing.ts` is imported by client components, where a server env read yields nothing. It uses an inlined `NEXT_PUBLIC_MARKETING_URL` constant, documented in `.env.example` with the three-origin contract.                                                                                                                                                                                                                                                                                                                                                                 |
| **Invite lifecycle (§3, "acceptance auto-attached but discarded")**           | Fixed  | Acceptance lives in `apps/dashboard/lib/invites.ts`: SHA-256 lookup, identity check, row lock, idempotent, spent-link-does-not-restore-access, membership + `accepted_at` + audit in one transaction. `/invite/[token]` renders per viewer (anonymous / matching / different account / accepted / expired / revoked). `next` survives login, OTP verify, magic link and signup. Sign-in routes open the workspace joined by invitation. Tests: 10 live-Postgres lifecycle cases, 5 cookie-header cases.                                                                                         |
| **`/inbox`, `/receiving` reachable while `inbound_email` is `coming_soon`**   | Fixed  | The middleware answers those subtrees with a genuine 404 (a page-level `notFound()` renders inside a 200 once the shell has streamed; a layout-level one does not even stop the page). Pages keep the guard as the deeper check. Verified against a running server: 404 for `/inbox`, `/inbox/settings`, `/inbox/<id>`, `/receiving` — signed in and anonymous — with `/settings` and `/suppressions` still 200.                                                                                                                                                                                |
| **CI red on formatting**                                                      | Fixed  | `pnpm format:check` passes over the whole tree; the two inbound test files were formatted. Per-package lint is 0 errors; `tsc --noEmit` is clean for config, auth, notify, api, dashboard and worker; `next build` succeeds for the dashboard.                                                                                                                                                                                                                                                                                                                                                  |

Closed since this table was written: template draft/publish and React Email
(§8c), notification separation, retention, deletion and abuse review (§8d). What
is still open from the list above: **custom MAIL FROM** (SES-side, needs your
agreement) and **billing go-live** (§9.5), which you asked to leave alone for
this cycle.

## 8b. Stage 3 — closed (this cycle)

| Finding                                                       | Status                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No SES account-level suppression sync** (F-04)              | Fixed                          | SES's list is now the authority, in three layers. (1) `ses_suppressions` (migration `0044`) mirrors the account list; `findBlockingSuppression` answers from it **first** and labels the block `source: "account"` — it applies to every project of every customer, blocks both streams, and explains itself as the provider's list rather than "another project in this workspace". (2) The drain asks `GetSuppressedDestination` before handing a message over (60 s clear / 5 min suppressed cache, 5 000 entries), mirrors a positive answer, and **fails closed** on an unreadable answer: the row is requeued with a 60 s delay and counted as `deferred`, then fails with `suppression_check_unavailable` only after the normal attempt budget. (3) `runScheduledMaintenance` pages through `ListSuppressedDestinations` outside the Paystack gate, incremental from the previous run minus a day, capped at 5 × 1 000 pages, reporting `truncated` rather than claiming completeness, and never deleting. Tests: 8 provider-wrapper cases (NotFoundException is "not on the list", other errors escape), 10 cache/verdict cases, 4 live-Postgres account-wide cases (blocks every project, wins over a local row, case-insensitive, wording), 6 reconcile cases (idempotency, watermark, page cap, mid-run failure, skip without credentials), 2 end-to-end drain cases (suppressed → `suppressed` + credits returned; unanswerable → still `queued`, nothing sent). |
| **Delivery states are lossy** (F-03)                          | Fixed                          | `email_status` and `email_event_type` gained `deferred` (migration `0045`). `DeliveryDelay` now moves a row to `deferred` — accepted, delivery retrying, not a failure — and writes a `deferred` timeline event carrying the delay type; the progress ranking keeps it below `delivered`, so the ordinary delayed→delivered sequence advances while a stale delay notice cannot regress a delivered or terminal row. `Reject` and rendering failures now copy the provider's own reason onto `emails.lastError`, so the list says _what_ failed instead of only that it did. The dashboard names the state "Delayed" with a warning tone, counts it as throughput but not as a delivery outcome, explains it in the transport column, and it never suppresses an address. Tests: 15 pure matrix cases (advance, no-regression, idempotency, sticky states, recipient fallback, missing reasons) + 2 end-to-end cases over real SNS signatures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Bare `from` addresses bypass identity verification** (F-07) | Fixed                          | `resolveSender` refuses a live send whose `from` has no sender identity, with a `422 sender_not_ready` that names Senders, before anything is persisted. Two cases stay allowed and nothing else: test-mode sends (the provider is mocked) and a bare address at a domain the project has **verified**, only after the project opts in (`projects.metadata.allowUnattributedSenders`, off by default, toggled in Senders by an owner/admin, audited). The refusal for a blocked organization keeps precedence, so a suspended workspace is never told to fix a sender. Tests: 6 resolver cases over live Postgres (unknown refused, opt-in alone insufficient, verified domain + opt-in allowed, another domain still refused, test-mode allowed), 5 HTTP cases asserting the 422 + wording + no row persisted + the opt-in path. Existing live-path suites opt in explicitly via `test-support/senders.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **SPF / DMARC are advice, not verification** (F-06)           | Fixed (checks); MAIL FROM open | `@calder/db` `dns-auth.ts` reads the apex TXT set and `_dmarc.<domain>` at request time and returns four independent facts (`GET /v1/domains/:id/auth`, verification-bucket rate limit; the dashboard shows the same four rows on each domain). Judged: no SPF; two SPF records (RFC 7208 §4.5 — a permanent error, so worse than none); SPF without `include:amazonses.com`; `+all`; no DMARC; `p=none`; `pct<100`; and `p=quarantine\|reject` with `aspf=s`, which rejects our own mail because the SES return path is `*.amazonses.com` — the DMARC template the dashboard suggested now recommends `aspf=r`. A DNS failure reports unknown, never pass and never missing. Not done: a custom MAIL FROM (`MailFromDomain`) — that is SES-side configuration and needs your agreement, and recursive SPF evaluation (include chains, the 10-lookup limit) is deliberately out of scope rather than faked. Tests: 18 parser/decision cases with a fake oracle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Rate limiting covers sending, not reading** (F-09)          | Fixed                          | Two new buckets in `@calder/rate-limit`: `read` (600/min per key) on `GET /v1/emails`, `/domains`, `/keys`, `/suppressions`, `/templates`; `keyAdmin` (20/hour per key) on `POST /v1/keys` and `/:id/rotate`. Bucket keys include the preset, so read budget can never be spent from send budget. Every 429 already carried `Retry-After`; it is now asserted, rounded **up** so a client that waits the advertised time is inside the window, with a one-minute fallback when the limiter gives no hint. Tests: 6 middleware cases + 3 live-Postgres cases across every read surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 8c. Stage 4 — in progress (this cycle)

| Finding                                              | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Template system is half a product** (F-11), part 1 | Fixed  | Draft/publish lifecycle (§4.1): `template_versions.status` + `published_at` (migration `0046`, existing rows backfilled as published), `POST /versions` saves a draft, `POST /versions/:version/publish` validates then publishes (idempotent), `POST /versions/:version/preview` renders with sample data and returns the same problems, and sends resolve the newest **published** version only — an unpublished template is `422 template_not_published`. Publishing refuses what would fail in production: no subject, no body, an undeclared `{{placeholder}}`, an empty required preview value. The dashboard shows what is live, marks waiting drafts, and publishes from the version list (manager-only). Tests: 22 lifecycle cases + 6 live-Postgres API cases. |
| **Template system is half a product** (F-11), part 2 | Fixed  | React Email (§4.2): a version may be posted as `react_tree` (element data) and is rendered server-side to email-safe HTML + text against a whitelist, with the output stored as an ordinary version — no components exist at send time. Escaping, URL-scheme restriction, prop filtering, unknown-component refusal, and depth/size bounds are all tested (13 cases + 1 end-to-end send). `react_source` is deliberately refused: executing customer code in the API process is not a trade a template justifies.                                                                                                                                                                                                                                                        |
| **Copy AI Prompt** (§4.3)                            | Fixed  | `buildTemplatePrompt` composes a brief from facts we hold — name, alias, subject, which bodies exist, declared variables (marked required/optional), the verified sending domain, and the exact `POST /v1/emails` call that sends it. Byte-identical across calls (variables sorted), and it forbids inventing variables precisely because an invented one would fail at send time. Exposed as `GET /v1/templates/:id/prompt` and as a copyable block on the template page. 9 cases.                                                                                                                                                                                                                                                                                     |

## 8d. Stage 5 — in progress (this cycle)

| Finding                                                               | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer notifications page exposes the internal catalogue** (F-05) | Fixed  | The customer page is now built from one closed shape, `buildCustomerNotificationsView` (three optional categories + the signed-in person's own history), and cannot name a template id, a trigger, an audience or a `data` list — the test scans the serialised payload for all four and for every mandatory catalogue id, so pasting the catalogue back in fails the suite. The `?preview=` renderer is gone from the customer surface; previews moved to `/control/communications/company?preview=<id>`, which is behind `requireSection("communications")`, and `resolveCataloguePreview` takes the audience as a parameter so a customer-audience call resolves **nothing** for every id in the catalogue (asserted for all 60+ ids). History stays scoped by query to `ctx.user.userId`; the view builder has no parameter for whose history to load. Tests: 8 customer-view cases + 8 preview-guard cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Abuse review workflow** (Stage 5.4)                                 | Fixed  | An operator now works a queue instead of guessing: `listAbuseReviewQueue` returns workspaces the policy paused (`abuse_paused`), ones an operator suspended, and ones still sending that produced complaints inside the 7-day window ("watching"), worst first, each with accepted/bounce/complaint counts and rates. `applyAbuseReviewDecision` supports **reinstate / pause / suspend**; `pause` stops sending and leaves keys in place, `suspend` revokes every live key and reports how many. A note is mandatory (≥ 6 chars) and is written into the audit row together with the actor, the previous state and the new one, so every enforcement action is attributable and reversible; repeating the current verdict returns `changed: false` and writes no second row, because two audit rows for one decision make a review history unreadable. Notes without a decision are recorded as `organization.abuse.note`. Enforced by role: founder / platform-admin / security may act, support and analyst can read the queue only. Surface: `/control/customers/abuse-review` (in Customers nav) with per-workspace history, linked from the workspace page. Tests: 11 live-Postgres cases (queue membership and exclusions, metrics, ordering, mandatory note, attributed reinstate, idempotency, pause without key revocation, suspend with revocation count, note-only history, unknown workspace, role predicate). |

| **No account, organisation or project deletion; retention unenforced** (F-08), part 2 — deletion | Fixed | Workspaces, projects and accounts can now be deleted: a typed confirmation (the workspace/project slug, or the account's own email) schedules a purge **7 days** out, sending stops immediately at ingest _and_ at delivery (`organization_pending_deletion` / `project_pending_deletion`), and the owner can cancel until the sweep runs. The confirmation is compared in `@calder/db` against the stored value, not in the form, so a route that forgets to check cannot delete anything. Migration `0047` adds `deletion_requested_at` / `deletion_scheduled_for` (+ actor) to `organizations`, `projects` and `users` with purge indexes. An account deletion is refused (`409 sole_owner`) while the person is the sole owner of a workspace somebody else belongs to — transfer ownership first — and otherwise takes its single-member workspaces with it. The purge is bounded, idempotent, per-target failure-isolated, and writes an audit row **before** the delete with the id/slug/name in metadata, so the trail survives the thing it describes. Deliberately no `/v1` endpoint: a leaked API key must not be able to erase the workspace whose mail it was sending. Tests: 11 live-Postgres cases (confirmation, role refusal, send blocked, idempotent request, cancel restores, purge not early, full cascade + audit survival, project-only purge, sole-owner refusal, account purge scope, bound reporting). |

| **No account, organisation or project deletion; retention unenforced** (F-08), part 1 — retention | Fixed | `retentionDays` (7/14/30/90, `null` = contract) is now applied by `enforceRetention` on the maintenance tick. At the boundary the **body goes** — `subject` becomes a visible `(removed by retention)` marker, `html`/`text`/`attachments`/`metadata`/`cc`/`bcc` are cleared — and the message's `email_events` are deleted; the **accounting row survives** (id, project, from/to, status, provider, timestamps), so usage totals, delivery rates and the customer's own history do not change when a body is removed. Two refusals: nothing is redacted while the message could still be sent (`created`/`queued`/`sending`/`deferred` are never eligible, so a long backoff cannot deliver an empty envelope), and `retentionDays: null` means _do not touch_, never "pick a default". Bounded per run and idempotent: the subject marker excludes already-redacted rows, `truncated` is reported instead of claiming the fleet is clean, and one workspace's failure is recorded while the rest of the sweep continues. Tests: 7 live-Postgres cases (redaction, accounting survival, queued/deferred/terminal distinction, idempotency, contract plan untouched, cap-then-finish, per-workspace status). |

---

## 9. Decisions I need from you

1. **Hosts.** Confirm production hosts: product `app.calder.click`, marketing
   `calder.click`, API `api.calder.click`. Everything in Stage 2.1 depends on it.
2. **Inbound gate.** Agree to make `/inbox` and `/receiving` 404 while the feature
   is postponed (keeping the code), rather than hiding the nav only.
3. **Template priority.** Draft/publish first, or React Email first? My
   recommendation: lifecycle first (it is the correctness issue — a draft must not
   be sendable), React Email second.
4. **SES suppression policy.** ~~Read-through versus periodic reconcile.~~
   **Closed (Stage 3.1):** both, read-through on the delivery path with a
   fail-closed answer, and a bounded reconcile on the maintenance tick. The one
   thing worth your confirmation is the failure mode: an unreadable suppression
   list delays sends rather than risking them.
5. **Billing go-live.** Is Paystack the path for real subscriptions now, and what
   grace period should a failed payment get before sending is paused?
   **Deferred at your request** for this cycle — no payment or dunning code was
   touched in Stage 5.
6. **Retention.** ~~What must be deleted at the `retentionDays` boundary?~~
   **Closed (Stage 5.3):** bodies and the event timeline go, the accounting row
   stays — see §8d. Contract plans (`retentionDays: null`) are never touched.

---

## 10. Non-goals for this cycle

- Calder Inbox: no mailbox work, no threading, no inbox billing, no inbox
  migrations. Existing code is frozen and gated.
- Marketing/broadcasts: stays `coming_soon`.
- SMTP gateway: stays spec-only; do not claim a public SMTP host.
- Publishing SDK packages: source stays; registry publication is an owner action
  with its own verification.
