# PROGRESS

## Done (2026-10-02)
- 00-inventory.md: 4 apps, 16 route mounts, 34 tables, 18 sidebar items, jobs/cron, env/third-parties, REAL/PARTIAL/STUB/ABSENT scorecard.
- Areas A–P (email scope): all sub-items PASS/FAIL/PARTIAL/NOT VERIFIED with file:line evidence (specialist passes + synthesis in 01-AUDIT.md).
- Ran: `pnpm --filter @calder/api typecheck` (exit 0); `pnpm --filter @calder/api test` (80 passed, 57 integration-skipped); `pnpm audit` (48 vulns 2L/25M/17H/4C); secret scan repo + history (no live committed secret; .env ignored/untracked, sandbox key only); `git status` (1 uncommitted onboarding file — not covered, re-audit after merge).
- 05-COMPETITORS.md: 11 email + 7 adjacent, matrix, pricing, win/lose lists, positioning, table-stakes.
- 06-DESIGN_PALETTES.md: 3 palettes, AA checks, Signal Ink recommended.
- 07 + landing-redesign/index.html: renders, iterated 3× from screenshots, shot-1440.png + shot-390.png captured.
- 02-LAUNCH_CHECKLIST.md (gated, traceable), 03-OWNER_ACTIONS.md, 04-RISK_REGISTER.md, 08-ARCHITECTURE_READINESS.md, 09-FIX_PROMPTS.md.
- Nothing modified outside /audit (verified: `git status --short` shows only pre-existing onboarding diff).

## NOT done / remains
- Full `pnpm typecheck` (timed out 180s) — re-run per-package or longer timeout.
- `pnpm lint`, `pnpm build`, `pnpm format:check` outputs — not captured this pass.
- 57 integration tests — need Postgres+Redis (`RUN_INTEGRATION_TESTS=1`).
- Real-browser walkthrough of app + marketing site (signup→send→webhook), real-device screenshots of the actual site, Lighthouse — need running env + owner creds (see 01 NOT VERIFIED #1, #10, #12).
- Load test, SES/SNS live verification, Bachs approval, restore drill, TLS/takeover checks, Ruby/PHP SDK runs, FX + margin inputs — all owner-side (03).
- COMPLETION GATE status: areas A–P statuses ✅ | sidebar+claims classified ✅ | competitors ✅ | prototype+renders+screenshots ✅ | findings↔checklist traceability ✅ | nothing outside /audit ✅. Remaining gate debt is live-environment verification (browser, staging, AWS, money) — explicitly listed in 01 NOT VERIFIED + 03, not cut corners on.

## Phase 2, production reliability + operations (2026-10-05)

Audit items addressed (evidence: exact commands in the Phase 2 PR):

- **OPS-001a backups/RPO/RTO** — PARTIAL: `scripts/backup-verify.mjs` (capability + tooling report) and `scripts/restore-drill.mjs` (scratch-database restore with a machine-written report) exist and were executed to the extent the environment allows; provider capability cannot be verified without provider credentials, so a real restore drill is **OWNER ACTION REQUIRED** and no drill is claimed. RPO/RTO are provisional in `docs/OPERATIONS.md` §7.
- **OPS-001b rollback** — REAL: `docs/DEPLOYMENT.md` § Rollback (detection → containment → code revert → migration handling → queued jobs → recovery verification) plus `pnpm verify:deploy` for post-deploy checks. Rehearsal against a real deployment remains owner-side.
- **OPS-001c error tracking** — REAL: Sentry-class integration behind `SENTRY_DSN`, opt-in, lazily imported, redaction-tested (`packages/observability`, 31 tests). DSN provisioning is owner-side.
- **OPS-001d on-call/severity/postmortem** — PARTIAL: severity model, escalation path and the incident runbook set live in `docs/OPERATIONS.md` §8; naming the rotation and paging destination is owner-side.
- **OPS-002 alerting channel + honest status page** — PARTIAL: 12 configurable alert rules with trigger/severity/meaning/check/response, `GET /v1/cron/alerts` returns 503 on critical (monitor-friendly), worker `/status` exposes job and queue signals. The paging destination is owner-side. The status page now claims only what is monitored.
- **Redis mandatory in staging/production** (§6–7) — REAL: boot refusal + `QueueConfigurationError` instead of the previous silent `InMemoryQueue` fallback; requirement matrix documented.
- **Redis-failure behaviour** (§8) — REAL: `apps/e2e/src/redis-down.e2e.test.ts` asserts durable acceptance, no metering, no silent switch, and drain delivery after Redis returns.
- **Exactly-once metering / idempotency** (§10) — covered by E2E replay + drain integration tests.
- **TEST-001 one e2e journey** — REAL for HTTP level: `apps/e2e` (signup → verification → login → org/project → API key → send → queue → worker → mock provider → delivery state, plus Redis-outage durability), wired into CI with Postgres + Redis service containers. Browser-level Playwright coverage is **not** implemented: browser binaries could not be downloaded in the implementation environment, so it is reported as missing rather than passed.

Nothing in this phase merged into product scope from `docs/ROADMAP.md` Phase 3; out-of-scope findings are listed in the PR description.
