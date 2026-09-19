# CALDER FOUNDER/ADMIN CONTROL PLANE

Status: **Built and verified live** (2026-09-14). This document is the product
spec for the Control Plane and the authoritative map of what exists, what is
stubbed, and what comes next.

The Control Plane is the operational layer of Calder — the screen the founder
(and eventually the internal team) uses to run the business: answer "is the
business OK, are customers OK, is Calder healthy, is anything broken?", work
the waitlist, support customers, manage billing entitlements, watch the
infrastructure, and act with a full audit trail.

It is a separate operational layer from the customer dashboard, sharing the
same login and the same database. No data is duplicated; every panel is a live
query.

---

## 1. Principles

1. **Same identity, two worlds.** Emerald logs in once. The customer dashboard
   is the normal Calder product (orgs, projects, sending). The Control Plane is
   reached from the sidebar link "Control Plane" and renders only for people
   with a platform role. A platform operator lands directly on `/control`
   (the Command Center) after login; regular customers land on `/` — the
   target is derived server-side from the platform-role system
   (`lib/control/post-login.ts` over `resolvePlatformRole`), never from a
   client-side email comparison. Eventually the Control Plane moves to a
   separate subdomain; nothing in the code assumes same-origin.
2. **The founder is also a customer.** Emerald owns "Calder" (org `org_avenor`,
   project `proj_website`) and dogfoods the product like any user. Platform
   role never spills into tenant data.
3. **No self-promotion.** Platform roles are stored in `users.platform_role`.
   The only bootstrap is the `FOUNDER_EMAILS` environment allowlist, evaluated
   at session creation: a founder email with a lesser DB role is elevated to
   founder; a non-founder email never gains anything from the env var.
   Locked by unit tests (`resolvePlatformRole` cases in `apps/dashboard/lib/control/stats.test.ts`, redirect cases in `apps/dashboard/lib/control/post-login.test.ts`):
   - `(email, dbRole "support", self email)` → **founder** (bootstrap wins)
   - `(email, dbRole "support", other founder email)` → **support** (no leak)
   - DB `founder` role > env bootstrap for non-allowlisted emails.
4. **Every internal action is audited.** Actor, action, target, before/after,
   reason, IP, timestamp — via `recordAudit()` in
   `packages/db/src/audit.ts`. Views filter out `platform.internal.*` events
   from customer-facing audit pages.
5. **Live over stale.** Command Center metrics and alert rules are evaluated
   per request against current state — no snapshot tables to go quietly stale.
   Alert rules are evaluated per request by `evaluateAlerts()` in `lib/control/queries.ts` (no snapshot tables).

## 2. Navigation (implemented)

| Section | Pages |
| --- | --- |
| OVERVIEW | Command Center (`/control`) |
| GROWTH | Overview, Waitlist (+ person drill-down, CSV export), Acquisition, Referrals |
| CUSTOMERS | Users, Organizations (+ 360° org detail), Projects, Customer Health, Support |
| COMMUNICATIONS | Overview, Broadcasts, Campaigns, Templates, Audiences, Delivery |
| BILLING | Overview, Revenue, Subscriptions, Plans, Coupons, Credits, Invoices, Entitlements |
| PLATFORM | Email, API, Webhooks, Deliverability, Usage |
| INFRASTRUCTURE | Overview, Redis, Queues, Workers, Database, Storage, Providers, Cron, Networking |
| OBSERVABILITY | Logs, Metrics, Alerts, Incidents |
| SECURITY | Overview, Abuse, Security Events, Restrictions, Admin Access |
| OPERATIONS | Feature Flags, Maintenance, Status Page |
| ADMINISTRATION | Administrators, Roles, Audit Logs, Settings |

Access is gated per section by `requireSection()` (`lib/control/guard.ts`);
unauthenticated `/control` requests redirect to login; insufficient role
renders the "No access" page (verified with a support-role session).

## 3. What each area does today

### Command Center
Open-canvas founder cockpit on the light Paper register (ADR-031): global
system state in the header ("All systems operational" or "N issues require
attention →"), a primary metric strip (Visitors, Waitlist, Submissions,
Confirmed, Confirmation emails — every delta labeled with its comparison
basis), the Business strip (MRR, customers, orgs, users), a large
multi-series growth chart (toggle Visitors / CTA clicks / Submissions /
Confirmed with hover tooltips), the conversion funnel with per-step rates,
CTA performance, acquisition-source and country tables (event-layer traffic
plus signup-time attribution), waitlist and confirmation-email panels
(sent → delivered/failed pipeline with delivery rate), recent confirmation
activity, platform health rows, and a "Worth knowing" section of
data-derived observations only. Date range (Today → All time + custom) and
refresh live in the founder topbar. Every number is a live query; a dash
means "no data yet", never a fabricated value.

### Growth / Waitlist (the priority)
- Stat strip: total, new today, new this week (+WoW %), conversion
  (computed, never stored), referral rate, waiting count.
- Cumulative growth curve (7D|30D|90D|6M|1Y|ALL switch) + per-day signups bars.
- Acquisition sources with share bars; lifecycle funnel (waiting → invited →
  contacted → converted → removed); top referrers with referral counts.
- Table: name, email, joined, source, country, referral, status, position.
- Person drill-down: profile (position, joined, source, country, referral
  code/parent, invited/contacted/converted dates), actions (Invite, Mark
  contacted, Back to waiting, Remove), tags (add/remove), internal note
  (never shown to the person), referrals through this person.
- CSV export (`/control/growth/waitlist/export`) — 3,839 rows verified.

### Customers
- Users list (plan, orgs, emails sent); Organizations list (MRR, plan, health);
  360° org detail: plan control (apply plan founder-side, audit-logged),
  subscription history, members, projects + transports with default identity,
  metered usage periods, org-scoped audit trail.
- Customer Health: scored cohorts computed live — approaching limits, dormant
  (stopped sending), failed-delivery clusters — each row links to the org.
- Support: internal notes + recent contacts (CRM-lite).

### Communications
The **transactional vs marketing split is rendered everywhere**: overview
shows two separate pipelines (transactional: Gmail/SES/SMTP with per-provider
traffic; marketing: flagged OFF with the banner "Marketing campaigns — Not
supported with a connected Gmail account. Requires a verified sending domain
and Calder marketing infrastructure."). Broadcasts/Campaigns/Automations/
Templates/Audiences/Delivery each state their transactional/marketing class.
Founders can compose internal broadcasts to system-generated audiences
(all users, waitlist, per-plan, verified/unverified, active/inactive,
approaching limits, billing issues).

### Billing
Overview (MRR, ARPU, plan mix), Revenue (30-day bars), Subscriptions (state
funnel, past-due), **Plans** (founder-only management, prices, include
entitlements), **Coupons** (percent / fixed / free-period, redemption counts),
**Credits** (₦/$ grants with reasons and balances), **Entitlements** — base
plan + per-org overrides (+ emails, + projects, temporary promotions with
expiry) → effective entitlements table.

### Platform
Email transports (per-provider config + status), API (rates, error budget),
Webhooks (attempt/failure counts), Deliverability (auth posture: SPF/DKIM/DMARC,
reputation, per-provider engagement), Usage (metered totals by metric).

### Infrastructure
Overview (health of each subsystem), **Redis** (falls back to Postgres-state
panel with an honest "Redis unreachable — showing fallback state" when PING
fails; fully populated when Redis is up), **Queues** (waiting/processing/
retrying/failed/DLQ + oldest job age), Workers (heartbeats), Database (size,
conn counts, table sizes), Storage, Providers (status, latency, traffic share,
failover chain), Cron (job schedules), Networking.

### Observability
Logs, Metrics, **Alerts** — the rule book is rendered with thresholds and
intent (delivery rate <97%, complaints >0, bounces >3%, queue depth >5,000,
oldest queued >15 min, Redis PING, Redis memory >80%, DB connections >80%,
past-due subs >0), each evaluated live with firing/clear state and drill-down
links. Incidents (timeline, escalation path: alert → notification → incident).

### Security
Abuse (signals + actions: warn, rate-limit, require verification, pause,
suspend, restore — all audit-logged), Security Events, Restrictions
(user/org/platform levels), Admin Access (role matrix: Founder > Platform
Admin > specialized roles Support/Billing/Marketing/Infra/Security/Developer/
Analyst, multi-role assignment, read-only roles list).

### Operations
**Feature Flags** (Gmail transport ON, SMTP ON, Inbound OFF, Campaigns OFF,
Automations OFF, Advanced Analytics plan-gated Pro+, Broadcasts internal-only
— with % rollout and plan/user/org/internal targeting columns), Maintenance,
Status Page (public incident publishing path).

### Administration
Administrators (grant/revoke platform roles with reason — inline
`"use server"` actions, audit-logged), Roles (matrix + precedence docs),
Audit Logs (actor/action/target/time/metadata, filterable), Settings
(platform name, founder emails allowlist, danger zone).

## 4. Key implementation notes

- Paths: pages in `apps/dashboard/app/control/**`, shared components in
  `app/control/_components` (ui.tsx, charts.tsx, page.tsx shell), logic in
   `apps/dashboard/lib/control/**` (guard.ts, roles.ts, post-login.ts,
   queries.ts, analytics-queries.ts, range.ts, format.ts, editor-actions.ts).
   tsconfig aliases `@/control/*` and `@/*` — never import
  with relative `../../../lib/control`.
- Server actions are inline `"use server"` closures (bound functions fail
  typecheck in this Next version). Every mutation writes an audit row inside
  the same transaction where practical.
- Role precedence is locked by tests; `PlatformRole` lives in
  `packages/db/src/schema/enums.ts`.
- Charts are hand-rolled SVG (`charts.tsx`: LineChart, BarsChart, Sparkline)
  in the Calder visual language — paper-cream bars, ink lines, restraint.
  Bars return `null` on empty data rather than rendering zero-axis junk.
- Demo data: `pnpm --filter @calder/db db:seed-demo` (idempotent, SEED
  fixed so runs are reproducible). 3,840 waitlist / 153 users / 37 orgs /
  ~4,600 emails / ~20,600 events / 42 conversions; queued emails are seeded
  fresh (≤10 min old) so queue-age alerts mean something.

## 5. Verified (2026-09-14)

- `apps/dashboard` typecheck **0 errors**; vitest **23/23**; lint **0
  problems**. `packages/db` typecheck + lint clean.
- Dev-login as `emerald@calder.click` (FOUNDER_EMAILS) → every `/control`
  page renders 200 with live data; unauthenticated `/control` → 307.
- Waitlist CSV export → `text/csv`, 3,839 data rows.
- Server action end-to-end (browser click "Invite" on a waitlist person) →
  status flips to `invited` with date, audit row `waitlist.status.invited`
  with from/to metadata, page revalidates.
- Founder dual-world check: `/` renders the normal customer dashboard
  ("Good morning, Emerald", project Website) with the Control Plane link.
- Visual QA at 1440px and 390px on Command Center, Waitlist, person page,
  org detail, Alerts (see ADR-028 for the stance; screenshots retained in
  the session workspace).

## 6. Not built yet (honest list)

- Redis panels degrade gracefully but the queue is still Postgres-backed
  (BullMQ cutover is the Phase 1 roadmap item).
- Notification channels (email/Slack) for alerts, and incident
  creation/publishing are scaffolded UI, not wired.
- Marketing pipeline is intentionally OFF (ADR-002/§5c) until Calder
  marketing infrastructure exists.
- Impersonation ("View as customer") exists as UI scaffolding; the read-only
  banner + confirmation + audit flow needs its action wired before use.
- Status page is internal-first; public one-click publishing comes with the
  incidents work.
- ⌘K command search is designed, not yet implemented.
