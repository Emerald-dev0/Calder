# Calder production-readiness & three-plan launch audit

**Date:** 2026-11-08
**Branch audited:** `arena/d745eeb2-calder` @ `22a12ab` (PR #96, open, unmerged)
**Baseline:** `main` @ `b7d6a48`
**Mode:** audit and planning. **No pricing, plan, database or feature code was changed by this audit.**

---

## 0. Verdict

**Current state: ready for controlled testing (internal / invited design partners). Not ready for a
free-user launch yet, and not close to a paid launch.**

Reasons, in order of severity:

1. **CI is red on `main` and on PR #96.** `main` fails `source-integrity`; PR #96 fixes that but fails
   `prettier --check` (34 files, 16 of them added by the PR) and `@calder/config` typecheck
   (`features.test.ts:92`). Lint, typecheck, tests and build never ran in CI for the PR head.
2. **Automatic delivery in a hosted environment is unproven.** The code path exists and passes with
   real Postgres + real Redis + real worker + mock provider (CI e2e), but the live-SES, no-manual-drain
   proof required before launch has not been recorded. The worker host is still "TBD" in
   `docs/DEPLOYMENT.md`, and the only scheduled drain runs **once a day at 00:00**.
3. **Real SES/SNS feedback has never been verified.** Signature verification, dedupe and suppression
   creation are implemented and unit/integration tested, but no production SNS topic, subscription or
   real delivery/bounce/complaint event is evidenced.
4. **The three-plan catalogue is not implemented.** Premium and Scale are still on `/pricing`, in the
   comparison table, in config, and in the admin/control-plane assignment paths.
5. **No payment provider, no checkout, no invoices.** Correctly labelled as unavailable, but it means
   any "paid" plan is a catalogue figure, not a purchasable product.

What is genuinely strong: the transactional pipeline, idempotency, suppression, tenant isolation,
template journey, quota admission and the honesty of the availability registry. Those are tested
against real Postgres and largely against real Redis in CI.

---

## 1. Method and evidence boundaries

| Kind of evidence             | Available here                                                        |
| ---------------------------- | --------------------------------------------------------------------- |
| Repository code, migrations  | Yes                                                                   |
| PR diff, CI checks, previews | Yes (`gh`)                                                            |
| Unit / integration tests     | Yes, local Postgres; **no local Redis**                               |
| CI e2e with real Redis       | Yes, observed as **passing** on PR #96                                |
| Production environment       | **No access.** No Vercel/AWS/DB credentials in this environment.      |
| Real SES send / SNS events   | **No.** Provider calls are mocked everywhere I can run.               |
| Production database          | **No.** Only the local scratch database, which holds 0 subscriptions. |

Anything not in the first two columns is treated as **unverified**, never as passing. Where the
repository's own docs record an operator confirmation (e.g. two manually drained emails on 28 Oct
2026), it is cited as _operator-reported_, not engineer-verified.

---

## 2. Repository, PR #96 and deployment state

| Question                          | Answer                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Is PR #96 merged?                 | No. Open, `mergeable: MERGEABLE`, `mergeStateStatus: UNSTABLE`, 65 files, +9,982/−347.                                            |
| Is it deployed to production?     | No evidence. It has **Vercel preview** deployments (web, dashboard, api all built successfully). A preview build is not a deploy. |
| Is `main` green?                  | No. The five most recent `main` runs all failed. `b7d6a48` fails `source-integrity`; `verify`/`e2e`/`migrate` are skipped.        |
| Is PR #96 green?                  | No. `verify` fails at **Format check**; every later step is skipped. `source-integrity` passes; `e2e` passes; previews pass.      |
| Working tree                      | Clean at `22a12ab`; branch matches `origin`.                                                                                      |
| Local migrations                  | 36/36 applied, drift clean (verified in the previous pass).                                                                       |
| Local data relevant to retirement | 5 plan rows (`free`,`starter`,`pro`,`premium`,`scale`), **0 subscriptions**, 1 internal org.                                      |

### 2.1 What PR #96 actually changes (classification)

| Change                                                            | Class | Notes                                                                                      |
| ----------------------------------------------------------------- | :---: | ------------------------------------------------------------------------------------------ |
| Availability registry + tests (`packages/config/src/features.ts`) |   A   | 47 config tests pass locally; still a type error in one test file (see §2.2).              |
| API gate on broadcasts/audiences (`403 feature_not_available`)    |   A   | 3 integration tests against real Postgres.                                                 |
| Dashboard Coming Soon surfaces + disabled nav + guarded actions   |   B   | Typechecked; 235 dashboard tests pass; no visual/browser verification in this environment. |
| Template journey tests (7) and template search/pagination/senders |   A   | Real Postgres; mock provider.                                                              |
| Premium enum + migration 0035 + seed fix                          |   A   | Migration additive; 36 migrations applied; 3 tests pass.                                   |
| Public pricing/SMTP/templates/webhook copy corrections            |   A   | Builds; 13 web tests pass.                                                                 |
| `docs/MVP-FEATURE-MATRIX.md`, PRICING/LAUNCH/SECURITY/DECISIONS   |   A   | Documentation only.                                                                        |
| Source-integrity payload removal                                  |   A   | Gate now clean; this is the only reason `main` is failing today.                           |

### 2.2 Newly found PR blockers (not previously reported)

1. **Format check fails.** `pnpm format:check` reports 34 files. 16 are added/modified by PR #96
   (`SECURITY.md`, `docs/MVP-FEATURE-MATRIX.md`, `packages/config/src/features.ts`,
   `apps/web/lib/plans.ts`, …). The other 18 are **already unformatted on `main`**, so CI would still
   fail even after formatting the PR's files.
2. **Typecheck fails in `packages/config`.**
   `src/features.test.ts(92,38): error TS2345: Argument of type '"free"' is not assignable to
parameter of type '"pro" | "premium"'.` The test uses
   `{ plans: ["pro","premium"] as const }` and then calls `.includes("free")`. `vitest` does not
   typecheck, so this survived the local test run.
3. Because CI stops at Format, **lint/typecheck/test/build were never executed on the PR head**, and
   the green local runs in §18 are the only evidence.

> **Consequence:** PR #96 cannot merge until these are fixed, and `main` has no working CI signal
> today. This is a P0 for the launch regardless of the plan simplification.

---

## 3. Feature inventory (A–E)

Legend: **A** implemented and verified · **B** implemented, inadequately verified · **C** partially
implemented · **D** missing · **E** blocked by infrastructure/external configuration.

| Area                  | State | Evidence / gap                                                                                          |
| --------------------- | :---: | ------------------------------------------------------------------------------------------------------- |
| REST send API         |   A   | `emails.ts`; send/batch/attribution integration tests; e2e over HTTP.                                   |
| Auth, key scopes      |   A   | Hashed keys, `requireScope`, journey test; expiry/revocation tested.                                    |
| Validation            |   A   | Zod schemas at every write path; 400s asserted.                                                         |
| Quota admission       |   A   | Locked transaction; monthly + 500/day; integration + e2e metering assertions.                           |
| Idempotency           |   A   | Stored-response replay + concurrent-key tests; e2e replay test.                                         |
| Postgres persistence  |   A   | Real DB throughout.                                                                                     |
| Redis queue           |   B   | Real Redis only in CI e2e; **local runs blocked** (no Redis binary).                                    |
| Worker consumption    |   B   | e2e starts the real worker; **hosted worker not deployed/known**.                                       |
| Automatic no-drain    |   B   | Wake-up code + tests; production proof absent; daily cron is the only backstop.                         |
| SES submission        |   E   | Code targets SES v2; no real send executed here; production credentials unavailable.                    |
| Provider acceptance   |   E   | Mock provider everywhere runnable; operator-reported 2 real emails sent manually.                       |
| Delivery events       |   C   | Ingest + state machine implemented; production SNS unverified.                                          |
| Bounce/complaint      |   C   | Mapping + suppression + abuse pause implemented; real events unverified.                                |
| Suppression           |   A   | Send-time refusal tested; scope isolation tested; e2e.                                                  |
| Unsubscribe           |   A   | Signed token, stream-aware; tests.                                                                      |
| Templates             |   A   | 7-test journey incl. versions, variables, idempotent send, tenancy, delete.                             |
| Senders / domains     |   A   | Integration tests; DNS verification tests.                                                              |
| Dashboard             |   B   | Builds and typechecks; no browser/visual QA in this environment.                                        |
| Public site           |   A   | Static build; copy tested; **pricing still five plans**.                                                |
| Webhooks (outbound)   |   A   | HMAC `t=…,v1=…`, durable fan-out, replay, logs; tests.                                                  |
| Webhook (inbound SNS) |   B   | Signature + cert origin + topic allowlist implemented; no real SNS traffic.                             |
| Analytics (basic)     |   A   | Real aggregates only.                                                                                   |
| Advanced analytics    |   C   | Coming Soon everywhere; no implementation.                                                              |
| Marketing suite       |   C   | Code exists, disabled at API and dashboard; not in MVP.                                                 |
| SMTP gateway          |   D   | Specification only; no app. Correctly Coming Soon.                                                      |
| Inbound email / Inbox |   D   | No ingest pipeline; Coming Soon.                                                                        |
| Node SDK              |   B   | 17 unit + SDK integration tests pass; **not published to npm**.                                         |
| Python SDK            |   B   | 16 tests pass in a venv; **not published to PyPI**.                                                     |
| Ruby / PHP SDKs       |   C   | Source only, no tests. Correctly unadvertised.                                                          |
| CLI                   |   D   | None. Remove from marketing copy.                                                                       |
| Billing               |   D   | No payment provider, no checkout; `/api/billing/webhook` rewrite points at a route that does not exist. |
| Retention purge       |   D   | Days are printed on the pricing page, but no purge job exists.                                          |
| Backups / restore     |   E   | Docs reference Neon; no restore drill or evidence in repo.                                              |
| Uptime/status         |   C   | Honest page, no historical uptime; alert endpoints exist, no monitoring vendor wired.                   |

---

## 4. Pricing, plans and entitlements

### 4.1 Current catalogue (code truth)

Source: `packages/config/src/plan-limits.ts`.

| DB tier   | Display  | NGN/mo | USD/mo |  Emails | Projects | Domains | Senders | Seats | Daily cap |
| --------- | -------- | -----: | -----: | ------: | -------: | ------: | ------: | ----: | --------: |
| `free`    | Beginner |      0 |      0 |   5,000 |        3 |       2 |       5 |     1 |       500 |
| `starter` | Starter  |  5,000 |      5 |  10,000 |        3 |       3 |      10 |     2 |         — |
| `pro`     | Pro      | 20,000 |     18 |  50,000 |       10 |      10 |      25 |     5 |         — |
| `premium` | Premium  | 75,000 |     65 | 250,000 |       50 |      50 |     100 |    15 |         — |
| `scale`   | Scale    | Custom | Custom |  Custom |        — |       — |       — |     — |         — |

The three intended plans match the target catalogue exactly (₦0/5,000/3 · ₦5,000/10,000/3 ·
₦20,000/50,000/10). **No price change is required for this assignment.** Premium/Scale must be removed
from the commercial offer, not repriced.

### 4.2 What is actually enforced

| Entitlement              | Enforced? | Where                                                          |
| ------------------------ | :-------: | -------------------------------------------------------------- |
| Monthly email allowance  |    Yes    | locked admission in `packages/db/src/usage.ts` + API paths     |
| Beginner daily cap (500) |    Yes    | same transaction                                               |
| Projects                 |    Yes    | `resource-limits.ts`, creation time only                       |
| Domains                  |    Yes    | same                                                           |
| Sender identities        |    Yes    | same                                                           |
| Team seats               |    Yes    | same; pending invites count                                    |
| Feature availability     |    Yes    | registry + API gate + dashboard guards                         |
| Log retention days       |    No     | printed on the pricing page; no purge job exists               |
| Environments per tier    |    No     | every project can create test + live keys                      |
| Scoped API keys          |    No     | available on every tier, but cards list them only from Starter |
| Webhook replay           |    No     | available on every tier; Pro card claims it                    |
| Audit logs               |    No     | available on every tier                                        |
| Marketing contacts       |    No     | draft only, never rendered                                     |

### 4.3 Honesty problems this creates for the three-plan page

- Pro advertises **"Staging and production environments"** and Beginner **"Development environment"**.
  Neither difference is enforced.
- Starter/Pro advertise **"Scoped API keys"**, Pro advertises **"Webhook replay"** and
  **"14/30 days log retention"**. All three are either available to everyone or not implemented.
- Pro's card lists `plannedHighlights` (queue visibility, rate-limit controls, roles) — correctly muted,
  but those are the only genuine differentiators and they are not built.
- Therefore **Pro's only real, enforceable advantage is numeric capacity**: 50k vs 10k emails,
  10 vs 3 projects, 10 vs 3 domains, 25 vs 10 senders, 5 vs 2 seats. The three-plan page must say that
  plainly and stop implying feature gates that do not exist.

### 4.4 Proposed three-plan migration strategy (no destructive changes)

**Principle:** the database keeps every historical value; the configuration and every write path stop
offering retired plans. Availability is decided in code, not by deleting rows.

#### A. Configuration (`packages/config/src/plan-limits.ts`)

1. Keep `PlanTier = "free" | "starter" | "pro" | "premium" | "scale"` — this mirrors the Postgres
   enum. Do **not** remove enum values.
2. Keep all five entries in `PLAN_LIMITS`, adding `retired: boolean` (`true` for `premium`, `scale`).
   Their limits, prices and display names stay intact so historical subscriptions resolve exactly as
   before.
3. Add `COMMERCIAL_PLAN_ORDER = ["free","starter","pro"]`. `PLAN_ORDER` becomes the commercial order
   used by upgrade pointers; add `KNOWN_TIERS` for resolution.
4. Fix `planFor()` to look up `PLAN_LIMITS[tier]` directly instead of checking `PLAN_ORDER`. Otherwise
   a grandfathered Premium org silently becomes Beginner — a forbidden downgrade.
5. Change `upgradeTierFor()` to iterate `COMMERCIAL_PLAN_ORDER` only. Today, a Pro org at a resource
   ceiling would be told to "upgrade to Premium".
6. Add `isCommercialTier(tier)` and `assertAssignableTier(tier)` returning a typed error/`false` for
   retired and unknown values.

#### B. Feature registry (`packages/config/src/features.ts`)

- `ALL_TIERS` (the default entitlement for every implemented feature) must stay **all known tiers**,
  not just the three commercial ones, or grandfathered Premium/Scale organizations would lose features
  they are still paying for.
- Add `isCommercialTier` re-export and use it in UI/assignment code, not in entitlement resolution.

#### C. Write paths that assign plans (must fail closed)

| Path                                            | Current                                                        | Required                                                             |
| ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /v1/admin/organizations/:id/subscription` | `z.enum(["free","starter","pro","scale"])` — **accepts Scale** | accept only the three commercial tiers; `400 plan_retired` otherwise |
| Control-plane `setSubscription`                 | `TIERS` includes `scale`                                       | three tiers + `assertAssignableTier` before any DB write             |
| Control-plane org pages                         | `<option value="scale">Scale</option>`                         | remove the option; show legacy tier read-only with a "retired" label |
| Future checkout                                 | n/a                                                            | must read `COMMERCIAL_PLAN_ORDER`, never hardcode tiers              |
| Dashboard plan display                          | prints `planDisplayName(tier)`                                 | append "(retired)" when the stored tier is retired; never offer it   |

`resolveOrgTier()` itself is unchanged: it reads whatever active subscription exists. That is what
"historical references remain readable" means.

#### D. Database and seeds

- **No new migration is strictly required.** Migration `0035` added `premium`; enum values cannot be
  dropped without rebuilding the type, and there is no reason to.
- `plans`/`plan_prices`/`subscriptions` rows for Premium/Scale must **not** be deleted. If they exist,
  they remain readable; if they do not exist (likely in production), nothing creates them.
- `seed.ts` seeds only the three commercial tiers by default. It must not delete rows for retired
  tiers. Prices for retired tiers remain in `PLAN_LIMITS` for historical resolution only.
- **Optional Phase B (recommended for billing):** add nullable `plans.retired_at` (migration `0036`
  or later) so "not commercially available" is expressible in the DB. Backfill only retired tiers,
  never delete. A future checkout selects `retired_at IS NULL`. This is additive and safe, but not
  needed for the launch.

#### E. Grandfathering policy (owner decision required)

| Option                           | Effect                                                                                     | Recommendation                |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| **Keep entitlements (proposed)** | Premium/Scale orgs keep their limits and features, cannot renew/assign; UI says "retired". | Default. No silent downgrade. |
| Migrate to Pro at period end     | Downgrade; needs explicit owner approval, customer communication and audit entries.        | Only with owner sign-off.     |
| Grandfather indefinitely         | Same as keep, but promises indefinite support.                                             | Owner call.                   |

Because local data has **0 subscriptions**, no decision is urgent today — but production data is
unknown, so the read-only audit query in §4.5 must be run by the owner before any migration.

#### F. Public site and docs

- `apps/web/lib/plans.ts`: `PlanId` → 3; `PLANS` → 3; comparison values become 3-tuples; `PROGRESSION`
  → 3; support row → 3; remove Premium/Scale cards and every mention.
- `apps/web/app/globals.css`: `.pricing-grid`, `.progression` → `repeat(3, …)`.
  **Note:** the CSS comment currently explains "five plans"; it must be updated with the grid.
- `what-is-calder/page.tsx` prints Premium pricing in the FAQ answer — remove.
- `docs/PRICING.md` (five-column table, narrative, stale 5k/50k/250k ceilings),
  `docs/MVP-FEATURE-MATRIX.md` §3, `docs/ROADMAP.md`, `docs/DESIGN.md`, `docs/SEO_AUDIT.md`,
  `PRD.md` §11 note — update or mark historical.
- Pricing card claims: replace "Staging and production environments" with "Test and live API keys";
  remove per-tier retention days until a purge exists; list scoped keys/webhooks on all plans or stop
  listing them as differences.
- Keep the paid CTA honest: today it renders "Planned · not available yet". That stays until checkout
  exists.

#### G. Tests required for the migration

| Test                                                                    | File                                        |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| `PLAN_ORDER`/commercial = 3; retired resolve to their own limits        | `packages/config/src/plan-limits.test.ts`   |
| `planFor("premium")` ≠ free; `upgradeTierFor("pro", …)` ≠ premium       | same                                        |
| Registry keeps retired tiers entitled; commercial helper excludes them  | `packages/config/src/features.test.ts`      |
| Admin API rejects `scale`/`premium` with 400 and writes no subscription | new test in `apps/api/src/routes/`          |
| Control action rejects retired tiers; no row change                     | `apps/dashboard/.../customers/actions`      |
| Premium remains storable/readable (historical)                          | existing `plan-premium.integration.test.ts` |
| Web renders exactly 3 cards/columns and no "Premium"/"Scale" strings    | `apps/web/lib/plans.test.ts` + build        |
| E2E pricing page shows 3 plans                                          | `apps/e2e`                                  |

#### H. Rollback

Revert the config arrays and copy. No database changes are made, so nothing to undo. If
`retired_at` is added, the column stays ignored.

### 4.5 Read-only production audit (owner runs; this environment has no production DB)

```sql
BEGIN TRANSACTION READ ONLY;
SELECT o.id, o.name, p.tier, s.status, s.current_period_start, s.current_period_end
  FROM organizations o
  JOIN subscriptions s ON s.organization_id = o.id
  JOIN plans p ON p.id = s.plan_id
 WHERE s.status = 'active' AND p.tier IN ('premium', 'scale')
 ORDER BY p.tier, o.name;
SELECT tier, count(*) FROM plans GROUP BY tier ORDER BY tier;
SELECT p.tier, count(*) FROM subscriptions s JOIN plans p ON p.id = s.plan_id
 GROUP BY p.tier ORDER BY p.tier;
COMMIT;
```

**Never run writes against production as part of this audit.**

---

## 5. Production sending acceptance (Part 3)

### 5.1 Lifecycle, step by step

| #   | Step                          | Code path                                      | Evidence I can reproduce                                          | Status                 |
| --- | ----------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| 1   | App submits email             | `POST /v1/emails`                              | integration + e2e over HTTP                                       | **Verified**           |
| 2   | API authenticates             | key hash lookup, org/project, scope            | tests                                                             | **Verified**           |
| 3   | Validation                    | zod + suppression + eligibility                | tests                                                             | **Verified**           |
| 4   | Usage limits                  | locked quota admission                         | tests; e2e metering                                               | **Verified**           |
| 5   | Persist                       | `emails` + `email_events(queued)`              | tests                                                             | **Verified**           |
| 6   | Enqueue                       | BullMQ/Redis; failure leaves row queued        | e2e real Redis; **local Redis unavailable**                       | **Verified in CI**     |
| 7   | Worker retrieves              | `startWorker()` + drain lease                  | e2e real worker                                                   | **Verified in CI**     |
| 8   | Worker submits to SES         | `@calder/providers` SES v2                     | **mock provider only**                                            | **Blocked**            |
| 9   | Acceptance/rejection recorded | status + `email_events` + `lastError`          | mock tests; real SES unverified                                   | **Partially verified** |
| 10  | Lifecycle visible in logs     | `/v1/emails`, events, webhook fan-out          | tests                                                             | **Verified (mock)**    |
| 11  | Usage metered correctly       | deterministic ledger id, `onConflictDoNothing` | tests + e2e exactly-once                                          | **Verified**           |
| 12  | No manual drain, hosted       | cron wake-up + worker                          | **no production evidence**; Vercel cron is daily; worker host TBD | **Blocked**            |

### 5.2 Acceptance criteria (must all hold before "production sending: accepted")

1. A send from a dashboard-created live key returns `202 queued` and reaches `sent` within **60 s**
   with **no human action**, from a clean production deploy.
2. The same is true after an API redeploy, a worker restart and a Redis restart (each separately).
3. `email_events` shows `queued → sent` and `usage_records` has exactly one row.
4. A rejected recipient produces `failed` + provider error, zero usage rows.
5. A duplicate `Idempotency-Key` returns the original id and does not double-send or double-meter.
6. Stop Redis: send still returns `202`, stays `queued`, `queue_enqueue_failures` increments,
   `/ready` is 503, and the message delivers after Redis returns.
7. Stop the worker: queued mail delivers via the scheduled drain within its interval; `worker_no_heartbeat`
   fires.
8. Kill the worker mid-flight: the message is retried or leased back; no loss; at most one duplicate
   is possible and is documented.
9. Prove one real SES acceptance (not mock) and one real delivery event.
10. Nothing above is claimed from unit tests or builds alone.

### 5.3 Blockers

- No hosted worker: `docs/DEPLOYMENT.md` still has "Hosting provider for api/worker — TBD".
- Vercel cron interval is `0 0 * * *` (daily). A send accepted at 00:01 with no worker waits ~24 h.
- `API_URL` and `CRON_SECRET` must be set on both API and dashboard for the wake-up; without them the
  code logs `missing_url` (observed in local test logs) and silently degrades to the daily cron.
- No production credentials in this environment, so no real SES submission can be made here.

---

## 6. SES and SNS feedback

| Check                         | State | Evidence                                                                                            |
| ----------------------------- | :---: | --------------------------------------------------------------------------------------------------- |
| SNS signature verification    |   A   | `verifySnsSignature`: `SignatureVersion 1`, RSA-SHA1/SHA256, X509 cert from allowlisted SNS origin. |
| Cert host allowlist           |   A   | `isAllowedSigningCertUrl` / `isAllowedSnsUrl` (official `sns.*.amazonaws.com` only).                |
| Topic allowlist               |   A   | `SES_SNS_TOPIC_ARNS`; non-allowlisted topic → 400.                                                  |
| Subscription confirmation     |   A   | Confirms only when topic allowlist is configured; refuses open auto-confirm.                        |
| Duplicate events              |   A   | Unique `snsMessageId` + `onConflictDoNothing` in the same transaction as the state change.          |
| Delivery / bounce / complaint |   A   | Mapping incl. transient vs permanent bounce; suppression on hard bounce/complaint.                  |
| Suppression enforcement       |   A   | Send-time check; e2e.                                                                               |
| Tenant isolation              |   A   | Match by provider message id → email → project; unmatched events stored and flagged only.           |
| Production wiring             |   E   | No evidence any SES configuration set, SNS topic or subscription exists.                            |
| Real event end-to-end         |   E   | Never observed.                                                                                     |
| SNS→API reachability          |   E   | Public API must accept `text/plain`; not verified against a real SNS subscription.                  |

**Owner actions (AWS console, credentials required):** confirm the SES plan (Essentials vs à la carte),
create/confirm the SNS topic(s), subscribe `https://api.calder.click/v1/ses/events`, set
`SES_SNS_TOPIC_ARNS`, attach the configuration set to the sending identity, and capture one real
delivery, one hard bounce and one complaint with their suppression rows.

---

## 7. Reliability and failure-testing matrix

| Scenario                            | Expected                                                                | Actual / evidence                                          |        Data loss         | Recovery                  |     Status     |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | :----------------------: | ------------------------- | :------------: |
| Redis unavailable at boot           | Hosted process refuses to start; dev falls back in-memory               | `queue.config.test.ts`, `redis-down.e2e.test.ts`           |            No            | Fix Redis, restart        |      Pass      |
| Redis disappears mid-flight         | Producer fails fast; accepted rows stay `queued`; consumer reconnects   | e2e redis-down (CI)                                        |            No            | Drain after Redis returns |      Pass      |
| Redis restart                       | Subscribers reconnect; no duplicate sends                               | Redis integration suite (CI)                               |            No            | Automatic                 |      Pass      |
| Worker crash before send            | Job retried (5 attempts, backoff), row stays queued                     | retry tests; e2e worker; no crash injection locally        |            No            | Automatic or DLQ replay   |    Partial     |
| Worker crash after provider accepts | Retry may duplicate; usage stays exactly once                           | documented at-least-once trade-off in `docs/OPERATIONS.md` | Possible duplicate email | Manual review             |     Known      |
| Postgres unavailable                | Send fails 5xx; no partial state                                        | not injected locally; `/ready` code exists                 |            No            | Restore DB, retry         |    Blocked     |
| SES timeout / 5xx                   | Transient → retry with backoff                                          | `retry.test.ts`                                            |            No            | Automatic                 |  Pass (unit)   |
| SES permanent rejection             | Immediate `failed`, error persisted, no usage                           | provider error mapping tests                               |            No            | Fix + resend              |  Pass (unit)   |
| Duplicate API request               | Same response, one email, one usage row                                 | idempotency tests + e2e                                    |            No            | n/a                       |      Pass      |
| Duplicate provider event            | Ignored, 200                                                            | `ses-events` dedupe tests                                  |            No            | n/a                       |      Pass      |
| Invalid webhook signature           | 4xx/5xx; nothing applied                                                | signature tests                                            |            No            | Sender fixes              |      Pass      |
| Network interruption                | Transient classification; accepted rows durable                         | retry + drain tests                                        |            No            | Automatic                 |      Pass      |
| Queue backlog                       | Alerts `queue_depth_high`, `queue_oldest_job_stale`, `queued_email_age` | alert unit tests; **no monitoring vendor**                 |            No            | Scale worker / drain      | Coded, unwired |
| High-volume admission               | Quota + rate limit hold; no overrun                                     | quota tests; **no load test**                              |            No            | n/a                       |    Partial     |
| Deploy during processing            | Lease prevents double claim; in-flight function may abort               | drain lease tests; **not exercised on a hosted deploy**    |            No            | Drain re-claims           |    Blocked     |

Semantics to keep explicit in all communication:

- **Idempotent API requests:** guaranteed by stored responses.
- **Exactly-once usage metering:** guaranteed by the deterministic ledger primary key.
- **Retry-safe queue processing:** at-least-once; terminal-state checks prevent most double sends.
- **Exactly-once delivery:** **not guaranteed** and must never be claimed.
- **E2E nuance:** several e2e tests `return` early when Redis is unavailable, counting as a pass. The
  suite is enabled only with Redis in CI, but the code should fail loudly (`expect(redisOk).toBe(true)`)
  to prevent a future silent green.

---

## 8. Security acceptance

| Control                        | State | Evidence                                                                               |
| ------------------------------ | :---: | -------------------------------------------------------------------------------------- |
| API key storage                |   A   | SHA-256 hash only; prefix stored for display.                                          |
| Scopes (full/manage/send/read) |   A   | `requireScope` on routes; tests.                                                       |
| Rotation / revocation          |   A   | Endpoints + journey tests; audit rows.                                                 |
| Expiration                     |   A   | `expires_at` checked in auth.                                                          |
| Cross-tenant access            |   A   | Project-scoped queries; tenant-scope tests; templates prove 404 both ways.             |
| Environment isolation          |   A   | Key `env` gates mock vs live and metering; e2e test-env unmetred.                      |
| Suppression                    |   A   | Refused at ingest, before queue; e2e.                                                  |
| Rate limiting                  |   B   | Redis limiter with per-instance fallback; `/ready` reports degraded; not load-tested.  |
| Request validation             |   A   | Zod at boundaries.                                                                     |
| Outbound webhook signatures    |   A   | `t=<ts>,v1=HMAC-SHA256(ts.body)`; secrets per endpoint; rotate.                        |
| Replay protection              |   B   | Timestamp is signed; consumer-side tolerance is the receiver's job (documented).       |
| Inbound SNS authenticity       |   A   | Signature + cert origin + topic allowlist.                                             |
| Secret handling                |   A   | Env-only; `.env.example` has no values; secret scan in CI.                             |
| Sensitive logging              |   A   | Redaction module; logs carry ids, not keys.                                            |
| Admin permissions              |   A   | `ADMIN_API_KEY` for admin routes; founder-only control actions; audit entries.         |
| Disabled features              |   A   | 403 at API boundary; dashboard guards before data; direct nav shows Coming Soon.       |
| Admin plan assignment          |   C   | Founder-only, but **accepts `scale`** — must be restricted with the three-plan change. |

No security control was weakened. The three-plan work must keep the retired tier unreachable through
the admin API as well as the UI.

---

## 9. Commercial analysis

### 9.1 Assumptions (all explicit, all changeable)

- FX planning rate **₦1,400/USD** (spot on 8 Nov 2026: ₦1,341–1,428 depending on market).
- SES **Essentials $0.16/1,000** (default for accounts without activity since 1 Jun 2025, effective
  21 Jul 2026) and à la carte **$0.10/1,000** as the alternative. Calder's actual SES plan is
  unknown → owner action.
- Attachments: $0.12/GB; assume 32 KB average message (SES's own worked example) → negligible.
- Payment processing: 3% + $0.30 (conservative; local processors may be cheaper).
- Fixed platform cost: **$90/month** at small scale (Vercel Pro $20–40, Neon $25, Upstash $15,
  worker $5–15, monitoring $0–20, domain $2). Excludes founder time and support.
- Utilization means percentage of the monthly email allowance actually accepted and sent.

### 9.2 Marginal cost and contribution, per subscriber per month

Revenue uses the **naira** price (the more conservative USD equivalent).

**Starter — ₦5,000 ≈ $3.57**

| Utilization | Emails |   SES | Payment | Contribution | Margin |
| ----------- | -----: | ----: | ------: | -----------: | -----: |
| 10%         |  1,000 | $0.16 |   $0.11 |        $3.30 |    92% |
| 25%         |  2,500 | $0.40 |   $0.11 |        $3.06 |    86% |
| 50%         |  5,000 | $0.80 |   $0.11 |        $2.66 |    75% |
| 75%         |  7,500 | $1.20 |   $0.11 |        $2.26 |    63% |
| 100%        | 10,000 | $1.60 |   $0.11 |        $1.86 |    52% |

**Pro — ₦20,000 ≈ $14.29**

| Utilization | Emails |   SES | Payment | Contribution | Margin |
| ----------- | -----: | ----: | ------: | -----------: | -----: |
| 10%         |  5,000 | $0.80 |   $0.43 |       $13.06 |    91% |
| 25%         | 12,500 | $2.00 |   $0.43 |       $11.86 |    83% |
| 50%         | 25,000 | $4.00 |   $0.43 |        $9.86 |    69% |
| 75%         | 37,500 | $6.00 |   $0.43 |        $7.86 |    55% |
| 100%        | 50,000 | $8.00 |   $0.43 |        $5.86 |    41% |

At the USD list prices ($5 / $18) margins are slightly higher. At à-la-carte SES ($0.10/1k) SES cost
falls 37.5%.

### 9.3 Fixed-cost coverage (why the free tier and Starter matter)

| Scenario (50% utilization)      | Contribution/customer | Customers to cover $90 fixed |
| ------------------------------- | --------------------: | ---------------------------: |
| Starter only                    |                 $2.66 |                           34 |
| Pro only                        |                 $9.86 |                           10 |
| 50 Beginner (free) + 20 Starter |      free ≈ −$0.40 ea |  20 Starter → $53; short $37 |

- An all-Beginner base is pure cost: 100 active free users at 50% utilization ≈ **$40/mo** in SES alone,
  plus support, plus the storage of logs retained forever.
- At **full** free-tier utilization, 1,000 free users ≈ **$800/mo**, unfunded.
- Starter at ₦5,000 needs ~34 customers at 50% utilization just to cover hosting, before support,
  before founder time, before tax. That is not a viable paid tier at the current price.

### 9.4 Competitor comparison (official pages, 8 Nov 2026)

| Provider / tier     | Price                 | Volume             | Equivalent Calder   | Notes                                              |
| ------------------- | --------------------- | ------------------ | ------------------- | -------------------------------------------------- |
| AWS SES à la carte  | $0.10/1,000           | metered            | raw cost only       | $5 / 50k; you build the platform                   |
| AWS SES Essentials  | $0.16/1,000           | metered            | raw cost only       | new-account default                                |
| AWS SES Pro         | $0.22/1,000 + $105/mo | metered            | n/a                 | dedicated IP + VD                                  |
| Resend Free         | $0                    | 3,000/mo (100/day) | Beginner 5,000      | 30-day retention, 3 domains                        |
| Resend Pro          | $20                   | 50,000             | Pro $18 / ₦20,000   | overage $0.90/1k                                   |
| Resend Scale        | $90                   | 100,000            | —                   | dedicated IP add-on $30                            |
| Postmark Free       | $0                    | 100                | —                   |                                                    |
| Postmark Basic/Pro  | $15 / $16.50          | 10,000             | Starter $5 / ₦5,000 | extra $1.30–1.80/1k; 45-day retention              |
| Postmark @ 50k      | ≈ $66–87 list         | 50,000             | Pro                 | derived from published overage rates; **estimate** |
| SendGrid Essentials | from $19.95           | 50,000–100,000     | Pro                 | 60-day trial first                                 |
| SendGrid Pro        | from $89.95           | 100k–2.5M          | —                   | dedicated IP included                              |
| Mailgun Basic       | $15                   | 10,000             | Starter             | 1-day retention                                    |
| Mailgun Foundation  | $35                   | 50,000             | Pro                 | 5-day retention                                    |
| Mailgun Scale       | $90                   | 100,000            | —                   | 30-day retention                                   |

**Calder is the cheapest full-platform option at both 10k and 50k.** Pro undercuts Resend by ~$2–4/mo and
Mailgun by ~$21/mo; Starter undercuts Postmark/Mailgun by ~$10/mo at the same volume.

### 9.5 Sustainability verdict

- **Pro at ₦20,000/$18 for 50k is sustainable but not generous**: 41–69% contribution depending on
  utilization, and only 1.8–3.6× raw SES. It is defensible as a launch price; a 50k customer who also
  attaches files heavily erodes it.
- **Starter at ₦5,000/$5 for 10k is underpriced** for a paid tier with fixed costs: at 100% utilization
  it contributes $1.86, which is less than a tenth of the fixed cost it must help cover.
- **Beginner at 5,000 free is generous** relative to Resend's 3,000/100-per-day and Postmark's 100. It is
  acceptable as an acquisition cost at low volume, but must be watched, and the 500/day cap is doing
  real work.
- **FX is the largest commercial risk.** Naira-denominated revenue against dollar-denominated SES:
  at ₦2,000/USD, Starter's full-utilization SES cost is 64% of revenue; Pro's is 80%. A 15% FX move
  already changes Starter from 52% to ~40% margin.

### 9.6 Recommendation (owner approval required before any change)

| Plan     | Current             |        Recommended for paid launch | Rationale                                                         |
| -------- | ------------------- | ---------------------------------: | ----------------------------------------------------------------- |
| Beginner | ₦0 / 5,000 / 3      |                     keep unchanged | acquisition; watch free-tier burn                                 |
| Starter  | ₦5,000 / $5 / 10k   |              **₦7,500 / $7 / 10k** | 67% margin at full use; still below Postmark/Mailgun at 10k       |
| Pro      | ₦20,000 / $18 / 50k | keep for launch (or ₦25,000 / $22) | already the cheapest 50k platform offer; raise after first cohort |

Also recommended: price in both currencies (already), review NGN price when spot moves >15%, and never
add annual/overage tiers without a decision. **No price change is applied by this audit.**

---

## 10. Public site and product consistency

| Location                                       | Finding                                                                                        | Severity |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `/pricing` cards                               | Five cards, including Premium and Scale                                                        | **P0**   |
| `/pricing` comparison table                    | Five columns, five-element rows, `repeat(5)` grids                                             | **P0**   |
| Plan progression strip                         | Five steps including Premium/Scale                                                             | P0       |
| `what-is-calder` FAQ                           | Prints Premium price and volume                                                                | P0       |
| Starter/Pro cards                              | Claim environments, scoped keys, webhook replay, retention days that are not enforced          | P1       |
| Paid CTAs                                      | Render "Planned · not available yet" (honest) — keep until checkout exists                     | OK       |
| SEO structured data                            | Emits only the Beginner offer (correct: paid prices are not purchasable)                       | OK       |
| Docs `/docs/availability`                      | Honest, but references PR #87 as the automatic-delivery fix; should reference the actual state | P2       |
| Docs `/docs/usage-billing`                     | Check for five-plan language during implementation                                             | P2       |
| `docs/PRICING.md`                              | Five-column table, stale 5k/50k/250k ceilings, Premium follow-ups marked resolved              | P1       |
| `docs/MVP-FEATURE-MATRIX.md`                   | Five-tier matrix (documents reality; must move to three commercial + two retired)              | P1       |
| `PRD.md` §11                                   | Prices disagree with catalogue (owner decision, pre-existing)                                  | Owner    |
| `docs/ROADMAP.md`, `DESIGN.md`, `SEO_AUDIT.md` | Mention Premium/Scale as live tiers                                                            | P2       |
| Changelog                                      | Accurate; needs a three-plan entry when implemented                                            | P2       |
| SDK docs                                       | Correctly avoid install commands while unpublished                                             | OK       |
| Footer / status                                | No fabricated uptime; "public history begins at launch"                                        | OK       |

---

## 11. External developer acceptance

| Step                      | Status | Notes                                                                                                                 |
| ------------------------- | :----: | --------------------------------------------------------------------------------------------------------------------- |
| Account creation          |   B    | Email/password + OAuth implemented; e2e signs up, verifies and logs in **automatically**. Hosted OAuth not exercised. |
| Project creation          |   A    | Onboarding e2e creates org + project + key and sends.                                                                 |
| API key generation        |   A    | Same e2e; scopes/env tested.                                                                                          |
| Domain setup              |   B    | UI + verification code; real DNS/SES verification not executed.                                                       |
| Sender verification       |   B    | Service + tests; requires real SES identity.                                                                          |
| First API request         |   A    | e2e over HTTP with a live key (mock provider).                                                                        |
| Template create + send    |   A    | 7-test journey; dashboard send uses a verified project sender.                                                        |
| Webhook configuration     |   A    | API + dashboard; HMAC verified in tests.                                                                              |
| Delivery-event inspection |   B    | Mock events; real SES events unverified.                                                                              |
| Error handling            |   A    | Stable codes (`validation_error`, `plan_limit_reached`, `feature_not_available`, …); SDK maps them.                   |
| Node SDK                  |   B    | 17 unit tests + integration against the real app; **not published**, so `npm i calder` would fail.                    |
| Python SDK                |   B    | 16 tests (venv); **not published**.                                                                                   |
| Documentation accuracy    |   B    | Honest about billing/SMTP/SDKs; pricing page is now the main inaccuracy.                                              |

Biggest friction for a new developer: after signup there is no self-serve way to obtain a paid plan
(expected), and the docs correctly tell them to use HTTP rather than an unpublished SDK. Once a domain
is unverified, live sends fail with a clear error; the e2e proves test keys work without a domain.

---

## 12. Operational readiness

| Area                 | State | Notes                                                                                   |
| -------------------- | :---: | --------------------------------------------------------------------------------------- |
| API health/readiness |   A   | `/health` liveness, `/ready` dependency checks; tested.                                 |
| Worker health        |   B   | `/health`, `/ready`, heartbeat code; worker not deployed in a known host.               |
| Queue monitoring     |   B   | Alerts coded (`queue_depth_high`, `queued_email_age`, …); no monitoring vendor wired.   |
| Provider monitoring  |   B   | `provider_failure_sustained` alert exists; no dashboards.                               |
| Backups              |   E   | Neon assumed; no backup policy/restore evidence in repo.                                |
| Restore procedure    |   D   | No documented drill.                                                                    |
| Log retention        |   D   | No purge job despite printed retention days.                                            |
| Incident management  |   C   | Status page + incident list manual; no on-call rotation.                                |
| Rollback             |   C   | Vercel rollback possible; migrations forward-only; no documented rollback drill.        |
| Secret rotation      |   B   | `AUTH_SECRET` rotation documented; no scheduled rotation.                               |
| Alerting             |   B   | `/v1/cron/alerts` returns 503 when critical; requires pointing a monitor at it.         |
| Status communication |   B   | `/status` honest; no automation, no uptime history.                                     |
| Runbooks             |   B   | `docs/OPERATIONS.md` is strong (failure matrix, Redis posture); missing backup/restore. |

**What must alert:** worker heartbeat missing > 5 min; `queued_email_age` > 10 min; enqueue failures;
DLQ growth; provider failure rate; API 5xx; `/ready` 503; DB/Redis unreachable; disk/storage; certificate
expiry. **None of this is wired to a pager today.**

---

## 13. Billing readiness

Not implemented, and correctly not simulated. Before paid launch:

1. Provider integration (Bachs is referenced in the schema and env example, but no adapter exists).
2. Subscription creation with server-side price authority (never trust a client-sent amount).
3. Lifecycle: active, past-due, canceled, expired; webhook-driven.
4. Payment verification and idempotent webhook handling.
5. Failed-payment handling and dunning.
6. Cancellation, renewal, period boundaries.
7. Plan assignment writes the same `subscriptions` row the quota engine already reads — no second
   entitlement source.
8. Entitlement sync must refuse retired tiers and unknown tiers.
9. Upgrade/downgrade rules, proration, and an explicit policy for grandfathered Premium/Scale.
10. Invoice/receipt generation and tax handling (Nigeria VAT 7.5% if registered; USD sales may need a
    different entity/processor).
11. Audit history for every commercial change.

The three-plan catalogue can support this without redesign: `plans` + `plan_prices` + `subscriptions`
already model it; the missing pieces are the provider adapter, lifecycle states and UI.

---

## 14. Production acceptance matrix (deliverable C)

| Area                     | Current state                   | Evidence                                | Blockers                                        | Acceptance criteria                                          |
| ------------------------ | ------------------------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| API + auth + idempotency | Working                         | integration + e2e                       | —                                               | 202 + one row + replay 200                                   |
| Queue + worker           | Working in CI                   | e2e real Redis + worker                 | Redis absent locally; worker host TBD           | Send delivers with no manual drain in hosted env             |
| Live SES send            | Unverified                      | operator-reported manual drain (28 Oct) | AWS creds, verified identity, configuration set | Real accepted send → inbox; `sent` + event rows              |
| SES/SNS feedback         | Code ready, unwired             | unit/integration tests                  | SNS topic + subscription + config set           | Real delivered/bounce/complaint events → state + suppression |
| Templates                | Working                         | 7 tests (real Postgres)                 | —                                               | Journey passes in hosted env                                 |
| Dashboard                | Builds                          | `next build`, 235 tests                 | No browser QA                                   | Smoke journey in production preview                          |
| Public site              | Builds                          | build, 13 tests                         | Five-plan catalogue                             | Three plans, no retired tiers, no false claims               |
| Admin plan assignment    | Founder-only, accepts Scale     | code                                    | Retired-tier guard                              | Retired tier rejected with 400/typed error                   |
| Billing                  | Absent                          | no routes/adapter                       | Provider, tax, invoices                         | Paid checkout with verified webhooks and entitlement sync    |
| SDKs                     | Node/Python tested, unpublished | 17 + 16 tests                           | Registry publication, provenance                | Install from registry → send → log                           |
| Retention                | Claimed, not implemented        | no purge job                            | Decision + job                                  | Purge runs, or copy stops promising days                     |
| Backups/restore          | Unknown                         | docs only                               | Neon access                                     | Documented backup policy + one successful restore            |
| Monitoring               | Endpoints exist                 | alerts code                             | Monitor vendor                                  | Alerts page a human within 5 min                             |
| Status page              | Honest, manual                  | `/status`                               | Automation                                      | Incidents posted within agreed time                          |

---

## 15. Prioritized remediation backlog (deliverable D)

### P0 — before any external user

**P0-1 Make CI green and enforceable**

- Problem: `main` fails source-integrity; PR #96 fails format + config typecheck; no branch protection signal.
- Files: 34 formatting targets (16 PR + 18 pre-existing), `packages/config/src/features.test.ts:92`.
- Fix: run `prettier --write` on the failing set, fix the tuple-typing in the test, re-run
  `format:check`, `lint`, `typecheck`, tests and builds; require all checks before merge.
- Test: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test`.
- Acceptance: `verify` and `e2e` green on PR #96; `main` green after merge.

**P0-2 Implement the three-plan retirement (this assignment, pending approval)**

- Problem: Premium/Scale are commercially offered and assignable via the admin API.
- Files: `plan-limits.ts`, `features.ts`, `seed.ts`, `admin.ts`, control `actions.ts` and org pages,
  `apps/web/lib/plans.ts`, pricing components/CSS, `what-is-calder`, docs.
- Fix: §4.4 (config retirement, guards, grandfathering, copy).
- Test: §4.4G.
- Acceptance: three plans on the site; admin API rejects retired tiers; historical rows readable;
  no org silently downgraded; tests green.

**P0-3 Prove hosted automatic sending**

- Problem: no evidence a send leaves without a human; worker host TBD; cron daily.
- Files: `apps/api/vercel.json` (schedule), `docs/DEPLOYMENT.md`, worker deployment config.
- Fix: deploy the worker; set `API_URL` + `CRON_SECRET` on API and dashboard; set the cron backstop to
  every 5 minutes (or rely on the worker and document the daily cron as emergency-only); wire the alerts.
- Test: the 10 acceptance criteria in §5.2, executed against production with a real inbox.
- Acceptance: recorded evidence (ids, timestamps, event rows) for each criterion.

**P0-4 Wire and verify SES/SNS production feedback**

- Problem: no real event has ever been observed.
- Fix: configuration set on the identity, SNS topic, HTTPS subscription, `SES_SNS_TOPIC_ARNS`,
  signature verification in production.
- Test: one delivered, one hard bounce, one complaint; assert suppression rows and tenant isolation.
- Acceptance: production evidence for all three, plus a duplicate event and an invalid signature test.

**P0-5 Fix vacuous e2e passes**

- Problem: tests `return` silently when Redis is unavailable.
- Files: `apps/e2e/src/*.e2e.test.ts`.
- Fix: `expect(redisOk).toBe(true)` when `E2E_ENABLED`, or `it.skipIf` with a printed reason.
- Acceptance: a green e2e run proves Redis was actually used.

### P1 — before paid launch

- **P1-1 Billing**: provider adapter, subscriptions, webhooks, invoices, taxes, dunning, entitlement sync (§13).
- **P1-2 Retired-tier data decision**: run §4.5 against production; owner decides grandfather vs migrate; audit every change.
- **P1-3 Retention**: implement purge or stop printing day counts on `/pricing`.
- **P1-4 Enforced differences or honest copy**: scoped keys, webhook replay, environments, audit logs.
- **P1-5 SDK publication**: publish Node/Python with provenance, or remove all install guidance (currently correct).
- **P1-6 Backup + restore**: document Neon PITR and run one restore into staging.
- **P1-7 Load test**: 100 concurrent sends, quota boundary, 1,000 queued backlog.
- **P1-8 Starter repricing decision**: ₦7,500/$7 recommended before paid GA.
- **P1-9 Remove the dead `/api/billing/webhook` rewrite** (no route exists) or add the route with a signature check.

### P2 — operational improvements

- Status page automation and incident templates.
- Queue/provider dashboards (Upstash + SES metrics).
- Monitor pointing at `/v1/cron/alerts` with paging.
- Formatting the 18 pre-existing files and adding format to pre-commit.
- Refresh `docs/PRICING.md` ceilings and `docs/ROADMAP.md` five-tier language.
- Ruby/PHP SDK tests or removal from docs.
- Alert runbook with thresholds and owners.

### P3 — future

- SMTP gateway, inbound email, advanced analytics, uptime history, marketing suite, SSO, dedicated IPs.

---

## 16. Launch checklist (deliverable E — owner-verifiable)

**Repository and deploy**

- [ ] `main` CI green (all jobs), branch protection on.
- [ ] PR #96 merged; production deployed from `main`; record the commit sha.
- [ ] Migrations 36/36 applied in production; `db:drift` clean.
- [ ] API/dashboard/web Vercel projects on the same sha.

**Sending**

- [ ] Worker running; heartbeat visible; `/ready` 200.
- [ ] `API_URL` + `CRON_SECRET` set on API and dashboard; wake-up logs show success (not `missing_url`).
- [ ] Live key + verified sender; send returns 202; reaches `sent` < 60 s with no manual action.
- [ ] Inbox confirms receipt; `email_events` shows queued → sent; exactly one usage row.
- [ ] Duplicate idempotency key returns the original id.
- [ ] Suppressed recipient refused before queue.

**Provider feedback**

- [ ] SES configuration set attached; SNS topic subscribed and confirmed.
- [ ] `SES_SNS_TOPIC_ARNS` set; an event from a non-allowlisted topic is rejected.
- [ ] Real delivered / bounce / complaint events applied; hard bounce creates suppression.
- [ ] Duplicate SNS message ignored; invalid signature rejected.

**Failure**

- [ ] Redis stopped: send 202, stays queued, `/ready` 503, delivers after restore.
- [ ] Worker killed: queued mail delivers via backup path; alert fires.
- [ ] Provider rejection: `failed`, error visible, no usage.

**Plans and public site**

- [ ] `/pricing` shows exactly three plans, correct prices and volumes.
- [ ] No page mentions Premium/Scale; no paid CTA implies purchase.
- [ ] Admin API rejects `premium`/`scale`; control-plane selector only shows three.
- [ ] Any legacy Premium/Scale org displays "retired" and keeps its limits.
- [ ] No page advertises retention/environment/feature gates that are not enforced.

**Operations**

- [ ] Alert monitor pointed at `/v1/cron/alerts`; test page delivered.
- [ ] Backup policy documented; one restore tested.
- [ ] On-call owner and escalation path written down.
- [ ] Status page incident procedure agreed.

---

## 17. Owner decisions (deliverable G)

**Engineering (I can execute once approved)**

1. Approve the §4.4 retirement design (config-only, no destructive SQL, grandfathering).
2. Approve fixing CI formatting + the `features.test.ts` type error (P0-1).
3. Approve the e2e vacuous-pass fix (P0-5).
4. Decide whether to add `plans.retired_at` now or defer to billing.

**Product**

5. Sender/domain/seat values on Starter/Pro (currently 3/10, 10/25, 2/5) — confirm they are intended.
6. Retention policy: build purge or remove day-count claims.
7. Enforce or remove scoped keys / webhook replay / environments / audit-log tier claims.
8. Free-tier allowance: keep 5,000 or reduce toward Resend's 3,000.
9. SMTP/inbound/marketing: remain Coming Soon (recommended).

**Commercial**

10. Starter price for paid launch (recommend ₦7,500/$7).
11. Pro price (keep ₦20,000/$18 initially; review after first cohort).
12. Grandfathering for any Premium/Scale customers (production data unknown).
13. VAT/tax registration and invoice entity.

**External / access required**

14. SES plan confirmation + production identity/config set.
15. SNS topics and subscription confirmation.
16. Worker hosting provider and deployment.
17. Neon backup/restore access and policy.
18. Payment provider account (Bachs or alternative) and KYC.
19. Domain/DNS access if `api.calder.click` changes.
20. Monitoring vendor (or accept `/v1/cron/alerts` + curl monitor).

---

## 18. Appendix — commands run in this audit

All run on `22a12ab` (PR #96 head), 2026-11-08.

| Command                               | Result                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `gh pr checks 96`                     | `verify` **fail** (Format check), `source-integrity` pass, `e2e` pass, Vercel previews pass |
| `gh run list --branch main`           | last five runs **failure**                                                                  |
| `gh api …/commits/b7d6a48/check-runs` | `source-integrity` failure; `verify`/`e2e`/`migrate` skipped                                |
| `pnpm format:check`                   | **fail** — 34 files (16 PR, 18 pre-existing)                                                |
| `pnpm typecheck`                      | **fail** — `@calder/config` `features.test.ts:92`                                           |
| `pnpm --filter @calder/config test`   | 47 passed                                                                                   |
| `apps/api` full suite (real Postgres) | 273 passed, 0 failed, 0 skipped                                                             |
| `packages/db` full suite              | 69 passed                                                                                   |
| `apps/dashboard` suite                | 235 passed, 40 skipped, 0 failed                                                            |
| `apps/web` suite                      | 13 passed                                                                                   |
| `packages/queue` suite                | 19 passed, 9 skipped (Redis unavailable)                                                    |
| `packages/sdk-node` suite             | 17 passed                                                                                   |
| `sdks/python` (venv + pytest)         | 16 passed                                                                                   |
| `apps/worker` suite                   | 8 passed, 15 skipped (Redis unavailable)                                                    |
| Local migrations                      | 36/36 applied, drift clean                                                                  |
| Local plan data                       | 5 plan rows, **0 subscriptions**, 1 org                                                     |

**Not run:** hosted sends, real SES, real SNS, Redis fault injection locally, browser/visual QA,
load tests, restore drill. These are recorded as blocked or unverified above.

---

## 19. Round-3 implementation addendum (2026-11-08)

Owner approved execution in this order: plan retirement guards, control-plane
assignment, public pricing, docs, then verification. The audit above remains the
round-2 record; this section records what changed and the evidence produced.

### What changed

| Area          | Change                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue     | `retired: true` on Premium/Scale; `COMMERCIAL_PLAN_ORDER`, `KNOWN_TIERS`, `RETIRED_TIERS`; `planFor` own-property lookup keeps historical limits; `upgradeTierFor` stops at Pro.                                                        |
| Assignment    | `assertAssignableTier` rejects retired/unknown tiers with `plan_not_assignable` **before** any DB access in the admin API (400) and the founder-only control-plane action. Retired tiers have no seeded row to grant.                   |
| Seed          | Inserts Beginner/Starter/Pro only, additively (`onConflictDoNothing`). Historical Premium/Scale rows and subscriptions are untouched. No migration added or removed.                                                                    |
| Control plane | Grant selector offers Beginner/Starter/Pro; a retired current subscription is a disabled option and is labelled "Premium (retired)" / "Scale (retired)". Filters can still find historical accounts.                                    |
| Public site   | `/pricing`, comparison, structured data and the what-is-Calder FAQ render three plans. Retention, environments, tier-restricted key scopes and webhook replay remove/neutralise every unenforced claim.                                 |
| Docs          | PRICING, MVP-FEATURE-MATRIX, LAUNCH-STATUS, SYSTEM-EXPLAINED and CHANGELOG updated; ADR-057 records the retirement.                                                                                                                     |
| E2E honesty   | `critical-flow` and `redis-down` no longer `return` silently when Redis is absent; with `E2E_ENABLED=1` they throw, so a missing service fails the job instead of passing vacuously.                                                    |
| Security      | A second appended `eval`/`atob` payload was found in `source-integrity.test.ts`, which both the gate and its test exempted from scanning. Payload removed, fixtures assembled at runtime, self-exemptions removed; see SECURITY.md §16. |
| Tokens        | `--cp-*` control-plane aliases were referenced but never declared; declared in dashboard `globals.css` (the UI token test had been failing on this).                                                                                    |

### Evidence produced locally

| Check                                            | Result                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                              | pass — all matched files                                                                                                            |
| `pnpm typecheck` (build + tsc)                   | pass — 35 of 35 (later 37 of 37) tasks                                                                                              |
| `pnpm test`                                      | pass — 35 of 35 tasks; `@calder/api` 188 passed / 85 skipped (integration gated), `@calder/config` 51 passed, `@calder/ui` 9 passed |
| `packages/config` unit tests                     | 51 passed (3 files)                                                                                                                 |
| `apps/web` unit tests                            | 14 passed (plans + launch copy)                                                                                                     |
| `packages/db` plan compatibility (real Postgres) | 4 passed: three seeded plans, historical Premium row survives re-seed, Premium resolves 250,000/50                                  |
| `apps/api` source-integrity tests                | 42 passed                                                                                                                           |
| `node scripts/source-integrity-gate.mjs`         | clean, 668 source files (now includes its own test)                                                                                 |
| Local plan rows                                  | 5 (`free`, `starter`, `pro`, `premium`, `scale`), 0 subscriptions; seed did not delete the historical rows                          |
| Migration set                                    | unchanged; `drizzle/0035_quick_harrier.sql` still the last migration                                                                |

### Still blocked / not run

- **E2E with real Redis and Postgres** (`apps/e2e`): Redis is unavailable in this
  environment. The vacuous-return fix is typechecked and reviewed but must be
  proven in CI (`e2e` job with service containers). Not claimed as passing here.
- **Hosted send, SES, SNS, Vercel, production DB audit, browser QA, load test,
  restore drill:** still require owner access (E). Nothing in this round changes
  that status.
- **Billing/checkout:** intentionally out of scope; prices unchanged.

### Rollback

Revert this branch's commits. No migration ran, no row was deleted or updated by
the application code, and the seed is additive, so reverting restores the
previous code paths without a data repair. Historical Premium/Scale accounts
remain readable in either direction.
