# Founder control-plane rebuild — 2026-10-29

## Owner decisions

- **Leave signup open.** No invitation-only rollout, registration disablement or
  signup/auth behavior change is authorized by this work.
- Audit and validate **all** existing analytics: acquisition, activation and
  delivery/operations. Reuse current tracking and data sources.
- Redesign the founder workspace; do not count visual changes as operational wiring.
- Billing remains unavailable; redesign does not authorize implementing payments.

## Source audit (not hosted certification)

| Area             | Existing implementation / gap                                                                                      | Required next proof                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Shell            | Theme variables scoped to `.cp`, but shell omitted that class; theme leaked from customer dashboard                | Actual light/dark customer-theme isolation; desktop/mobile navigation                                                   |
| Growth           | `analytics-queries.ts`, range engine, waitlist/source/country/CTA reports exist                                    | Ingest → stored event → reports; deduplication, time boundaries, attribution/privacy and retention                      |
| Activation       | Some conversion queries exist, not a verified end-to-end onboarding cohort                                         | Account verified → organization/project → sender verified → first accepted send, explicit identity/cohort semantics     |
| Customers        | User/org/project queries and detail pages; organization sending suspension/action exists                           | Role matrix, audited reason, atomic key revocation, resume does not resurrect keys; synthetic tenant fixtures           |
| Delivery         | Outcome queries, queue-derived backlog, transport/provider views, delivery-truth integration suite                 | Provider feedback ingestion and hosted no-manual-drain send; never equate sent with delivered                           |
| Observability    | Metrics route was planned-only; alert rules/query-derived outcomes already exist                                   | Actionable notification routing, incident lifecycle and acknowledgment; latency/depth history needs instrumentation     |
| Maintenance      | Planned page, no global operational switches                                                                       | Shared durable control enforced by every relevant drain/worker; authenticated/audited changes, restart and resume tests |
| Capability flags | Static list; incorrectly marked SMTP ON and implied Gmail availability                                             | Read implementation/config state honestly; do not confuse a registry row with an effective runtime switch               |
| Infrastructure   | DB/Redis checks and database-derived queue counts exist; worker/storage/network/cron pages include planned content | Real heartbeats, stale/missing states, job execution outcomes; never infer Redis queue health from Postgres counts      |
| Security/admin   | Role guard, role actions, audit queries and restrictions exist                                                     | Direct-action authorization, CSRF, tenant boundaries, audit and re-authentication tests; no fake MFA toggle             |
| Support          | Planned support workflow                                                                                           | Read-only customer troubleshooting timeline, evidence links, redacted exports; no implicit impersonation                |
| Communications   | Broadcast/editor/audience source exists; automations planned                                                       | Safe preview/test → approval → enqueue; permissions, consent, deduplication and delivery evidence                       |
| Billing          | Coming-soon pages                                                                                                  | Keep unavailable; do not imply payment state from plan configuration                                                    |

## Foundation implemented in this change

- Restore `.cp` on the shared shell so existing panels/theme actually resolve.
- Searchable, collapsible workspace groups instead of an always-expanded page wall;
  one deepest active route; native keyboard-operable disclosure; mobile menu with
  search instead of dozens of horizontal tabs. Keep role-filtered input navigation.
- Shared loading/error boundaries: unavailable records are not zero; no raw error
  text or connection details rendered. No new auth bypass or diagnostic endpoint.
- Metrics route reads existing `deliveryOutcomeSummary(30)`, `queueDerived()` and
  `webhookStats()` after its section guard. Explicit time scopes and denominator;
  current sent status is not cumulative acceptance or inbox delivery. Missing API
  latency/provider latency/depth history is clearly unmeasured.
- Correct SMTP/Gmail registry claims and the maintenance caption. No real runtime
  flag/kill switch is introduced or silently simulated.
- Fix pageviews/pages-per-session including click/form events.
- Real Postgres testing additionally found an unencoded `Date` interpolated into
  raw SQL in the new-visitor query. Encode ISO timestamp explicitly; regression
  covers actual query execution, pageview counts, exclusive end boundary,
  new/returning visitors and unknown one-page session duration.

## Ordered remaining work and acceptance gates

1. **Reliability and safety:** test existing org restrictions and admin actions;
   design effective global sending pause with explicit accept/reject semantics,
   durable queued work, retry behavior, audit reason and step-up authentication.
   Do not ship switches before backend enforcement and restart/resume tests.
2. **Analytics truth:** validate website ingestion through report output, then
   define activation cohorts. Exercise empty/missing data, bots/duplicates, date
   windows, comparison periods and rate denominators. No invented MRR or delivery.
3. **Customer troubleshooting:** cohesive customer/project/message drilldown,
   pagination, searchable history, safe support notes and limited redacted exports.
4. **Operations:** notification routing, alert acknowledgment, incident timeline,
   provider/worker freshness and measured latency. All unavailable dependencies
   must appear unknown/error rather than green.
5. **Full visual rollout:** command center, growth, customer lists/details,
   delivery/security/operations and communications. Each gets actual desktop/mobile
   screenshots, error/empty states, keyboard checks and useful action affordances.
6. **Hosted verification:** permission matrix with operator/customer accounts,
   provider feedback and a new automatic send without manual drain. No resending
   old queued customer mail as a test. Deployment alone does not complete this gate.

## Evidence and limitations

Local isolated PostgreSQL 17 initialized outside Git, all committed migrations
applied using `@calder/db db:migrate`. Analytics regression and existing six-case
delivery-truth suite executed against it (not skipped). No production data used.
Local fixtures cover actual shell/client navigation plus actual Metrics markup
with synthetic query results. Browser checks cover filtering/empty state,
collapse persistence, mobile disclosure and overflow, not authenticated tenant
navigation or provider configuration. No live Redis/worker, hosted send, role
mutation, billing, external notification or production rollout is certified here.

See [visual QA](visual-qa/founder-foundation-2026-10-29/README.md).

## Continued implementation — 2026-10-29

- **Atomic privileged actions:** role changes, manual entitlement grants and
  Gmail reactivation commit with their audits. Failure injection against real
  Postgres proves rollback. Role/plan request keys prevent duplicate effects;
  replaying a previously completed role grant after revocation does not restore
  access. Target-row locks serialize concurrent changes. Reasons are bounded;
  Gmail appeals reject revoked and non-Gmail transports.
- **Private incident log:** list/filter/paginate, create, attributed notes,
  investigating → identified → monitoring → resolved, and optimistic revisions.
  Resolved records are immutable. Creates/updates are audited atomically and
  idempotent. Founder/platform-admin/infrastructure may write; others with
  observability access are read-only. No public publication or automatic paging.
- **Activation:** organizations-created cohort with nested verified-owner,
  project, current ready sender (verified/connected, not archived), and live
  SES/Gmail provider-ID milestones. Excludes mock/test activation; current-state
  readiness can change, so this is not a timestamped historical conversion funnel.
- **Environment selection:** Metrics defaults to live, with test/all URL filters
  applied to email outcomes and database-derived backlog. Webhook totals remain
  explicitly all environments/all time. Other legacy reports retain their existing
  scopes pending audit; do not imply they all gained these filters.
- **Support:** deliberate, paginated read-only account lookup leading to existing
  customer/org drilldowns. No automatic disclosure of the directory on entry,
  impersonation, notes/ticket system, credit issuance or on-behalf resend.
- **Honest financials:** Command Center and Billing no longer infer MRR/ARR/ARPU
  or paying customers from manual plan records. Other list-price estimates are
  labeled catalogue values, not payments. Manual grant is not a checkout feature.
- **Additional audit repairs:** acquisition empty totals stay zero; missing
  open/click aggregates are null; unused fabricated user-send/last-seen values
  removed. Cron filters scheduled rows before limiting and shows IDs, not message
  subjects. Redis client count uses INFO clients, and missing Redis no longer
  claims a supported production fallback. API SMTP and status-publishing captions
  no longer pretend planned services are operational. Command Center no longer
  certifies all systems operational just because no current rules fired.

### Deployment and remaining gates

Apply migration `0032_special_logan` through `@calder/db db:migrate` before
rolling out incident routes. Existing migration timestamps are untouched. The
local isolated database has all 33 migrations applied and schema drift passes.
The incident system is deliberately private; no customer/public schema endpoint
was added. Audit keys are durable replay protection, not disposable diagnostics.

Still outstanding: shared global maintenance enforcement and step-up auth;
automatic alert notification routing/acknowledgment and public incident publishing;
measured worker heartbeats and historical request/queue latency; true event-order
activation attribution; detailed all-page redesign; production/hosted provider
and no-manual-drain verification. Signup remains open. Do not merge/deploy this as
proof the entire founder programme is finished.

### Final local verification of this continuation

- Dashboard: **304 Vitest tests passed, zero skipped**, with
  `RUN_INTEGRATION_TESTS=1`, an isolated PostgreSQL database and local Redis;
  **3 additional Node security-header tests passed** through the dashboard test command.
- API organization-safety integration: **2 passed** against Postgres.
- Public web/changelog: **13 passed**. Dashboard typecheck and production build passed;
  control-plane ESLint has no warnings/errors; repository formatting and diff checks pass.
  Build still reports the existing BullMQ dynamic dependency warning and two
  unrelated unused-variable warnings outside the control plane.
- Optimized Next production build: **55/55 static control routes** returned 200
  with real headings and no error-boundary view. This surfaced/fixed an additional
  raw timestamp binding error in Communications/Audiences, now covered by Postgres.
- Actual authenticated Next incident creation → identified → monitoring → resolved,
  persisted founder role change, GET environment filter, support allow/deny,
  cross-origin auth rejection and unauthenticated redirect passed. Final action
  checks await settled POST/RSC transitions; updates return to the authoritative detail view.
- **18 authenticated screenshots**, nine views at 1440/390, with no document overflow
  or browser page errors. Mobile role candidates were redesigned from a wide
  action table to stacked identity/role/action cards after reviewing the first capture.
  Supplementary earlier SSR fixtures are explicitly not action/auth proof.
- Local schema: **33/33 migrations applied**, no pending migrations, drift matches.
  No production migration/deployment occurred. Password login, hosted providers,
  hosted Redis failover, and the remaining programme gates above are not certified.

Evidence: [workflow QA](visual-qa/founder-workflows-2026-10-29/README.md),
including sanitized route results and actual screenshots. Local session cookies,
auth secrets, databases and test harness scratch files are excluded from Git.
