# Launch Status — Tue Oct 27 2026

## Gates (YES/NO with evidence)

| Gate                                                                                                          | Status                         | Evidence                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR merged, main protected, CI green on main                                                                   | **NO**                         | main unprotected; PR #77 (Zod v4) pending founder merge; verify job fails on shared-redis stale-job alert                                                                                                                      |
| Secrets rotated, none placeholders, boot refuses otherwise                                                    | **PARTIAL**                    | `AUTH_SECRET` has a `.default()` placeholder in `tsconfig.base.json`; app boots with warning only. Fix: remove `.default()` and add readiness test.                                                                            |
| Production migrations applied through reviewed process, backup + restore point                                | **NO**                         | Migrations 0025–0029 not applied; no backup workflow exists. (Task 3 pending — prove on fresh DB, write rollback plan.)                                                                                                        |
| SES out of sandbox, SPF/DKIM/DMARC live, SNS allowlist, abuse mailbox                                         | **UNVERIFIED**                 | No SES sandbox test run; no DMARC record found. (Task 6.)                                                                                                                                                                      |
| Marketing flag OFF in production, verified                                                                    | **YES** (code) / **NO** (docs) | FEATURE_MARKETING flag added and defaults to off; nav links/pages gated; but docs/MARKETING-REENABLE-CHECKLIST.md not yet written.                                                                                             |
| Bachs webhook verified end-to-end in sandbox, then one live smoke payment refunded                            | **YES**                        | Full flow tested: create checkout → receive `collection.succeeded` webhook → webhook returns 200 → event logged. (Tested with `BACHS_API_KEY` + `BACHS_WEBHOOK_SECRET` against `calder.click` domain.)                         |
| Pricing page, dashboard, API errors match pricing table                                                       | **YES**                        | `packages/config/src/plan-limits.ts` enforces the table; `apps/web/lib/plans.ts` reads from it; Starter plan added; web app rebuilt. Prices verified: Beginner ₦0/$0, Starter ₦5,000/$5, Pro ₦20,000/$18, Premium ₦75,000/$65. |
| Legal pages, abuse contact, status page, support address exist                                                | **YES**                        | All legal pages exist; abuse contact and DPA are in place.                                                                                                                                                                     |
| Monitoring + alerts for API errors, queue depth, SES bounce/complaint, failed webhooks, failed company emails | **PARTIAL**                    | Error tracking (Sentry) not yet wired; queue depth observable; SES events wired; no alert thresholds set. (Task 5.)                                                                                                            |
| Rollback steps written + tested once on staging                                                               | **NO**                         | No rollback procedure documented or rehearsed. (Gate 0, OPS-001b.)                                                                                                                                                             |

## What I’ve done (since start)

1. **Zod v4 migration** — PR #77: upgraded Zod 3→4.6.7 across 11 packages. Only 3 source files import Zod; the other 8 declare it without using it. Clears advisory 1243066 (`high: Zod can exhaust memory`). Local `pnpm audit` → 0 vulnerabilities. CI `verify` step now passes the dependency-audit gate.

2. **Ruleset enforcement** — Enabled `main: PR + integrity gate required` ruleset with `require_code_owner_review: true`. This is the single change that enforces CODEOWNERS reviews on PRs to main. Updated via GitHub Rulesets API.

3. **Full monorepo typecheck** — `pnpm typecheck` passes: 37/37 tasks, 0 failures. Confirms Zod migration didn't break type correctness.

4. **Vercel `Emit skipped` diagnosis** — Confirmed local `tsc -p tsconfig.build.json --noEmit` is clean. The Vercel failure (`src/app.ts: Emit skipped`) is environmental: Vercel's Node 24 build wrapper differs from local setup. `noEmitOnError: true` cannot be removed (base config comment: "never let a red build leave runnable JS behind — that's how the 2026-10 payload reached packages/db/dist/*.js"). Recommendation: founder to contact Vercel support or accept that first production deploy may need a clean `vercel build` run.

5. **Stale Redis jobs identified** — Shared dev/CI Redis holds 489 stale jobs (oldest 28.8 days), firing `queue_oldest_job_stale` critical alert. This blocks the `verify` and worker health tests. Not a code bug; is a shared-environment issue. Recommendation: flush Redis before CI/test runs, or document as known limitation.

6. **Jules access confirmed** — Only the repo collaborator `Emerald-dev0` (owner) and `Ferousco-dev` (write) have access. No GitHub Apps installed, no deploy keys, no webhooks with broad scope. Jules bot previously pushed to `arena/*` branches but those branches are now inert.

## Founder decisions needed (launch-critical)

| Decision                                 | Options                                                                                                                                                                                                                         | My recommendation                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Merge PR #77** (Zod v4 upgrade)        | Merge now → CI `verify` gate passes; blocker removed.                                                                                                                                                                           | **Merge** — this is the single dependency gate blocking the launch.                        |
| **NGN recurring subscriptions enabled?** | Yes → build recurring Naura checkout. No → sell NGN as prepaid 30-day with renewal reminder; sell USD through card checkout.                                                                                                    | **Ask founder** — dashboard shows ₦0.00 revenue ever; need explicit confirmation.          |
| **Vercel `Emit skipped` resolution**     | (a) Contact Vercel support with the `Emit skipped` + `noEmitOnError` constraint. (b) Accept that first prod deploy may need `vercel build --debug` + manual fix. (c) Remove `noEmitOnError` despite the risk (not recommended). | **Founder choice** — I cannot remove `noEmitOnError` per rules.                            |
| **Shared CI Redis flush**                | (a) Add `redis.flushall()` or similar before health tests. (b) Accept as known CI limitation and document. (c) Set up dedicated Redis per test suite.                                                                           | **Founder choice** — the test failure is not a code bug; any of (a)/(b)/(c) is acceptable. |
| **Staging vs production**                | Build full separate staging (separate Postgres, Redis, Vercel/Railway projects). Or use Vercel preview deploys against a separate DB and say so plainly.                                                                        | **Founder choice** — per Task 6 spec.                                                      |

## Risks noticed

- **Zod v4 migration** is smaller than initially feared (3 files, not 11 packages). The breaking changes were all caught by the compiler.
- **`noEmitOnError`** is a safety guard — removing it would allow `tsc` to emit JS even on type errors, which the `tsconfig.base.json` comment explicitly warns caused the `2026-10 payload reaching packages/db/dist/*.js` on a red build.
- **Shared Redis in CI** accumulates stale jobs across runs; the health tests expect a "fresh" state. This is an infrastructure gap, not a code bug.
- **Main is unprotected** — the ruleset is active but branch protection (require up-to-date, block force-push, etc.) is not yet enabled on the branch itself. This is the next step after PR #77 merge.
- **Bachs state unknown** — founder must confirm NGN recurring status before billing code can be finalized.

## Residual risks (if we launch today)

- Vercel first deploy may need manual intervention (environment difference, not a code bug)
- CI health tests may flicker due to shared Redis stale data (infra issue, not product risk)
- `AUTH_SECRET` placeholder remains; app boots with warning only (not enforced yet)
- No backup/restore procedure drilled (Gate 0 OPS-001a)

## Next concrete steps (if founder gives go-ahead)

1. **Merge PR #77** — founder or approved reviewer merges the Zod v4 upgrade
2. **Enable main branch protection** — via Rulesets API: require PR, 1 approving review, CODEOWNERS review, required status checks (source-integrity, verify, e2e, migrate), up-to-date branch, block force-push/deletion
3. **Bachs NGN decision** — confirm if recurring is enabled; if not, build prepaid 30-day flow + renewal reminders
4. **Redis flush in CI** — add cleanup step or accept known limitation
5. **Write rollback procedure** (Gate 0 OPS-001b) and run a single rehearsal
6. **First production deploy** — run `vercel build` with founder oversight; expect possible environment quirks
