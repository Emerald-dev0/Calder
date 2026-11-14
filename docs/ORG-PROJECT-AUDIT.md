# Organisation, Project and Inbound Email — Audit

Stage 1 of the organisation / project / inbound-email work. Everything below was
read in the tree at `c77fc04`, not inferred from the docs. File references are
the evidence.

## 1. The switching bug, root cause

There is **no active-organisation concept in the product**. Nothing resolves or
stores "which organisation am I in". Context is inferred per request from a URL
query parameter, and that inference has five separate defects that compound into
"switching does not work".

**1.1 Context is a `?project=` query parameter, not state.**
`lib/auth.ts` loads every membership and every project the user can see, then
`resolveProject(ctx, ?project)` picks one — or, with no parameter, `all[0]`, the
first project of the first membership. 24 page files depend on this
(`audiences`, `billing`, `broadcasts`, `deliveries`, `domains`, `emails`,
`keys`, `senders`, `suppressions`, `webhooks`, `templates`, …). Nothing persists.

**1.2 The fallback is non-deterministic.** `getTenantContext()` runs two
`SELECT`s with **no `ORDER BY`** (`lib/auth.ts:31-51`). Row order for an
unordered query is whatever the plan returns. With two organisations the
"default" project — and therefore the organisation the UI claims you are in —
can differ between two requests, two tabs, or after a redeploy. This is the
first thing a user experiences as "switching doesn't stick".

**1.3 Sidebar navigation drops the context it was given.** `app-shell.tsx:209`
builds links with `withProject()`, which only appends `?project=` **if the
current URL already has one**:

```ts
const withProject = (href) => projectParam ? `${href}?project=${...}` : href;
```

Land on a page without the parameter (a bookmark, `/settings`, a redirect) and
every subsequent nav click is context-free, so the next page silently re-derives
`all[0]`. That is the reported bug in its most common form.

**1.4 The switcher derives the active organisation from the active project.**
`context-switcher.tsx:83-92`:

```ts
const current = allProjects.find((p) => p.id === requested) ?? allProjects[0];
const currentOrg = memberships.find((m) => m.organization.id === current?.orgId) ?? memberships[0];
```

Consequences: an organisation with **zero projects can never be active**
(clicking it navigates to `/settings`, which has its own unrelated fallback);
and the check mark on "which org am I in" is really "which project is in the
URL".

**1.5 A second, disagreeing mechanism.** `settings/page.tsx:21` reads `?org=`
with its own fallback to `memberships[0]`. So the organisation shown in settings
can be a different one from the organisation implied by `?project=` on the page
you came from.

**1.6 Context-dependent chrome reads the wrong org.** `app-shell.tsx:288`
(`memberships[0].organization.name` for the breadcrumb) and
`app/(app)/layout.tsx:56` (`const firstOrg = ctx.memberships[0]`) — the plan
name and monthly quota in the sidebar come from the **first** organisation, not
the active one. With two orgs on different plans, the sidebar shows the wrong
plan and the wrong ceiling. That is a correctness bug with money attached.

**1.7 Removed / deleted organisation.** `?project=` that no longer resolves
returns `null` → pages `notFound()`, which is correct but unhelpful; `?org=`
silently falls back to another organisation rather than saying access ended.

## 2. Isolation review

**Holds.** Every server action that takes a `projectId` from the client resolves
it through `resolveProject` / `requireProject` / `actorForProject`, i.e. through
the caller's own membership list — a hidden form field is a request, never a
grant (`audiences/actions.ts:23`, `broadcasts/actions.ts:23`,
`senders/actions.ts:57`). The API is stricter still: `authMiddleware` resolves a
project key to `{ organizationId, projectId }`, and `GET /v1/projects`
deliberately returns only the key's own project rather than sibling projects.
Team actions verify the caller's role against the org being mutated
(`settings/actions.ts:74-86`), and last-owner demotion/removal is refused.

**Weak.** All resources hang off `projects`, so "organisation isolation" is in
practice project isolation. That is fine today and a trap tomorrow: the first
org-level resource (an inbox, say) has no established scoping pattern to copy.
`getTenantContext` is `cache()`d **per request** only — there is no
`unstable_cache` anywhere in the dashboard, so there is no cross-user cache
poisoning to fix, but equally no proven pattern for when one is introduced.

**No test asserts that two organisations cannot see each other.** There are
scoped-query tests and a project-key test; there is no "user in org A requests
org B's project, domain, key or email" assertion anywhere.

## 3. Entitlements: declared, mostly not enforced

`packages/db/src/resource-limits.ts` is the right design — org-level counting,
`checkOrganizationResource`, `assertCanCreateResource`, `ResourceLimitError`
carrying `code: plan_limit_reached`, status 402 and upgrade metadata. It is
wired for **senders only**:

| Resource               | Plan limit  | Enforced?                                                                                                                                           |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| senders                | 5 / 10 / 25 | yes — API `routes/senders.ts:151`, dashboard `lib/senders/service.ts:478,545`                                                                       |
| projects               | 3 / 3 / 10  | **no** — `onboarding/actions.ts:createProject` inserts directly                                                                                     |
| domains                | 2 / 3 / 10  | **no** — `routes/domains.ts` has no check                                                                                                           |
| seats                  | 1 / 2 / 5   | **no** — `inviteMember` checks role, not seats; the invite is also attached at sign-in (`api/auth/email-code/verify/route.ts:140`) with no re-check |
| organisations per user | not defined | **no policy at all**                                                                                                                                |

`UNENFORCED_PLAN_LIMITS` lists only `retentionDays` and `gmailSenders`, which is
misleading: three of the four enforced-by-design resources are not enforced.

## 4. Lifecycle gaps

- **No project deletion or archival.** Projects can be created and never removed.
- **No organisation deletion, and no "leave organisation".** Removal exists for
  other members only.
- **No project settings page.** Nothing in `app/(app)` renders per-project
  settings, so a transfer entry point has nowhere to live yet.
- **No organisation count policy**, so "create unlimited orgs" is the current
  behaviour.

## 5. Project move: what the schema says

Everything below is `project_id`-owned, so it moves with the project by
definition and needs no row updates: `domains`, `sender_identities`,
`transports` (via sender), `api_keys`, `api_key_senders`, `webhooks` +
deliveries, `emails`, `templates`, `broadcasts` (also carries
`organization_id`), `inbound`-less. What does **not** follow automatically:

| Table                                    | Shape                                                                                                                                    | Decision needed                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `suppressions`                           | `project_id` **and** `organization_id`, org column maintained by a `BEFORE INSERT OR UPDATE OF project_id` trigger (`0027_…sql:108-123`) | must be updated explicitly; the trigger will not fire on a project row change                |
| `usage_records`                          | org-scoped with a nullable `project_id`                                                                                                  | historical usage must stay with the org that incurred it (billing truth), so **do not move** |
| `audit_logs`                             | org + project                                                                                                                            | write one row in each org                                                                    |
| `audiences` / `contacts` / `segments`    | org-scoped, not project-scoped                                                                                                           | must not move; a project that broadcasts must not drag org contacts with it                  |
| `broadcasts`                             | both ids                                                                                                                                 | carries an org id that would go stale if moved without its audiences                         |
| `subscriptions` / `credits` / `payments` | org-scoped                                                                                                                               | never move                                                                                   |
| `emails.attachments`                     | base64 in `jsonb`                                                                                                                        | moves with the row; no storage re-pointing                                                   |

`projects.slug` is unique per organisation **by index, not constraint**
(`projects.ts:31`), so a destination org can already hold the same slug; a
transfer must resolve that rather than fail on a duplicate.

## 6. Inbound email readiness

What exists and is reusable:

- **SNS ingress with real verification** (`apps/api/src/routes/ses-events.ts`,
  `lib/ses-events.ts`): SignatureVersion 1 only, signing certificate fetched
  only from `sns.<region>.amazonaws.com`, optional topic allowlist, no
  auto-subscription-confirm without one, idempotent application, 400/500 split
  so SNS retries behave.
- **SES outbound path**, sender identities, suppression handling.
- **The drain** as the retry engine for anything that needs a second attempt.

What does **not** exist:

- **No S3 client anywhere in the repo.** `@aws-sdk/client-s3` is not a
  dependency; attachments are base64 in `jsonb`. Inbound raw MIME _must_ live in
  object storage, so this is a new dependency and a new abstraction.
- **No MIME parser.** No `mailparser` or equivalent.
- **No inbound tables, no MX concept, no receiving-domain model.** `docs/`
  correctly describes inbound as absent; `/inbox` renders Coming Soon.
- **R2 credentials are configured in Vercel** (`R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) but **no code reads
  them**. Unverified — nothing in this repository proves that bucket exists.

**Infrastructure that must be configured outside this repo** (and therefore can
only be documented, never claimed as done): an SES receipt rule set with an
S3 action, the bucket + policies + lifecycle, an SNS topic subscribed to the
receipt rule with our HTTPS endpoint, MX records on a dedicated subdomain, and
IAM credentials for our process. Receiving uses different MX targets from
sending and **must not** share MX with a customer's Google Workspace — hence the
subdomain-first onboarding design in §8.

## 7. Plan for the work, in the order I will do it

**Stage 2 (this change).** A real, server-validated context: cookies for org and
project, resolved once per request against membership, deterministic ordering,
a switch action that revalidates and redirects, a switcher that lists every
organisation (including empty ones), nav that carries context, chrome that reads
the active org, and enforcement wired for projects, domains and seats so a
transfer cannot be used to escape a ceiling. Then project transfer: preview with
consequences, atomic apply, audit in both orgs, slug and limit resolution.

**Stage 3 (next).** Inbound: receiving-domain model on a subdomain, SES receipt
rule + S3 raw storage behind a small storage interface, SNS ingestion reusing
the existing verification, MIME parsing into `inbound_messages`, separate
`inbound` usage dimension and plan entitlement, idempotency by SES message id.

**Stage 4.** Shared inbox: `inboxes`, `inbox_members`, `conversations`,
`inbox_messages`, assignment/notes/status/labels, replies through a verified
sender identity, per-inbox permissions layered on the existing org roles.

**Stage 5.** The verification matrix in the brief, plus the cross-organisation
leak suite that does not exist today.

## 8. Stage 2 — what was actually built

Everything below is in this branch and typechecks/lints/tests clean. Nothing in
this section is aspirational; anything not built is listed as _not done_.

### 8.1 One resolved context per request (`apps/dashboard/lib/context.ts`)

The audit's root cause in §1 was that the active organisation was inferred at
several call sites from `memberships[0]` — which is whatever order Postgres
returned, and which silently ignores the user's choice. There is now a single
pure function, `selectActiveContext`, with one precedence order:

```
?project=  →  ?org=  →  cookie calder_project  →  cookie calder_org  →  first org
```

Every step is filtered by real membership, so an id lifted from a URL or a
cookie that the user no longer belongs to cannot select anything. Projects are
authoritative over organisations because a project implies its org; an explicit
`?org=` outranks a remembered project so "switch organisation" can never
bounce back to the project the user just left.

`stale` is narrower than before: it is true only when a _remembered cookie_ id
no longer resolves (deleted project, removed from org) — the case
`forgetStaleContext` exists to clear. An explicit URL id that the user cannot
see is not "stale"; it is simply refused, and the user lands on their own
default instead of a permission error page.

`lib/context.test.ts` pins this with 15 tests, including the three ordering
surprises: requested project beats remembered org, remembered project beats a
remembered org that disagrees, and a stranger's project id falls back to the
user's own first org rather than erroring.

### 8.2 The switcher lists every organisation

`app-shell.tsx` now takes the full `switchableOrganizations` array (sorted by
`createdAt, id`, including orgs with no projects) and the active id, so the
selector never renders an organisation the user is not in and never hides one
they are. Switching is a server action (`context-actions.ts → switchContext`),
not a client-side state change: it validates membership, writes both cookies,
revalidates the layout and redirects, so every org-scoped query after the click
runs against the new org.

### 8.3 Enforcement is no longer declarative

`UNENFORCED_PLAN_LIMITS` in `packages/config/src/plan-limits.ts` claimed
projects, domains and seats were sold but not enforced. They are now enforced,
each at its creation path, using `checkOrganizationResource`:

| Resource | Enforcement point                                     | Refusal                                              |
| -------- | ----------------------------------------------------- | ---------------------------------------------------- |
| senders  | 3 existing sites                                      | unchanged                                            |
| domains  | `POST /v1/domains` (`apps/api/src/routes/domains.ts`) | `402` with `{resource,tier,limit,used,upgrade_tier}` |
| projects | `createProject` (onboarding)                          | human-readable message, no insert                    |
| seats    | `inviteMember` (settings)                             | refuses before minting the token                     |

Seats count members **plus pending invitations**, which is the audit's §3
finding: counting only accepted members let an owner on a one-seat plan invite
unlimited people and have them all accept.

### 8.4 Project transfer (`lib/projects/transfer.ts`)

Two functions, deliberately sharing their helpers so the preview cannot promise
something the apply then refuses:

- `previewProjectTransfer` returns the inventory, what moves automatically,
  what is rewritten, what stays behind, destination project/domain usage, the
  resolved slug, and two separate lists: **blockers** (settings the move
  impossible) and **warnings** (consequences the user must understand).
- `transferProject` runs one transaction: `SELECT … FOR UPDATE` on the project,
  typed-name confirmation, both roles re-checked, destination project _and_
  domain ceilings re-checked **inside** the transaction, then the update and
  one audit row in each organisation.

Decisions the schema forced, documented on the page rather than hidden:

| Resource                                                      | Behaviour                                            | Why                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| domains, senders, keys, webhooks, templates, delivery history | move (same `project_id`)                             | they are keyed to the project; recreating them would break live keys                           |
| `suppressions.organization_id`                                | rewritten in the same transaction                    | a trigger maintains it only on `UPDATE OF project_id`; leaving it stale is a cross-tenant read |
| `usage_records`                                               | stay with the billing org                            | a transfer is not a refund                                                                     |
| `audit_logs`                                                  | one row per org (`project.transferred_out` / `_in`)  | each org can answer "where did it go" without reading the other's log                          |
| broadcasts                                                    | hard blocker                                         | they send from org-level audiences that stay behind                                            |
| slug                                                          | `slug`, else `slug-2`, `slug-3`…                     | destination comments cannot collide                                                            |
| API keys                                                      | keep working, now governed by the destination's plan | stated explicitly, because it is the one consequence that is a security decision               |

A refusal changes nothing: §9 of the integration test forces a transfer into a
destination at its domain ceiling and then asserts the project, its
suppressions and the audit log are byte-identical.

### 8.5 Dashboard

`/settings/projects` (index) → `/settings/projects/[id]/move` (destination
picker, then consequences, then typed confirmation). The move page states
access changes, billing implications and domain handling before the button,
and a blocked project has the confirm button disabled rather than an error
after the fact. `/settings` gained a "Projects" card; the overview now scopes
its counts to the active organisation (it previously summed every membership)
and shows a `role="status"` confirmation after a move.

### 8.6 Verification performed

- `tsc --noEmit` — dashboard and api, exit 0.
- `eslint` on every touched file, clean.
- `prettier --check`, clean.
- `vitest run` (dashboard, unit) — 275 passed, 52 skipped (integration-gated).
- `RUN_INTEGRATION_TESTS=1 vitest run lib/projects/transfer.integration.test.ts`
  — 8 passed against local Postgres 17: preview is read-only, stranger refused,
  confirmation mismatch no-ops, broadcast blocker no-ops, full move preserves
  id/slug/metadata and re-points suppressions, slug collision resolves to
  `-2`, domain ceiling reported _and_ enforced with full rollback.

### 8.7 Not done in Stage 2

- `UNENFORCED_PLAN_LIMITS` in `packages/config/src/plan-limits.ts` was
  re-checked against the code: it lists only `retentionDays` and
  `gmailSenders`, both still genuinely unenforced, so §3 of this audit
  overstated the gap and the constant needs no change. The control page that
  renders it therefore stays honest.
- No orgs-per-user policy exists, so there is no ceiling on how many
  organisations one person can create. Out of scope for this release.
- "Move project" is reachable from `/settings` and `/settings/projects`, not
  from the project switcher itself.
