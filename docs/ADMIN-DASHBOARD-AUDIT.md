# Admin Dashboard / Control Plane Audit (2026-11-06)

## Scope
Audited the **Control Plane** (`apps/dashboard/app/control/*`, `apps/dashboard/lib/control/*`) and legacy admin API surface (`apps/api/src/routes/admin.ts`, `apps/api/src/middleware/admin.ts`). `/admin` redirects to `/control`.

## Architecture / enforcement (kept)
- **Auth/role boundary**: `requireControl()` / `requireSection()` (`lib/control/guard.ts`) resolve platform roles via DB + `FOUNDER_EMAILS` bootstrap; section access enforced server-side from `ROLE_SECTIONS` (`lib/control/roles.ts`). Navigation is rendered from the same section model.
- **Admin API**: `/v1/admin/*` uses `adminAuthMiddleware` (constant-time Bearer `ADMIN_API_KEY` comparison; disabled with 503 when unset). Sensitive routes include rate limiting and idempotency where applicable (sending-status).
- **Auditability preserved**: organization sending safety, subscription grants, Gmail transport reactivation, role grants/revokes, and confirmation-email editor actions write audit records / use audited backend paths.

## Inventory & classification (summary)

| Area | Status | Action |
|---|---|---|
| Command Center overview/alerts/health | Functional (live DB/Redis probes, honest nulls) | **Keep/Fix copy** |
| Customers (users/orgs/projects/detail, safety actions) | Functional, permissioned, audited where implemented | **Keep** |
| Observability logs/alerts | Functional from durable email events; search limited | **Fix**: event search supports recipient/subject/email ID (`em_*`) and shows email ID |
| Platform email/deliverability/webhooks/usage | Functional from durable records | **Fix**: failure rows link to log search; removed "mock in dev" wording |
| Infrastructure Redis/DB/queues/providers/workers | Functional probes/derived metrics; workers lack per-process telemetry | **Keep/Gate**: fleet instrumentation explicitly gated |
| Billing overview/subscriptions/plans | Functional table reads; payments not enabled | **Keep with gate**: clear "payments not enabled / not collected revenue" banner; coupons/credits/invoices/entitlements gated (no fake workflows) |
| Communications broadcasts/company/audiences/templates/internal delivery | Functional existing internal paths | **Keep**; campaigns/automations **gated** (no fake engines; Gmail never campaign path) |
| Operations capabilities/maintenance/status | Capability registry partly config-derived; runtime controls not implemented | **Fix/Gate**: renamed to Capabilities, reads real config flags; maintenance/status publication gated |
| Security abuse/restrictions/admin access/events | Abuse + Gmail suspension/reactivation functional; security event stream partial | **Keep/Gate**: enforcement UI breadth gated; admin-access hardening described honestly (SECURITY.md boundary) |
| Growth/waitlist | Functional | **Keep**; acquisition/referral reward claims gated to live data |

## Implemented changes
- `lib/control/queries.ts`: `eventRows` search now matches recipient, subject, event email ID, and exact `em_*` ID; rows include `emailId`. `recentFailures` includes `from`.
- Observability Logs UI: search placeholder + Email column for investigations.
- Deliverability: Email ID column linking to Logs search; clearer copy.
- Platform/API/Metrics: request/aggregation analytics **gated** until telemetry storage exists; show durable key counts and links to real surfaces.
- Workers/Cron/Storage/Networking: show only durable/available signals; fleet/job/telemetry/storage/network instrumentation **gated**.
- Operations: "Feature Flags" → "Capabilities", config-derived where real (`FEATURE_MARKETING`, `ADMIN_API_KEY`); maintenance/status publication **gated** (no fake switches/publication).
- Incidents: **gated**; directs operators to Alerts/Logs/Queues/Deliverability.
- Security: Restrictions links to org; events/restrictions/admin-access hardening **gated/honest**; Gmail reactivation remains permissioned + audited.
- Billing: honest payments-not-enabled banner; coupons/credits/entitlements/invoices **gated** (no fake records/workflows). Subscriptions/plans remain operational table views.
- Communications: campaigns/automations **gated**; custom audience segments **gated**; internal broadcast/delivery paths unchanged.
- UI primitive: `Planned` now explicit gate (`Not enabled`/`Gated`/`Disabled`) to avoid "coming soon" marketing language.
- Removed misleading "mock in dev" provider/config copy from Control Plane surfaces.

## Security & permission notes
- No client-only authorization added; all checked pages/actions use server guards. Founder-only and role-scoped actions remain server-enforced.
- Dangerous/sensitive actions keep reason/idempotency/audit patterns where implemented (org safety, plan grants, role changes).
- Gated pages do **not** expose non-functional destructive controls.
- Remaining risk: `FEATURE_MARKETING` is config/env, not a runtime audited flag service; capability registry now states this honestly.

## Tests / verification
- **Executed in this environment**: static inspection and targeted code edits; `git diff --stat` captured.
- **Not executed (environment limitation)**: `pnpm` workspace dependencies/node_modules and toolchain binaries (`eslint`, `tsc`, `vitest`) were not installed in `/workspace/app` (`node_modules missing`; commands failed with ENOENT). Full dashboard lint/typecheck/vitest and API route tests could not run here.
- **Recommended before merge** (with deps installed): `pnpm --filter @calder/dashboard typecheck && pnpm --filter @calder/dashboard lint && pnpm --filter @calder/dashboard test`; run API/admin-relevant tests; manually verify Control Plane role access, org suspend/resume (idempotency), Gmail reactivation, and log search by `em_*`.

## Outstanding limitations / deferred
- No runtime maintenance/feature-flag/incident/status-publishing backends were invented; gated intentionally.
- No billing provider enablement, coupon/credit/invoice ledgers, or campaign engine changes (out of safe scope / not implemented).
- Request/API latency, worker per-process fleet, cron job registry, networking/storage telemetry require real telemetry/storage.
- Security hardening (MFA/passkeys, break-glass, sensitive-action reauth) is constrained by SECURITY.md auth-boundary status and remains deferred/gated.
