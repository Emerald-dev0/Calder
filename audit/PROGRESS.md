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
