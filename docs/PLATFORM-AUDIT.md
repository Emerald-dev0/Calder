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
| Users and profiles                                              | 3     | No self-serve account deletion                                                             |
| Organisations and memberships                                   | 1     | Create, roles, ownership transfer, remove member, last-owner guard                         |
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
| Customer notifications page                                     | **3** | Works, but exposes the whole internal catalogue (§F-05)                                    |
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

---

## 9. Decisions I need from you

1. **Hosts.** Confirm production hosts: product `app.calder.click`, marketing
   `calder.click`, API `api.calder.click`. Everything in Stage 2.1 depends on it.
2. **Inbound gate.** Agree to make `/inbox` and `/receiving` 404 while the feature
   is postponed (keeping the code), rather than hiding the nav only.
3. **Template priority.** Draft/publish first, or React Email first? My
   recommendation: lifecycle first (it is the correctness issue — a draft must not
   be sendable), React Email second.
4. **SES suppression policy.** Read-through (SES authoritative, fail closed) versus
   periodic reconcile into our table. My recommendation: both, read-through first.
5. **Billing go-live.** Is Paystack the path for real subscriptions now, and what
   grace period should a failed payment get before sending is paused?
6. **Retention.** What must be deleted at the `retentionDays` boundary — message
   bodies, `email_events`, or everything but the accounting rows?

---

## 10. Non-goals for this cycle

- Calder Inbox: no mailbox work, no threading, no inbox billing, no inbox
  migrations. Existing code is frozen and gated.
- Marketing/broadcasts: stays `coming_soon`.
- SMTP gateway: stays spec-only; do not claim a public SMTP host.
- Publishing SDK packages: source stays; registry publication is an owner action
  with its own verification.
