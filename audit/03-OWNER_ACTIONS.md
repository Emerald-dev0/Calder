# 03 — Owner actions (needs a human with keys, cards, or legal standing)

Nothing here can be done by a coding agent alone. Ordered by launch-blocking impact.

1. **Hosting + data durability (Gate 0).** Choose prod Postgres (Neon recommended per DEPLOYMENT.md:40-44, or other) with PITR; choose Redis (Upstash recommended per DEPLOYMENT.md:45-47, `rediss://`); enable backups; execute one restore drill; record RPO/RTO. Without this OPS-001a cannot close.
2. **AWS SES production access + SNS wiring (Gate 1).** Confirm production-access granted (not sandbox), region, 50k/day-14/s grant status (`docs/SYSTEM-EXPLAINED.md:245` claims it — re-verify), configuration set + SNS topics + allowlist (`DEPLOYMENT.md:130-196`). Without this, bounces/complaints never come back and DOM-001a cannot close.
3. **Bachs (or chosen rail) approval + NGN settlement (Gate 2 long pole).** Confirm provider approval status, webhook signing, NGN card/bank-transfer/settlement behavior, receipts/VAT handling, refund path. Until signed off, paid plans stay early-access (BILL-001a). Start this week — approvals take weeks.
4. **Error-tracking + alerting accounts (Gate 1).** Create Sentry-class project, hand DSN to agent; decide who gets paged (email/Slack) and write it in OPERATIONS.md.
5. **Registries + legal (Gate 1–2).** npm + PyPI publish rights (DX-001a); confirm business registration status for payments/AWS; review Terms/Privacy/AUP/DPA with counsel; set abuse@ + support@ inboxes and actually monitor them; decide data-retention timetable (LEGAL-001).
6. **Money inputs (Gate 2).** Current FX assumption for NGN prices, SES $/1k, infra $/mo, support $/mo — needed for margin math (BILL-003). Reprice or cap any losing plan before launch.
7. **Sendly-watch + positioning call (Gate 2).** Read 05-COMPETITORS.md §1.11; decide whether to acknowledge Sendly NG or ignore; approve the one-sentence positioning before landing copy locks (07).
8. **Browser-verification session (Gate 1).** Sit with agent (or do solo): fresh signup → first delivered email timed; bounce/complaint simulation; webhook receipt; screenshots at 1440/390. Closes NOT VERIFIED #1, #10, #12.
9. **Rooms the agent cannot enter.** DNS for your own sending domain (SPF/DKIM/DMARC + custom MAIL FROM); Vercel project env + cron schedules; GitHub secrets/CI permissions; any production data — agent never touches it.
10. **Spend TO unchanged.** No DNS, cloud, billing, or paid-service change was made in this audit. Anything above that costs money or changes prod is listed here, not done.
