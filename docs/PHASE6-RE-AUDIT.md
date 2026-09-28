# §11 Security Re-Audit — Phase 6 Sign-off (2026-09-25)

Every item from ROADMAP §11 raised to its current state. Executed as a
code-anchor audit (grep-verified), test gate run immediately after:
**242 unit tests green across 10 packages (0 failed; integration suites
skipped — Postgres down in the sandbox, re-run with `pnpm dev:int`).**

## HIGH

| Item                           | Verdict                       | Evidence                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 test keys deliver in prod   | RESOLVED (earlier phase)      | `calder_sk_test_` prefix split in `packages/auth/src/api-keys.ts`; `@calder/providers` refuses simulated delivery under `NODE_ENV=production` (config schema).                                                                              |
| H2 no metering/quotas          | RESOLVED (earlier phase)      | `apps/api/src/lib/quotas.ts` `checkSendQuota`/`assertQuotaAllowed` at ingest; `usage-quota.integration.test.ts`.                                                                                                                            |
| H3 webhooks broken             | RESOLVED (earlier phase)      | `apps/worker/src/webhook-consumer.ts:145` builds `webhook-signature` from the stored secret; encrypted-secret storage verified; deliveries + retries persisted.                                                                             |
| H4 OAuth unverified-email link | **RESOLVED (Phase 6 / M6.1)** | `packages/auth/src/oauth.ts`: unverified-at-provider email NEVER auto-links — regardless of Calder-side `emailVerifiedAt` — throw directs to original sign-in path. Verified side also back-fills `email_verified_at`. ADR-040 decision #1. |
| H5 idempotency race            | RESOLVED (earlier phase)      | `email-service.ts` looks up the durable idempotency row BEFORE persist+enqueue; replay returns the stored response without side-effects.                                                                                                    |
| H6 synthetic-send fallback     | RESOLVED (earlier phase)      | `worker.ts:267` "NEVER fabricate"; `worker.missing-row.integration.test.ts` pins no-email-no-events.                                                                                                                                        |

## MEDIUM

| Item                                         | Verdict                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 suppression at ingest                     | RESOLVED — `email-service.ts:177-190` checks `suppressions` with reason at ingest, documented.                                                                                                                                                                                                                               |
| M2 in-memory limiter                         | **RESOLVED (Phase 6 / M6.1)** — `RedisRateLimiter` (INCR+PEXPIRE fixed-window, MULTI-atomic) activates whenever `REDIS_URL` is set; prod WITHOUT it boots with a loud degraded-mode warning instead of pretending limits are exact. ADR-041. Rate-limits stamped at magic-link consume too (20/min/IP).                      |
| M3 drain twins/no lease                      | RESOLVED (earlier) — single drain impl + queue→sending claim with a stale-"sending" lease window (`lib/drain.ts:28-41`).                                                                                                                                                                                                     |
| M4 no lockout/logout-everywhere/reset-revoke | **RESOLVED (Phase 6 / M6.1)** — DB-progressive lockout (`failed_login_attempts`/`locked_until`, pre-scrypt check, 30s→30m exponential, unit-tested `lockoutDelayMs`), every-session session-inventory UI in settings (per-session revoke + sign-out-all-others), reset revokes all sessions + clears lockout. ADR-040 #2/#3. |
| M5 seed-demo prod-pollutable                 | RESOLVED (earlier) — `seed-demo.ts:222` hard-aborts in production. FK to org founder consistent (`org_avenor` membership + org row).                                                                                                                                                                                         |
| M6 queries.ts unguarded import               | **RESOLVED (Phase 6 / M6.2)** — `apps/dashboard/lib/server-only.ts` zero-dep load-time guard imported by `lib/control/queries.ts`; client-bundle import throws at build/load.                                                                                                                                                |
| M7 magic-link callback unlimited             | **RESOLVED (Phase 6 / M6.1)** — callback consumes bounded at 20/min/IP; misuse floods land on `/login?error=throttled`. Residual prefetch risk documented in ADR-040.                                                                                                                                                        |
| M8 bare `x-vercel-cron`                      | **RESOLVED (Phase 6 / M6.1)** — `CRON_SECRET`/`ADMIN_API_KEY` bearer required whenever `NODE_ENV=production`; the bare-header convenience is dev-only. ADR-040 #6.                                                                                                                                                           |

## LOW

| Item                              | Verdict                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 unsalted OTP hash              | **RESOLVED (Phase 6 / M6.1)** — exceeds "pepper it": v2 = HMAC-SHA256 with server secret, purpose+email bound (kills cross-purpose replay too), dual-accept window for already-issued challenges, constant-time compare preserved. ADR-040 #4. |
| L2 dead prefix-length code        | status carried from earlier phases (cleanup pass) — not re-raised, non-security.                                                                                                                                                               |
| L3 narrow transient classifier    | carried (worker classifier widened in earlier phases) — non-auth.                                                                                                                                                                              |
| L4 Gmail cap counts non-sent rows | carried (M2.4 exact sent-count metric).                                                                                                                                                                                                        |
| L5 sender sub-fetch scoping       | contained per original note.                                                                                                                                                                                                                   |
| L6 no CSRF tokens                 | accepted and documented (SameSite=Lax baseline).                                                                                                                                                                                               |

## CONTROL-PLANE TRUTH PASS (M6.2) — signed

- **Audience counts now honest**: plan tiers counted from active subscriptions
  (free = orgs − active-subbed orgs); "users with projects"/"sent email"
  counted via the membership→project chain, not JSONB distinct blobs;
  "inactive" uses `sessions.last_seen_at` (no 30-day session seen), not
  account age; "metered orgs this week" relabeled to what the query counts.
- **Grants**: `setSubscription` is now FOUNDER-ONLY (was any non-read-only)
  and REQUIRES reason (≥6 chars, audited); `setPlatformRole` requires a
  prompted reason, validated server-side, stored in audit `metadata.reason`.
- **Settings presence checks truthful**: webhook secret envelope now reads
  `AUTH_SECRET` length (was a hardcoded "configured" for a nonexistent var);
  CRON password, limiter backend, OTP storage shown with live posture badges
  including degraded-mode warnings.
- **Abuse ladder** restyled as numbered steps with trigger detail (the fake
  1-6 `BarList` widths were misleading volumetrics).
- **Health page**: live components stay computed; composite score stays
  explicitly "planned" with the dependency named — nothing posed as live.
- **WHERE-clause audit** of control read pages: no unscoped customer read
  found; all multi-org data reads start at `requireControl`/`getTenantContext`
  and filter by org/project; state filters verified present
  (`subscriptions.status="active"`, transport status grouping, email status
  lists); no archivedAt/deletedAt columns exist in this schema, so no soft-
  delete filter debt exists.
- **Least-privilege recheck**: founder is the only role able to mutate
  platform-role assignments AND plan grants; both actions audit-logged with
  reasons.

## SIGN-OFF

All §11 HIGH items: closed. All §11 MEDIUM items: closed (M2, M4, M6, M7, M8
this phase; M1/M3/M5 prior). Production-security sign-off for launch is
**GRANTED on code posture**, pending the environment items in the launch
checklist: apply migrations including `0022_auth_hardening`, set
`CRON_SECRET`/`REDIS_URL`/production envs, run the integration suites on a
live Postgres, and finish the manual DNS/AWS pass. No misleading control
numbers remain.
