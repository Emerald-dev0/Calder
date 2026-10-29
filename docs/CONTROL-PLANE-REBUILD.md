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

### Reporting scope follow-up

The reused operational aggregates currently include both live and test rows.
The new Metrics view labels this explicitly and reports current statuses rather
than cumulative provider acceptance. Add tested live/test environment filters
before using these totals as a production deliverability/reputation report.
Webhook totals are all-time states, not scoped to the email 30-day cohort.
