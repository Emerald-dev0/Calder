# Calder Dashboard Redesign — Study, Audit & Architecture (`docs/REDESIGN_NOTES.md`)

## 1. Stack & Codebase Detection (Step 0)

- **Framework**: Next.js `14.2.35` (App Router, Server Components + Server Actions) with React `18.3.1` and TypeScript `5.6`.
- **Database & Auth**: `@calder/db` (Drizzle ORM + PostgreSQL) and `@calder/auth` (cookie-backed sessions resolved via `getTenantContext()`).
- **Styling & Token System**:
  - Design tokens live in `packages/ui/src/tokens.ts` and `packages/ui/src/styles.css`, mirrored into `apps/dashboard/app/globals.css`.
  - **Token Ratchet Constraint**: `packages/ui/src/tokens.test.ts` enforces CSS custom property parity and a strict raw-hex ratchet (`HEX_BUDGET["apps/dashboard"] = 678`). All new styling in `apps/dashboard` must use CSS custom properties (`var(--color-*)`) rather than inline hex literals.
- **Component & Visualization Libraries**:
  - `@calder/ui` (`packages/ui`): Shared primitives (`Button`, `Input`, `Card`, `Badge`, `CalderMark`, `CalderLockup`, illustrations, tokens).
  - `framer-motion` (`^11.11.17`): Already installed in `apps/dashboard` for subtle, purposeful transitions (`150–250ms` ease-out) with `prefers-reduced-motion` support.
  - `recharts` (`^3.10.1`): Installed in `apps/dashboard` for time-series and delivery charts.
  - **Icons**: No icon package was previously installed in `apps/dashboard` or `packages/ui`. We adopt **`lucide-react`** as the single, unified icon library across `@calder/ui` and `@calder/dashboard` (`16px` compact / `18px` nav & controls / `20px` page headers, `1.75` stroke width).

---

## 2. Complete Page & Navigation Inventory (Before Redesign)

All "Before" screenshots at `1440×900` and `390×844` are saved in `docs/redesign/before/`.

### 2.1 Sidebar Navigation Inventory (8 headings, 17 links — several cut off below the 900px fold)

| Group Heading | Nav Item | Route | Gating / Visibility | Visible at `1440×900`? |
| --- | --- | --- | --- | --- |
| `Workspace` | Overview | `/` | All users | Yes |
| `SEND` | Email | `/emails` | All users | Yes |
| `SEND` | Templates | `/templates` | All users | Yes |
| `SEND` | Senders | `/senders` | All users | Yes |
| `RECEIVE` | Inbox | `/inbox` | `PRO` badge | Yes |
| `RECEIVE` | Webhooks | `/webhooks` | All users | Yes |
| `DEVELOP` | API Keys | `/keys` | All users | Yes |
| `DEVELOP` | SDKs | `/sdks` | All users | Yes |
| `DEVELOP` | SMTP | `/smtp` | All users | Yes |
| `DEVELOP` | Logs | `/logs` | All users | Yes |
| `CONFIGURE` | Domains | `/domains` | All users | Yes |
| `CONFIGURE` | Integrations | `/integrations` | All users | Yes |
| `OBSERVE` | Deliveries | `/deliveries` | All users | Barely (bottom edge) |
| `OBSERVE` | Analytics | `/analytics` | `PRO` badge | **No — below the fold** |
| `OBSERVE` | Suppressions | `/suppressions` | All users | **No — below the fold** |
| `OBSERVE` | Usage | `/usage` | All users | **No — below the fold** |
| `ORGANIZATION` | Audit Logs | `/audit-logs` | All users | **No — below the fold** |
| *(no heading)* | Settings | `/settings` | All users | **No — below the fold** |
| *(no heading)* | Control Plane | `/control` | Founder only | **No — below the fold** |
| *(footer form)* | Sign out | `POST /api/auth/logout` | All users | **No — below the fold** |

### 2.2 Complete Route Inventory & Before Screenshots

| # | Route | Purpose | Before Screenshots (`1440` & `390`) |
| --- | --- | --- | --- |
| 01 | `/` | Overview / workspace summary | `docs/redesign/before/01-overview-{1440,390}.png` |
| 02 | `/emails` | Project email list & sender filter | `docs/redesign/before/02-emails-{1440,390}.png` |
| 03 | `/emails/new` | Compose & send test/transactional email | `docs/redesign/before/03-emails-new-{1440,390}.png` |
| 04 | `/templates` | Reusable templates list | `docs/redesign/before/04-templates-{1440,390}.png` |
| 05 | `/templates/new` & `/templates/[id]` | Template editor, variable injector & preview | `docs/redesign/before/05-templates-new-{1440,390}.png` |
| 06 | `/senders` & `/senders/[senderId]` | Sender identities, Gmail graduation & sender detail | `docs/redesign/before/06-senders-{1440,390}.png` |
| 07 | `/inbox` | Inbound email (Pro plan gate / preview) | `docs/redesign/before/07-inbox-{1440,390}.png` |
| 08 | `/webhooks` | Webhook endpoints, secret rotation & delivery replay | `docs/redesign/before/08-webhooks-{1440,390}.png` |
| 09 | `/keys` | API key creation (test/live) & revocation | `docs/redesign/before/09-keys-{1440,390}.png` |
| 10 | `/sdks` | Multi-language quickstart snippets & test key minting | `docs/redesign/before/10-sdks-{1440,390}.png` |
| 11 | `/smtp` | SMTP relay configuration & status | `docs/redesign/before/11-smtp-{1440,390}.png` |
| 12 | `/logs` | Event log stream (`email_events`) | `docs/redesign/before/12-logs-{1440,390}.png` |
| 13 | `/domains` | Custom domain verification (ownership TXT + SES DKIM/SPF) | `docs/redesign/before/13-domains-{1440,390}.png` |
| 14 | `/integrations` | Connected transports & third-party integrations | `docs/redesign/before/14-integrations-{1440,390}.png` |
| 15 | `/deliveries` | Delivery status breakdown & message table | `docs/redesign/before/15-deliveries-{1440,390}.png` |
| 16 | `/analytics` | Delivery analytics & breakdowns (Pro plan gate / preview) | `docs/redesign/before/16-analytics-{1440,390}.png` |
| 17 | `/suppressions` | Bounce/complaint/manual suppression list manager | `docs/redesign/before/17-suppressions-{1440,390}.png` |
| 18 | `/usage` | Plan quota meter, billing tiers & historical usage | `docs/redesign/before/18-usage-{1440,390}.png` |
| 19 | `/audit-logs` | Tenant security & configuration audit trail | `docs/redesign/before/19-audit-logs-{1440,390}.png` |
| 20 | `/settings` | Sessions, team members, invites, org/project creation | `docs/redesign/before/20-settings-{1440,390}.png` |
| 21 | `/not-found` (`*`) & `/control/no-access` | 404 & permission-denied surfaces | `docs/redesign/before/21-not-found-{1440,390}.png` |

---

## 3. Harsh Critique of the Current UI (Everything Wrong Today)

### 3.1 App Shell & Navigation Failures
1. **Zero Icons in Sidebar**: All 17 sidebar links are plain text (`13.5px`). Scanning the sidebar requires reading every word; there are no visual anchors.
2. **No Active Route Highlighting**: `AppLayout` (`apps/dashboard/app/(app)/layout.tsx`) is a Server Component that renders `<Link className="dash-link">` without ever checking `usePathname()`. None of the sidebar links ever receive `.active`, so the user has no idea which section they are in from the navigation.
3. **Critical Pages Buried Below the Fold**: At `1440×900`, the sidebar cuts off right after `Deliveries`. `Analytics`, `Suppressions`, `Usage`, `Audit Logs`, `Settings`, and `Sign out` are hidden off-screen below a tall ungrouped stack.
4. **No Desktop Top Bar**: On desktop (`>900px`), `.dash-topbar` is `display: none`. Consequently, there are **no breadcrumbs**, **no global search / `⌘K` command palette**, **no environment indicator (`Test` vs `Live`)**, **no system status indicator**, **no notifications**, and **no quick link to Docs/Help**.
5. **Truncated Email & Dead "No organization yet." Text**: The user's email sits directly under the logo in tiny `11px` muted text without an avatar or user menu. When a user has no organization, the sidebar shows a dead line of muted text (`"No organization yet."`) and a plain text link instead of a structured onboarding CTA.
6. **Amateur Mobile Navigation**: Below `900px`, the sidebar disappears and is replaced by a horizontal scrolling ribbon of 17 text pills (`.dash-tabs`) plus a cramped context bar. There is no mobile drawer, no user menu, and no hierarchy.
7. **PRO Badges Look Disabled**: `PlanBadge` renders as a washed-out `10px` grey box (`color: var(--color-muted)`) that makes `Inbox` and `Analytics` look broken or deprecated rather than aspirational Pro features.

### 3.2 Layout, Typography & Hierarchy Failures
8. **Inconsistent Page Headers & Stranded Content**: Half the pages use `h1 { fontSize: 28 }`, while the other half use `h1 { fontSize: 20, fontWeight: 700 }` via inline `style={{ ... }}` objects. Content is top-left anchored with arbitrary max-widths (`520px` on some cards, `760px` on templates, uncapped on overview), leaving vast dead zones on 1440px screens.
9. **Inline Style Sprawl & Hardcoded Light-Mode Hexes**: Almost every page hardcodes `background: "#fff"`, `border: "1px solid #E5E5E5"`, and `color: "#737373"` in inline JSX `style` props. This breaks dark mode completely and bypasses design tokens.
10. **No Real Dark Mode**: While `tokens.ts` defines a `dark` object, `apps/dashboard` has no theme provider, no `[data-theme="dark"]` CSS variables on dashboard elements, no system-preference detection, and no theme toggle.

### 3.3 Data Tables, Feedback & Component Failures
11. **Fake "Tables" Built from Unstyled `<div>` Rows**: `/emails`, `/logs`, `/deliveries`, `/domains`, `/keys`, `/suppressions`, and `/audit-logs` render flat `<div>` stacks with no column sorting, no sticky headers, no density toggle, no row selection, no copy-on-click for IDs, and no detail drawer.
12. **Triplicated Message Views (`/emails`, `/deliveries`, `/logs`)**:
    - `/emails` shows a list of emails with a project pill bar and sender dropdown, but no search or status filter.
    - `/deliveries` shows the *exact same* `emails` table with a search box and status dropdown, but ignores the selected project and has no link to `/emails/new`.
    - `/logs` shows `email_events` rows as flat one-line strings (`"Delivered · ada@acme.dev — Subject"`) with no way to inspect the full message timeline, headers, payload, or provider response.
13. **Missing Copy Controls on Technical Values**: DNS records on `/domains` (`RecordCard`) render as a single concatenated string (`TXT _calder.acme.com → calder-verification=...`) with **no copy buttons** for host or value! API key prefixes on `/keys`, message IDs on `/emails`, and newly minted secrets lack structured `CopyField` components.
14. **Crude `window.confirm()` Dialogs & Missing Toasts**: Revoking an API key (`/keys`), deleting a template (`/templates/[id]`), or signing out other sessions (`/settings`) uses browser-native `window.confirm()` instead of an accessible confirmation dialog, and actions provide no toast notifications.
15. **Overview Page Is a Toy**:
    - Opens with a hardcoded `"Good morning, ..."` greeting even at 11 PM.
    - Shows 4 big zero boxes (`Emails sent`, `Delivered`, `In queue`, `Failed`) with no time-series chart (7d/30d), no bounce/complaint rate metrics, no setup checklist for new workspaces, and a fake hardcoded `Project health` card where `Sending`, `Webhooks`, and `API` are always `✓ Healthy`.
16. **Settings Is a Single Jumbled Dump**: `/settings` dumps Active Sessions at the very top, followed by org slug pills, Team invites, and raw inline forms for "New organization" and "New project", with no sub-navigation, no Billing/Plans tab, no Profile/Security separation, and no danger zone.

---

## 4. Proposed Information Architecture & Navigation Structure

We reorganize the sidebar into **7 clear, task-oriented groups** with Lucide icons on every item, active-route indicators, collapsible icon-rail mode, and a sticky header (Organization & Project Switcher) and sticky footer (Usage Meter + User Menu with Theme Toggle).

### 4.1 New Sidebar Structure

| Group | Nav Item | Primary Route | Consolidated / Linked Surfaces & Justification |
| --- | --- | --- | --- |
| **Overview** | **Overview** (`LayoutDashboard`) | `/` | Command center: 4 core KPIs (Send volume, Delivery rate, Bounce rate, Complaint rate), 7d/30d delivery volume chart, pinned Setup Checklist (until first email is delivered), Domain & Transport Health, Plan Usage meter, Recent Messages, and Quick Actions. |
| **Send** | **Compose & Test** (`Send`) | `/emails/new` | Promoted to a first-class nav item so developers and operators can compose, preview (HTML/Text/Template), and dispatch test messages in one click. |
| **Send** | **Templates** (`FileCode2`) | `/templates` | Grid/list view with search, variable pills, version badge, and split-pane live preview editor (`/templates/new`, `/templates/[id]`). |
| **Send** | **Senders** (`UserCheck`) | `/senders` | Verified/unverified sender identities, default sender badge, Gmail cap graduation callout, and sender detail (`/senders/[senderId]`). |
| **Messages** | **Messages & Logs** (`Activity`) | `/emails` | **Unified Message Explorer** combining `/emails`, `/deliveries`, and `/logs` via view tabs (**Messages**, **Event Stream**, **Inbound Inbox PRO**) + rich filter bar (search, status, sender, project) + slide-over **Message Inspector Drawer** showing the full lifecycle timeline (`created → queued → sent → delivered`), envelope headers, payload, and provider telemetry. Old URLs (`/deliveries`, `/logs`, `/inbox`) remain 100% functional and deep-link into the corresponding view/tab or dedicated surface. |
| **Messages** | **Inbound Inbox** (`Inbox`, `PRO`) | `/inbox` | Tasteful Pro architecture preview & interactive demo/upgrade modal showing inbound routing rules, parsed threads, and webhook forwarding. |
| **Developers** | **API Keys** (`KeyRound`) | `/keys` | Scoped key creation dialog, one-time `CopyField` secret reveal with warning banner, masked prefix table, environment pills (`test`/`live`), and confirmation dialog for revocation. |
| **Developers** | **Webhooks** (`Webhook`) | `/webhooks` | Endpoint health table, event type selector, secret rotation with `CopyField`, delivery attempt inspector, and 1-click replay. |
| **Developers** | **SDKs & Quickstart** (`Code2`) | `/sdks` | Language tabs (`Node SDK`, `Python SDK`, `Node fetch`, `Python`, `Go`, `Ruby`, `PHP`, `cURL`) with live test-key injection and copyable `CodeBlock`. |
| **Developers** | **SMTP Relay** (`Server`) | `/smtp` | Honest architectural status + connection blueprint and REST-to-SMTP migration snippet. |
| **Configure** | **Domains** (`Globe`) | `/domains` | Step-by-step verification progress, structured DNS records table (`Type`, `Host`, `Value`, `Status`) with per-field `CopyField` buttons, live verification diagnostics, and DNS provider guides (Cloudflare, Route 53, Namecheap, Vercel). |
| **Configure** | **Suppressions** (`ShieldBan`) | `/suppressions` | Moved from `OBSERVE` to `CONFIGURE` because suppressions actively block outbound mail and are managed alongside domains/senders. Includes search, reason badges (`bounce`, `complaint`, `manual`), add/unblock confirmation, and CSV export/import. |
| **Configure** | **Integrations** (`Blocks`) | `/integrations` | Transport & provider cards (Gmail OAuth, Amazon SES, GitHub, Vercel) with connection status and clear auth-vs-sending scope explanation. |
| **Insights** | **Analytics** (`BarChart3`, `PRO`) | `/analytics` | Delivery volume, bounce/complaint breakdown, domain & sender comparison, and designed Pro upgrade preview. |
| **Insights** | **Usage & Billing** (`Gauge`) | `/usage` | Live metered vs accepted quota bar, daily send chart, plan comparison table (NGN/USD), and overage guidance. |
| **Settings** | **Workspace Settings** (`Settings`) | `/settings` | Unified settings hub with left sub-navigation: **General & Workspace**, **Team & Invites**, **Security & Sessions**, **Audit Logs** (linked to `/audit-logs`), and **Billing & Plans** (linked to `/usage`). |

### 4.2 URL Compatibility & Redirects
- Every existing route (`/`, `/emails`, `/emails/new`, `/templates`, `/templates/new`, `/templates/[id]`, `/senders`, `/senders/[senderId]`, `/inbox`, `/webhooks`, `/keys`, `/sdks`, `/smtp`, `/logs`, `/domains`, `/integrations`, `/deliveries`, `/analytics`, `/suppressions`, `/usage`, `/audit-logs`, `/settings`, `/admin`, `/control`) remains live and passes `apps/dashboard/lib/truth-gate.test.ts`.
- `/deliveries` and `/logs` keep their own dedicated server-rendered data queries and share the new `MessageExplorer` & `EventStreamExplorer` design system components with cross-navigation tabs between **Messages (`/emails`)**, **Deliveries (`/deliveries`)**, and **Event Logs (`/logs`)** so existing bookmarks, tests, and links never break.
- Added `/dev/design-system` as a living style guide showcasing every token and component in both Light and Dark mode.

---

## 5. Found While Redesigning (Backend & Logic Issues — Resolved)

The following 5 backend/logic issues were identified during the Step 0 code audit and subsequently resolved in follow-up commit per user approval:

1. **Hardcoded 5,000 Quota & Static Health on `OverviewPage` (`apps/dashboard/app/(app)/page.tsx`)**:
   - Line 36 hardcodes `const quota = 5000;` instead of calling `orgUsageSnapshot(db, orgId)` and `planEmailsLimit(snap.tier)` (which `/usage` uses). Pro workspaces (`50,000` limit) therefore see an incorrect `5,000` quota denominator on Overview.
   - Lines 42–46 hardcode `{ label: "Sending", ok: true }, { label: "Webhooks", ok: true }, { label: "API", ok: true }` without checking whether the project actually has a verified sender, an active webhook, or an active API key.
   - Line 40 hardcodes `"Good morning, ..."` regardless of the user's local time or server UTC hour.
2. **Inconsistent Project Scoping Across `/emails`, `/deliveries`, and `/logs`**:
   - `/emails` uses `resolveProject(ctx, searchParams.project)` to scope queries to a single active project.
   - `/deliveries` (`apps/dashboard/app/(app)/deliveries/page.tsx`) and `/logs` (`apps/dashboard/app/(app)/logs/page.tsx`) accept `project?: string` in `searchParams` TypeScript types, but ignore `searchParams.project` at runtime and instead query `inArray(..., projectIds)` across all projects in all organizations the user belongs to.
3. **Unscoped Template Creation (`apps/dashboard/app/(app)/templates/new/page.tsx`)**:
   - `NewTemplatePage` selects `const firstProject = ctx.memberships.flatMap((m) => m.projects)[0]` instead of calling `resolveProject(ctx, searchParams.project)`. Users with multiple projects cannot create a template in their second project from `/templates/new?project=...`.
4. **Null IP & User-Agent on Dev-Login Sessions (`apps/dashboard/app/api/auth/dev-login/route.ts` & `settings/sessions.tsx`)**:
   - `dev-login` creates a session without passing `ip` or `userAgent` headers from the request, causing `/settings` (`SessionsCard`) to render `"Unknown device · ip unknown"` for every dev session.
5. **Missing `lastUsedAt` and `scopes` in `listKeys` (`apps/dashboard/app/(app)/keys/actions.ts`)**:
   - Although `packages/db/src/schema/api_keys.ts` stores `scopes` and `lastUsedAt`, `listKeys()` only selects `id, name, prefix, env, createdAt, revokedAt`, preventing the UI from showing real `lastUsedAt` timestamps without extending the select projection.

---

## 6. Post-Redesign Delivery & Verification Summary

### 6.1 Completed Deliverables
1. **Design System (`packages/ui`, `apps/dashboard/app/globals.css`, `apps/dashboard/components/design-system/*`, `docs/DESIGN_SYSTEM.md`)**:
   - Single-source CSS custom properties for Light (`:root`) and Dark (`html[data-theme="dark"]`) modes, initialized before first paint via `THEME_INIT_SCRIPT` in `apps/dashboard/app/layout.tsx` (zero theme flash on load).
   - Shared `lucide-react` iconography and accessible primitives (`DsButton`, `StatusPill`, `DsInput`, `DsSelect`, `DsTextarea`, `DsCard`, `StatCard`, `DsBanner`, `CopyField`, `CodeBlock`, `EmptyState`, `Skeleton`, `Avatar`, `Kbd`, `DsDialog`, `ConfirmDialog`, `DsDrawer`, `DataTable`, `RelativeTime`, `CommandPalette`, `ToastProvider`).
   - Living style guide at `/dev/design-system` showcasing every token, component, and state in Light and Dark modes.
   - Reduced raw `#hex` count across `apps/dashboard` from the `678` budget down to `325` while keeping 100% parity with `packages/ui/src/tokens.test.ts`.
2. **Application Shell (`apps/dashboard/components/app-shell.tsx`, `apps/dashboard/app/(app)/layout.tsx`)**:
   - Collapsible sidebar (`[`) with section groupings, `lucide-react` icons, active left accent bar, `Setup` indicator on `/domains`, refined `PRO` badges with interactive upgrade modal, sticky Org/Project switcher, live Plan Usage meter, and User Menu with `Light / Dark / System` theme switcher.
   - Sticky top bar with hierarchical breadcrumbs, `Cmd/Ctrl+K` Command Palette (`G O`, `G E`, `G D`, `G T`, `G K`, `G W`, `G M`, `G S`, `?`), `Test / Live` mode switch with persistent test-mode warning strip, system status indicator, notifications popover, and responsive mobile drawer (`< 960px`).
3. **All 21+ Dashboard Pages Redesigned**:
   - **Overview (`/`)**: Setup Checklist (`Get Set Up for Production Sending`), 4-card KPI strip, `24h / 7d / 30d` telemetry chart, recent activity table, and infrastructure health.
   - **Emails (`/emails`, `/emails/new`)**: Unified `MessageExplorer` with slide-over `DsDrawer` Message Inspector (`Lifecycle Timeline`, `SMTP & Headers`, `Raw JSON`) + split-pane Email Composer with live `Desktop / Mobile / API Request` preview.
   - **Deliveries (`/deliveries`) & Logs (`/logs`)**: Cross-navigation tabs with `MessageExplorer` and live Event Stream filtering (`All / Delivered / Bounced / Deferred`).
   - **Templates (`/templates`, `/templates/new`, `/templates/[id]`)**: Searchable template cards + split-pane Template Studio with 1-click starter blueprints (`OTP / Magic Link`, `Password Reset`, `Invoice Receipt`), variable schema tester, and live sandboxed preview.
   - **Senders (`/senders`, `/senders/[senderId]`) & Domains (`/domains`)**: Step-by-step DNS record cards (`DKIM`, `SPF`, `DMARC`) with `CopyField` buttons, DNS provider tabs (`Cloudflare`, `Route 53`, `Vercel`, `Namecheap`), and `ConfirmDialog` for destructive actions.
   - **Inbox (`/inbox`), Webhooks (`/webhooks`), API Keys (`/keys`), SDKs (`/sdks`), SMTP (`/smtp`)**: Full Pro architecture previews, signing secret reveal with `CopyField`, one-time API key modal, 8-language SDK playground, and SMTP vs REST architectural comparison.
   - **Analytics (`/analytics`), Suppressions (`/suppressions`), Integrations (`/integrations`), Usage (`/usage`), Audit Logs (`/audit-logs`), Settings (`/settings`), 404 (`not-found.tsx`), Error (`error.tsx`)**: Redesigned with consistent `DsPageHeader`, `StatCard`, `StatusPill`, `ConfirmDialog`, and tabbed sub-navigation.

### 6.2 Visual QA & Automated Verification
- **Before Screenshots**: 42 captures (`1440×900` and `390×844`) in `docs/redesign/before/`.
- **After Screenshots**: 47 captures (`1440×900` and `390×844`, plus Dark Mode, Command Palette, and `/dev/design-system`) in `docs/redesign/after/`, verified with **0 horizontal overflows (`scrollWidth === innerWidth`)** and **0 runtime/hydration page errors**.

