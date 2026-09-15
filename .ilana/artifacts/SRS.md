# SRS — Calder Founder Control Plane Redesign (CR-001)

Status: Approved via intake (see `.ilana/ledger.md`). Traceability root for this change.
Rules: real data only (NFR-006); every metric labeled with its comparison basis; no fabricated states.

## A. Application shell

- REQ-001 Sidebar 240–260px expanded; Calder wordmark + "Control Plane" label; grouped nav (Overview, Growth, Customers, Communications, Billing, Platform, Infrastructure, Observability, Security, Operations, Administration) rendered from the existing role-guard source so sidebar visibility = server-side access.
- REQ-002 Active nav item: subtle background, clear text, small cobalt indicator; distinct hover state. No large solid accent blocks.
- REQ-003 Collapsed mode: icons only, page name revealed on hover; state persists.
- REQ-004 Founder profile at sidebar bottom (name + role) with menu: Account, Control Plane, Sign out.
- REQ-005 Compact content topbar: page title + secondary context on the left; environment indicator ("Production" + status dot), date-range control, refresh, avatar on the right.
- REQ-006 Mobile: sidebar becomes a drawer; topbar compacts; tables become readable rows/lists.

## B. Founder Command Center (`/control`)

- REQ-010 Page header "Command Center / Calder at a glance" + compact global system state ("All systems operational" or "N issues require attention →").
- REQ-011 Primary metric strip (premium modules, not giant cards): Visitors, Waitlist, Submissions, Confirmed (conversion), Confirmation emails — each with title, value, comparison delta labeled with its basis, context line, sparkline where data allows.
- REQ-012 Growth section: large interactive multi-series chart (Visitors / Clicks / Submissions / Confirmed toggles), hover tooltip, comparison overlay, daily/weekly granularity by range.
- REQ-013 Growth rate summary adjacent to chart: overall + per-metric deltas vs previous period.
- REQ-014 Conversion funnel: Visitors → CTA clicks → Submissions → Confirmed with per-transition percentages and overall visitor→confirmed rate; when the event layer has no data for a stage, show the funnel with honest zero/empty states, never invented numbers.
- REQ-015 CTA performance section: per-CTA clicks, % change, conversion where applicable (data from event layer only).
- REQ-016 Geography: country ranking (visitors/submissions/conversion) with metric toggle; expandable country detail (aggregate only, no individual precision). Signup-time country is real today (waitlist_signups.country); traffic geography accrues via REQ-050.
- REQ-017 Acquisition sources table (visitors/clicks/submissions/conversion) from the event layer; signup source (real today) shown alongside, clearly labeled.
- REQ-018 Top pages table from event layer (views/unique visitors/engagement).
- REQ-019 Waitlist section: total, today, this week, avg/day, confirmation→conversion rate, growth chart, "View waitlist →".
- REQ-020 Recent waitlist activity feed with real statuses (waiting/invited/contacted/converted/removed per DEC-002).
- REQ-021 Confirmation email section: sent/delivered/failed/delivery-rate for the waitlist confirmation stream; opened/clicked shown as "—" (no tracking exists).
- REQ-022 Delivery pipeline visualization: created → queued → sent → accepted → delivered with per-stage counts from emails/email_events; failures identifiable.
- REQ-023 "Edit confirmation email →" prominent action linking to REQ-040 editor.
- REQ-024 Recent live activity feed (deliveries, submissions, CTA clicks, failures) with relative timestamps that age (REQ-070 liveness).
- REQ-025 Platform health: API/Email/Webhooks/Queue/Database/Redis rows + API latency, error rate, queue depth, delivery success — all from existing health queries.
- REQ-026 Alerts: only genuine conditions from the existing alert engine; each with an action link. No fake alerts.
- REQ-027 Founder insights ("Worth knowing"): only computed observations from real data (e.g., source conversion ratios, geography share, delivery stability). No motivational copy, no "AI insights" label.

## C. Growth Overview (`/control/growth`)

- REQ-030 Header: GROWTH eyebrow, "How Calder is growing", date range + compare + export.
- REQ-031 Core metrics: Visitors, Sessions, Waitlist submissions, Confirmed (converted), Visitor→Confirmed conversion (percentage-point change, not relative %).
- REQ-032 Micro-trend sparklines on each core metric with hover values.
- REQ-033 Main growth chart: multi-select series (Visitors/Sessions/Clicks/Submissions/Confirmed), comparison overlay, tooltip with per-series values + conversion context.
- REQ-034 Granularity: daily for 7/30d; daily-or-weekly for 90d; weekly/monthly for 6m/1y; appropriate for all-time.
- REQ-035 Growth velocity: WoW, MoM, avg daily submissions, best day, lowest day.
- REQ-036 Conversion journey + drop-off: explicit "lost between stages" counts; frames biggest opportunity.
- REQ-037 Acquisition overview with source quality (traffic AND conversion per source).
- REQ-038 Geography with growth per country (+% vs previous period), metric toggle.
- REQ-039 Top pages table (visitors, views, CTA rate, signup rate) from event layer.
- REQ-040 CTA analytics: impressions, clicks, CTR, resulting conversions per CTA.
- REQ-041 Engagement: avg session duration, pages/session, returning-visitor share; bounce shown only if session semantics exist (else "—").
- REQ-042 New vs returning split + trend.
- REQ-043 Daily activity heatmap (restrained, hover detail).
- REQ-044 Best performing periods: highest traffic day, highest signup day, highest conversion day.
- REQ-045 Growth breakdown table: current vs previous period deltas across metrics.
- REQ-046 Notable changes: data-driven observations only (renamed from "AI Insights" per spec §24).
- REQ-047 Export CSV/JSON respecting current range + filters (functional, not decorative).

## D. Waitlist (`/control/growth/waitlist`)

- REQ-050 Header with Export + Refresh; "Add manually" only if backend supports it (it does not → omit).
- REQ-051 Top summary: total, +delta vs previous period, new today, new this week, converted count, conversion rate — compact modules.
- REQ-052 Cumulative growth chart with 7D/30D/90D/All-time toggle and tooltip (new signups, total, converted per day).
- REQ-053 Signups vs confirmations(conversions) visualization toggle.
- REQ-054 Search by name/email/code — server-side, fast; ⌘K/`/` focus shortcut consistent with app conventions.
- REQ-055 Filter bar: status (real statuses), source, referral, date, sort — compact.
- REQ-056 Main table: person (initials avatar + name), email, joined (relative + exact on hover), source, country, referral, real status, tags; row hover; arrow to detail.
- REQ-057 Server-side pagination (25/50/100 per page) with "Showing X–Y of Z".
- REQ-058 Bulk selection with count bar; safe bulk action = Export only (no invented bulk emails).
- REQ-059 Export CSV of current results or entire waitlist, permission-checked (route exists; keep).
- REQ-060 Row detail drawer: identity, joined timestamp, real status, email lifecycle (from emails/email_events where the confirmation email exists), activity events — only events that actually exist.
- REQ-061 Confirmation failure detail: show provider reason summary + "View delivery event →"; never raw stack traces.
- REQ-062 Recent activity panel for waitlist events.
- REQ-063 Waitlist health panel: conversion rate, pending/waiting counts, failure counts (real semantics only; avg confirmation time omitted — not measured).
- REQ-064 Confirmation-email shortcut panel (current version, subject) → editor.
- REQ-065 New-signup gentle notification ("1 new signup · View") instead of silent table reorder.
- REQ-066 Empty/search-empty/filter-empty/error states per spec §22–26.
- REQ-067 Performance posture: server-side pagination/search/filter, indexed lookups; never download the whole table.
- REQ-068 Security: server-side authorization on every waitlist endpoint (founder/admin only), export permission-checked, no PII in analytics events, sensitive actions audited (existing audit-log integration kept).

## E. Confirmation email editor

- REQ-070 Dedicated page from Command Center + Waitlist shortcuts. Three-column desktop layout: settings (subject, preview text, from, reply-to) / content editor / live preview with desktop+mobile toggle.
- REQ-071 Content editor: structured blocks (logo, greeting, heading, body, CTA, footer) not a raw textarea; `{{first_name}}` variable inserted via obvious variable selector; body HTML editing allowed for power users.
- REQ-072 Version history: every publish creates an immutable version row (new table, migration); list with dates; view + restore any version; current version clearly marked.
- REQ-073 Draft → publish flow: save draft, preview, send test, publish; never overwrite history (supersedes current single-row overwrite behavior, which becomes "latest published version").
- REQ-074 Send test: to founder address(es); marked as test; MUST NOT create waitlist signups, analytics events, or consume real-user metrics.
- REQ-075 Live preview renders actual template HTML with sample variable values; updates immediately on edits.

## F. Analytics event layer (new, first-party)

- REQ-080 `analytics_events` table (migration) storing: id, project/context marker, type (pageview, cta_click, session boundaries via fields), path, referrer, source/utm (where provided), country (from existing geo capture), device class, session id (cookie-based), visitor id (cookie-based), ts. No PII: no emails, no names, no precise location, no free-text.
- REQ-081 Public beacon endpoint (POST) accepting batched events; rate-limited; schema-validated; no cookies required beyond anonymous ids; CORS scoped to Calder web origins.
- REQ-082 Collector snippet on apps/web: pageviews (path, referrer), CTA clicks (name per spec §14 list), waitlist form start/complete, session/visitor anonymous ids, sendBeacon batching.
- REQ-083 Dashboard queries aggregate event layer for: visitors (unique visitor ids), sessions, pageviews, CTA impressions/clicks, top pages, sources, geography, new vs returning, engagement duration, best days. All derived from real events; zero-data windows render empty states.
- REQ-084 Data hygiene: aggregate-only reads from the dashboard; no per-individual drill-down beyond what spec §16 permits (aggregate region/city where present); retention policy documented.

## G. Cross-cutting

- REQ-090 Date range control (shared component): Today/Yesterday/7d/30d/90d/This month/Last month/All time/Custom; persisted per page via URL params; updates all analytics on the page.
- REQ-091 Compare mode: previous period (and previous year where data allows); every % labeled with its comparison basis ("vs previous 30 days"); percentage-point notation for rate changes.
- REQ-092 Loading: skeletons matching final layout (no giant centered spinners, no layout jump).
- REQ-093 Empty: calm explanatory copy ("Your growth data will appear here…"); zero-data ≠ unavailable distinction.
- REQ-094 Error: per-section failure with retry; one failing dataset must not destroy the page.
- REQ-095 Liveness: relative timestamps update without full reload; new feed items enter subtly; respects NFR-003 restraint.

## Non-functional requirements

- NFR-001 Design system: "Editorial Infrastructure" per docs/DESIGN.md — restraint, two type families max, mono for technical metadata, Paper/Ink/Surface palette, cobalt as signal only.
- NFR-002 No new dependency without justification (recharts justified: interactive multi-series + tooltips + a11y outgrows hand-rolled SVG; isolated behind one chart module; dynamic-imported to limit hydration cost).
- NFR-003 Motion communicates state only; prefers-reduced-motion respected; no decorative animation.
- NFR-004 Real data only (spec §39): any unavailable metric shows an explicit empty/dash state with a reason where useful. Hardcoding display numbers in production code is forbidden.
- NFR-005 Performance: server components by default; client islands only where interaction demands (charts, drawer, editor); dense pages must not regress LCP materially.
- NFR-006 Security/privacy per SECURITY.md: founder/admin guards on all control routes; beacon rate-limited and PII-free; no secrets client-side; audit sensitive actions.
- NFR-007 Responsiveness: desktop-first (1440px reference), tablet reflow, mobile (390px) stacks metrics, charts remain usable, tables become lists.
- NFR-008 Existing functionality preserved: waitlist detail page, export route, waitlist actions, role guards, audit logging keep working.
- NFR-009 Observability: beacon + send-test paths log structured events; failures diagnosable not silent.
- NFR-010 Tests for meaningful logic: range/compare math, aggregation queries, funnel/velocity computation, version publish/restore, beacon validation.

## Traceability note

Every construction step in this change must cite REQ-IDs above. Anything built without a REQ ID is scope creep and requires a CR. Anything in this SRS without a construction step at closure is either done-with-evidence or explicitly deferred with a note in the ledger.
