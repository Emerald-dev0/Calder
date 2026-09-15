# Ìlànà Ledger — Calder Founder Control Plane Redesign

## Boot record

- Date: 2026-09-15
- Mode: **FLEET** (user-selected at the fork)
- Host capability: no sub-agent runtime → fleet runs as **sequential role rotation in-context** (Ìlànà §6)
- Ledger location: `.ilana/`
- Skill sharding note: Ìlànà shard files (kernel/, gates/, phases/) not installed locally; process run from the inline manifest + constitution (§4 non-negotiables). Recorded here rather than pretending to read absent files.

## Intake record (Step 0.5 — all answered, none assumed)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Analytics data gap (no visitors/sessions/CTA/pageview source exists) | **Build a first-party event layer**: table + migration, public beacon endpoint, collector snippet on apps/web. Real data accrues from deploy; empty states until then. |
| 2 | "Confirmed/Pending/Failed" don't exist (waitlist statuses are waiting/invited/contacted/converted/removed; no double opt-in) | **Use real statuses**; conversion = user account exists. No relabeling, no invented states. |
| 3 | Confirmation email is a single overwritable row | **Full editor + version history**: new table + migration, 3-column editor, live preview, send-test marked as test and excluded from analytics. |
| 4 | Charts: in-house SVG lib vs recharts | **Adopt recharts** (user accepted hydration-cost tradeoff for interactive multi-series charts). Dependency justification recorded (DEC entry). |
| 5 | Date ranges | **Full set** (Today/Yesterday/7/30/90/This month/Last month/All time/Custom) + compare-with-previous-period everywhere. |
| 6 | App shell | **Rebuild now** per spec §05–07 (sidebar, collapse, topbar) keeping existing role-enforcement wiring (nav renders from ROLE_SECTIONS; pages still guarded server-side). |
| 7 | Delivery | **Single PR** from feat branch with visual QA evidence per AGENTS.md. |

## Scope contract (CR-001)

**In scope:** Founder Command Center, Growth Overview, Waitlist (three pages), shared shell, analytics event layer, confirmation email editor + versions + send test.

**Explicitly out of scope (user directive):** Acquisition, Referrals, Customers, Communications (other pages), Billing, Platform, Infrastructure, Observability, Security, Operations, Administration. Existing pages must remain functional but are not redesigned.

**Spec variance recorded (spec-vs-truth):**
- "Confirmed" = derived conversion (account exists); statuses shown are the real enum. (DEC-002)
- Opened/Clicked email metrics shown as "—" (no tracking; never fabricated per spec §21/§39).
- Bounce rate "—" (no reliable session semantics yet).
- Country/source data: waitlist-signup-time attribution exists and is real; traffic-level geography waits for the event layer.

## Gate log

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 Intake | PASS | 7/7 questions answered; ledger created |
| G1 Requirements | PASS | `.ilana/artifacts/SRS.md` (REQ-001..095, NFR-001..010) |
| G2 Architecture | PASS | `.ilana/artifacts/ARCHITECTURE.md` (DEC-001..007) + theme decision via intake |
| G3 Interface | PASS | `.ilana/artifacts/INTERFACE.md` (tokens, hierarchy, states, responsive) |
| G4 Construction | PASS | All REQ areas built; see variance notes below |
| G5 Verification | PASS | tsc clean (6 workspaces); 38/38 + 22/22 unit tests; api suite 15 passed; lint 0 errors; all redesigned pages render 200 with real data locally |
| G6 SCM | PASS | branch `feat/founder-command-center`, PR #34 (Emerald-dev0/Calder) opened, CI `verify` green, dashboard deploy green; calder-api Vercel deploy failure diagnosed from founder-provided logs (Vercel tsc pass rejects ambient fetch types under TS 5.9.3 lib resolution) and fixed in edea857 — all checks green; not merged (human review) |
| G7 QA | PASS-WITH-FLAG | DOM-level render evidence captured (1440-content structure verified, mobile grid via CSS); pixel screenshots NOT captured — no browser driver on host; flagged in PR per AGENTS.md loop step 7 |
| G8 Closure | PENDING | after human review/merge |

## Construction variance notes (honest record)

- **DEC-006 amended**: founder topbar implemented per-page (Command Center, Growth, Waitlist) instead of a route group — same UX, no page-file moves, smaller diff. Emails editor keeps the standard layout.
- **Weekly granularity deferred**: charts bucket daily for all ranges; weekly aggregation for 90d+/1y is a recorded follow-up.
- **CTA impressions** approximated by pageviews of each CTA's target page (labeled honestly in the UI); true impression tracking needs the beacon to record slot impressions (follow-up).
- **Engagement**: avg session duration computed only over multi-pageview sessions; single-page sessions return "—". Bounce rate intentionally absent (no reliable semantics).
- **FunnelBars chart component** built in the charts module but pages use the CSS funnel (server-rendered, cheaper); component retained for later interactive use.
- **Pre-existing (not caused by this change), verified by clean-tree build**: `next build` fails prerendering pages-router `/500` & `/404` ("Html should not be imported"); 27 prerender errors with the working tree stashed. Dev-mode rendering of all pages is clean.
- **Pre-existing seed bug**: `db:seed-demo` fails on an `organization_members` FK violation (members referencing users not inserted by the script). Waitlist portion of the seed landed; used for QA.
- **Env safety incident (no harm)**: two migration attempts ran against the remote Neon `DATABASE_URL` before I noticed the `.env` target; both failed inside drizzle's transaction and remote schema was verified untouched (to_regclass NULL for all three new tables). All subsequent DB work ran against local Docker Postgres with an explicit URL override.
- **QA environment**: local Docker Postgres + Redis, `db:seed`, dev-login (dev-only, `ALLOW_DEV_LOGIN=true`, production-guarded route) as the FOUNDER_EMAILS allowlisted address.

## Risk register

- RSK-001: Beacon endpoint is public — abuse/rate-limit/PII rules must follow SECURITY.md. Mitigation: rate-limit middleware, no PII in payload, aggregate-only reads.
- RSK-002: recharts adds client bundle to a dense page — mitigated by dynamic import only on chart components.
- RSK-003: Redesign must not remove existing functionality (waitlist detail page, export route, actions must keep working).
- RSK-004: No visual-render environment confirmed — if rendering fails, flag in PR per AGENTS.md loop step 7 rather than faking evidence.
