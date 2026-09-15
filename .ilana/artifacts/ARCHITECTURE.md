# Architecture Decisions — CR-001 Founder Control Plane Redesign

Companion to `.ilana/artifacts/SRS.md`. Cites REQ/NFR IDs. Additive-first: no send-path changes, no removed functionality (NFR-008).

## DEC-001 — Charts: adopt recharts (NFR-002 justification)

Existing `apps/dashboard/app/control/_components/charts.tsx` is server-rendered, zero-dependency SVG with no hover/tooltips/multi-series selection. Spec §§11/33 requires interactive multi-series charts with tooltips and selection state. recharts is adopted **isolated behind one client module** (`apps/dashboard/components/charts/`), dynamically imported, styled from CSS tokens. No other page regresses; server charts remain for untouched pages.

## DEC-002 — "Confirmed" semantics (spec variance, user-approved)

No double opt-in exists. Confirmed = waitlist signup whose email holds a Calder account (derived live, the existing definition). Statuses displayed are the real enum: waiting / invited / contacted / converted / removed. Delivery ≠ activation; email metrics shown separately from conversion.

## DEC-003 — Light "Paper" theme supersedes ADR-027's dark register (user-approved)

`control.css` tokens flip to Paper `#F5F4EF` / Ink `#0B0C0E` / Surface `#FFFFFF` / cobalt `#3D5AFE` as signal. Class names and page structure are preserved; only the token register changes, so all ~60 pages restyle without markup churn. ADR-028's live-evaluation design is untouched. New ADR to be recorded in `docs/DECISIONS.md` at closure.

## DEC-004 — First-party analytics event layer (REQ-080..084)

- **Table `analytics_events`** (migration `0017`): `id` text pk; `type` varchar(24) in {pageview, cta_click, form_start, form_complete}; `path` varchar(512) null; `label` varchar(100) null (CTA name); `referrer` varchar(512) null; `source` varchar(100) null; `utm` jsonb null; `sessionId` varchar(64); `visitorId` varchar(64); `device` varchar(16) null; `country` varchar(100) null; `createdAt` timestamptz. Indexes: (createdAt), (type, createdAt), (visitorId), (sessionId), (path). **No PII columns by construction** (no email/name/ip/precise geo). Retention: 13 months, documented; purge cron deferred (CR note in ledger).
- **Endpoint** `POST /v1/beacon` (`apps/api/src/routes/beacon.ts`, mounted in `app.ts`): batch ≤ 20 events, zod-validated, unknown fields stripped, `rateLimitMiddleware` public preset, 204 response. Country derived **server-side** from `x-vercel-ip-country` (+ region header); client-supplied country ignored. CORS covered by the existing origin-reflecting middleware in `app.ts`. Structured log per batch (NFR-009), no payloads logged.
- **Collector** (`apps/web`): small client module exposing `window.__calderTrack`; visitor id (localStorage, ~13mo) + session id (sessionStorage, 30-min inactivity renewal); pageviews on route change; delegated listener for `[data-cta]` clicks; `form_start`/`form_complete` emitted by the waitlist form; batching via `fetch(keepalive)` / `sendBeacon` to `NEXT_PUBLIC_API_URL/v1/beacon`. Fails silently — analytics must never break the page.
- **Dashboard aggregation** (`apps/dashboard/lib/control/analytics-queries.ts`): visitors = `count(distinct visitor_id)`, sessions = `count(distinct session_id)`, pageviews, CTA impressions via pageviews of pages containing CTA (labeled honestly), clicks by label, top pages (views + unique visitors; engagement = avg session pageview span, "—" when single-page), sources, countries, new vs returning (visitor first-seen within range), best days. Zero rows → empty states (REQ-093).

## DEC-005 — Confirmation email versions are additive (REQ-070..075)

- **New tables** (migration `0018`): `waitlist_confirmation_drafts` (single-row working copy: subject/html/text/updatedAt) and `waitlist_confirmation_versions` (immutable published snapshots: id, version int, subject/html/text, publishedAt, publishedBy). Existing `waitlist_confirmation` row remains **the materialized current version** that the API send path already reads — send path untouched (RSK-003).
- **Flow**: edit draft → preview (renders draft with sample variables) → send test → publish (insert next immutable version + upsert materialized row + clear draft) → restore (copy old version into draft). Current version = max(version).
- **Send test** (server action, founder/operator-gated + audit-logged): enqueues one internal email via `@calder/queue` under `proj_website`, subject prefixed `[TEST] `, rendered from the **draft**, with a sample recipient name. Never inserts `waitlist_signups`, never writes `analytics_events`, idempotency key per invocation, fully audited. Provider logic stays in the worker; the action only enqueues (no provider duplication).

## DEC-006 — Founder topbar via route group (REQ-005, REQ-090)

A Next.js route group `app/control/(founder)/` wraps the three redesigned pages (URLs unchanged) with a founder topbar: page title + context, Production status pill, shared `RangeMenu` (Today/Yesterday/7d/30d/90d/This month/Last month/All time/Custom, persisted in `?range=`/`?from=&to=`), Refresh (`router.refresh()`), founder avatar. Pages that don't consume `?range=` are not given the control (no fake UI). Existing pages stay under the current layout untouched.

## DEC-007 — Signup-time attribution enrichment (makes geography/source real)

The public signup route currently writes `source`/`country` as NULL. The POST `/v1/waitlist` handler is extended to: accept optional `source` (validated enum-ish string, from the form's UTM-carrying hidden field via `joinWaitlistSchema` extension) and derive `country` server-side from `x-vercel-ip-country` (trusted edge header, country-level only — no PII concern, aggregate reporting only per REQ-084). Historical NULL rows display as "direct / —" honestly.

## Component/file map

| Area | Files |
| --- | --- |
| Migrations | `packages/db/drizzle/0017_analytics_events.sql`, `0018_waitlist_confirmation_versions.sql` + snapshots via drizzle-kit |
| Schema | `packages/db/src/schema/analytics.ts`, `waitlist.ts` (add drafts/versions tables) |
| API | `apps/api/src/routes/beacon.ts` (new), `app.ts` (mount), `routes/waitlist.ts` (attribution), `@calder/validation` (join schema + beacon schema) |
| Web | `apps/web/components/analytics-collector.tsx` (client, in root layout), waitlist form start/complete hooks |
| Dashboard lib | `lib/control/range.ts` (pure + tests), `lib/control/analytics-queries.ts`, `lib/control/editor-actions.ts` (server actions), `lib/control/format.ts` (pp formatter) |
| Shell | `app/control/control.css` (token overhaul), `app/control/(founder)/layout.tsx` + topbar components, `_components/nav.tsx` (collapse + drawer + profile menu) |
| Charts | `components/charts/` (client recharts wrappers: TrendChart, Sparkline, FunnelChart, Heatmap) |
| Pages | `(founder)/page.tsx` (Command Center), `(founder)/growth/page.tsx`, `(founder)/growth/waitlist/page.tsx` (files move into group; URLs unchanged), `control/email-editor/page.tsx` + `email-editor/` client editor |
| Waitlist extras | detail drawer client component; bulk-select client; new-signup nudge (client polling `router.refresh`) |

## Security review hooks (SECURITY.md)

- Beacon: rate-limited, validated, PII-free, CORS-scoped, no secrets. Read path is founder-guarded aggregate SQL only.
- Editor actions: `requireOperator()` + audit log entries (`confirmation_email.publish`, `.restore`, `.send_test`).
- No raw provider errors in UI (REQ-061): summary + link to delivery event only.
- Waitlist PII stays server-rendered; export route unchanged (already permission-checked).

## Testing map (NFR-010, unit — vitest)

- `range.ts`: boundaries, month math, compare windows, pp deltas.
- `analytics-queries` pure helpers: bucketing (daily/weekly), new-vs-returning classification, engagement math.
- Editor actions with mocked db: publish creates immutable version + materialized copy; restore copies into draft; send-test never touches signups/analytics.
- Beacon validation schema: strips unknown, rejects oversized batches.

## Deferral register (explicit, not silent)

- Email open/click tracking: none — shown as "—" (REQ-021).
- Bounce rate: no session semantics — "—" (REQ-041).
- Analytics retention purge cron: documented, deferred (follow-up CR).
- Deeper per-country/per-page drill-down pages: out of scope this change.
