# Organisation, project, inbound email and shared inbox — implementation report

Branch: `arena/76a18165-calder` (from `c77fc04`).
Commits: `1bcc8c0` (organisation/project fixes + project transfer), `b4ec94b`
(inbound email + shared inboxes).

Read with `docs/ORG-PROJECT-AUDIT.md` (Stage 1 findings) and `docs/INBOUND.md`
(the AWS boundary). This document is the deliverable: what was broken, what was
fixed, what is new, what changed in the database, security and billing, what was
verified, and what is still missing.

---

## 1. What was broken

1. **The active organisation was a guess.** Several dashboard surfaces derived
   context from `memberships[0]` — whatever order Postgres happened to return —
   and the switcher wrote a cookie that nothing read. Two requests from the same
   user could show different organisations, and "switch organisation" could
   appear to work while every query still ran against the other one.
2. **The overview summed every membership.** `/` added up projects from all
   organisations and read the plan from `memberships[0]`, so a user in two
   workspaces saw a total that belonged to neither and a quota from the wrong
   plan.
3. **Plan limits were sold but unenforced** for three resources: projects,
   domains and seats. A workspace on Beginner (2 domains) could create twelve;
   an owner on a one-seat plan could invite an unlimited number of people, since
   only accepted members were counted.
4. **A project could not move between organisations at all** — no workflow, no
   preview, no audit trail. Because the schema keys nearly everything on
   `project_id`, the missing piece was small and dangerous: `suppressions`
   carries a denormalised `organization_id` maintained by a trigger that only
   fires on `UPDATE OF project_id`, so a naive move would have left bounce data
   pointing at the old workspace — a cross-tenant read.
5. **Inbound email did not exist.** `/inbox` was an honest "coming soon" page;
   there was no ingestion, no storage, no parsing, no allowance.
6. **Nothing tested organisation switching.** There were 275 dashboard tests and
   not one covered context selection.

## 2. What was fixed

### 2.1 One resolved context per request

`apps/dashboard/lib/context.ts` is now the only place that decides the active
organisation and project, as a pure function with one precedence order:

```
?project= → ?org= → cookie calder_project → cookie calder_org → first org (createdAt, id)
```

Every step is filtered by real membership, so an id from a URL or a cookie that
the user no longer belongs to selects nothing. `stale` now means only "a
remembered cookie id no longer resolves"; an explicit id the user cannot see is
simply refused and the user lands on their own default rather than an error.

`lib/auth.ts` resolves this once per request and exposes `active`; the switcher
(`context-switcher.tsx`), the shell chrome, the nav and every page read it. The
switcher lists **every** organisation the user belongs to (including ones with
no projects) and switches through a server action that validates membership,
writes both cookies, revalidates the layout and redirects.

`lib/context.test.ts` pins the behaviour with 15 tests, including the three
orderings that used to be ambiguous.

### 2.2 Limits are enforced where the resource is created

| Resource          | Enforced at                       | Refusal                                              |
| ----------------- | --------------------------------- | ---------------------------------------------------- |
| domains           | `POST /v1/domains`                | `402` with `{resource,tier,limit,used,upgrade_tier}` |
| projects          | `createProject` (onboarding)      | readable message, no insert                          |
| seats             | `inviteMember`                    | refuses before minting the invitation token          |
| receiving domains | add-receiving-domain action       | same shape as domains                                |
| senders           | (unchanged, three existing sites) | unchanged                                            |

Seats now count members **plus pending invitations**: an invitation is a
promised seat, and counting it only on acceptance was how the limit was
bypassed.

### 2.3 Project transfer

`lib/projects/transfer.ts` is a preview/apply pair that share their helpers, so
the confirmation screen cannot promise something the apply refuses:

- **Preview** returns the inventory, what moves automatically, what is
  rewritten, what stays behind, destination project/domain usage, the resolved
  slug, and two separate lists — blockers and warnings.
- **Apply** is one transaction: `SELECT … FOR UPDATE` on the project, typed-name
  confirmation, both organisation roles re-checked, destination project _and_
  domain ceilings re-checked inside the transaction, the update, then one audit
  row per organisation (`project.transferred_out` / `project.transferred_in`).

Per-resource decisions, stated on the page rather than hidden:

| Resource                                                          | Behaviour                                 | Reason                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| domains, senders, API keys, webhooks, templates, delivery history | move                                      | keyed by `project_id`; recreating them would break live keys                |
| `suppressions.organization_id`                                    | rewritten in the same transaction         | the trigger fires only on `project_id`; a stale row is a cross-tenant read  |
| `usage_records`                                                   | stay with the billing organisation        | a transfer is not a refund                                                  |
| broadcasts                                                        | hard blocker                              | they send from org-level audiences that stay behind                         |
| slug                                                              | `slug`, else `slug-2`, `slug-3`…          | destination comments cannot collide                                         |
| API keys                                                          | keep working under the destination's plan | the one consequence that is a security decision, so it is stated explicitly |

A refusal changes nothing: the integration test forces a move into a destination
at its domain ceiling and asserts the project, its suppressions and the audit log
are byte-identical.

### 2.4 The overview shows one workspace

`/` is scoped to the active organisation and shows a `role="status"` confirmation
after a successful move.

## 3. New features

**Inbound receiving (Stage 3).**

- `POST /v1/inbound/sns` — SES receipt notifications, verified with the
  existing SNS RSA signature + certificate-origin checks, with a **required**
  topic allowlist (delivery feedback may accept any signed topic because it only
  updates existing rows; these notifications create mail inside a workspace).
- Domains are claimed with a TXT proof (`_calder-inbound.<domain>`) **and** an MX
  check that refuses a domain still pointing at Google Workspace, Microsoft 365
  or anyone else. Splitting a live mailbox between two providers loses mail, so
  the product asks for a dedicated subdomain instead.
- Raw MIME is read from the bucket the receipt rule wrote to; bodies are parsed
  with `postal-mime`; attachments are stored individually with a SHA-256 and a
  per-part row. Oversized parts are recorded as skipped, never silently dropped.
- Claims are unique on the SES message id: SNS redelivery is a no-op (including
  no second unit of usage). Transient failures leave a retryable row and return
  500 so SNS retries; permanent ones record a reason and acknowledge.
- `GET /v1/inbound/messages` (full-text search over subject/body/sender,
  keyset pagination), `GET /v1/inbound/messages/:id`,
  `GET /v1/inbound/messages/:id/attachments/:id` (streamed, project-scoped),
  `GET /v1/inbound/usage`.
- `inbound.received` webhook event.
- Dashboard **`/receiving`**: add a receiving domain, see the TXT and MX records
  with the MX warning beside them, check DNS, and read the three states
  separately — DNS verified, AWS rule recorded, accepting mail.

**Shared inbox (Stage 4).**

- `/inbox`: concession list with inbox rail, status filter, search, "assigned to
  me"; `/inbox/[id]`: thread with sandboxed HTML bodies, attachments, internal
  notes, reply composer, status and assignee controls; `/inbox/settings`:
  create an inbox, routing addresses, default sender, and mailbox members.
- Threading: `In-Reply-To`/`References` first, then subject + participants within
  45 days; a customer reply reopens a closed conversation.
- Replies are ordinary outbound emails (`sendTransactional`), so sender
  verification, suppression, quota, metering, retries and webhooks all apply.
  There is no second send path.
- `GET /v1/inboxes`, `/v1/inboxes/:id/conversations`,
  `/v1/inboxes/:id/conversations/:cid` for API clients (read-only).

**Notifications (Stage 5).**

The dashboard's bell previously claimed "no bounce spikes, webhook failures, or
DNS alerts in the last 24 hours" while querying nothing. It now renders real
rows from a real table, and hides behind an honest empty state when there is
nothing to show.

- `notifications` table — one row per person, per event, with the click target
  (`href`). Deduplication is structural: `(user_id, conversation_id, kind)` is
  unique when a conversation is involved, so an SNS redelivery or a retried
  ingest cannot create a second entry or a second email.
- Recipients come from one pure function, `planRecipients` in
  `packages/db/src/notification-policy.ts`:

  | Event                             | Who is notified                            | Email                                                                        |
  | --------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
  | New conversation                  | every member of the inbox, minus the actor | yes, once per conversation per member                                        |
  | Assignment                        | the new assignee only                      | yes, unless they assigned themselves                                         |
  | Reply on an existing conversation | the current assignee                       | yes, at most once an hour per conversation; unassigned threads notify nobody |
  | Machine mail                      | nobody                                     | no — prevents reply loops with auto-responders and lists                     |
  | Member with `notify = false`      | in-app row still created                   | no — muting is not hiding                                                    |

- Machine mail is detected from `Auto-Submitted` (anything but `no`),
  `Precedence: bulk|list|junk`, `X-Autoreply`/`X-Autorespond`, `List-Id`/
  `List-Unsubscribe`, and `mailer-daemon`/`postmaster` local parts. `noreply@` is
  deliberately **not** treated as machine mail: plenty of real businesses write
  to support from one.
- Email is capped at 5 per person per rolling hour. Past the cap the in-app row
  stands; the badge is the primary signal and never depends on a mail provider.
- Sending goes through `sendCompanyEmailQuietly` with the catalogue ids
  `inbox.new_conversation`, `inbox.assigned`, `inbox.reply_received`, all in the
  new, opt-out **`inbox`** category (settings → notifications renders them). The
  idempotency key is the notification row id, so a retry of the same event is a
  provider-level no-op as well as a database one.
- `/api/notifications` (GET feed + unread count, POST mark read) is session-scoped
  to the caller; opening a conversation marks its notifications read, and the
  shell polls once a minute plus on focus and navigation. There is **no**
  websocket or SSE: the dashboard is serverless, and adding one for a count would
  be infrastructure for its own sake.
- `inbox_members.notify` (default true) is the per-mailbox mute. A member may
  change their own without `manageMembers`; a manager may change anyone's.

## 4. Database and migrations

| Migration                | Contents                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0040_happy_shaman.sql`  | `receiving_domains`, `inbound_messages`, `inbound_attachments`; enums `receiving_domain_status`, `inbound_message_status`; GIN full-text index on subject/body/sender; unique `ses_message_id`; global unique receiving domain                                                                                                            |
| `0041_tiny_vargas.sql`   | `inboxes`, `inbox_routes`, `inbox_members`, `inbox_conversations`, `inbox_notes`, `inbox_replies`, `inbox_labels`, `inbox_conversation_labels`; enums `inbox_status`, `conversation_status`, `inbox_member_role`; `ALTER TYPE webhook_event ADD VALUE 'inbound.received'`; `inbound_messages.inbox_id`, `conversation_id` + three indexes |
| `0042_careless_clea.sql` | `notifications` (with partial unread index and unique `(user_id, conversation_id, kind)`); `inbox_members.notify` boolean default true                                                                                                                                                                                                    |

Design points worth stating:

- **Global uniqueness on receiving domains.** MX for one name can only point one
  place, so two projects claiming the same receiving domain would make routing
  ambiguous. The second claim is refused before the index is reached.
- **`ON DELETE SET NULL`, not CASCADE**, from `inbound_messages` to
  `receiving_domains` and `inbox_conversations`: removing a mailbox or a domain
  must not delete mail that already arrived. An unrouted message stays readable
  at project level — being unassigned is a recoverable state, not a black hole.
- **One address, one inbox.** `(receiving_domain_id, local_part)` is unique, with
  `*` as the catch-all. Exact rules beat the catch-all.
- **Deterministic conversation ids** (`cnv_<messageId>`), so a retried ingest
  attaches to the same thread instead of opening a duplicate.

No customer data is rewritten by these migrations; both are additive.

## 5. Security and permissions

- **Nothing trusts a client-supplied tenant id.** Dashboard reads resolve context
  from membership; API routes scope by the key's project; the inbox guard loads
  the inbox, finds the caller's organisation membership for its project, and
  treats "exists elsewhere" as "not found".
- **Inbox permissions are one pure function.** `inboxCapabilities({organisation
role, inbox role})`: org owner/admin → manager (a workspace cannot lock itself
  out), org member → their mailbox role or nothing, no org membership → nothing
  even if an `inbox_members` row survived a removal. No route, action or endpoint
  implements its own rule.
- **Inbound notifications are signed and allowlisted.** The topic allowlist is
  mandatory here; subscription confirmations are only auto-confirmed for an
  allowlisted topic.
- **Inbound mail is attacker-controlled text.** HTML bodies render in a sandboxed
  iframe with no scripts and no same-origin; attachments download with
  `Content-Disposition: attachment`, `nosniff` and a sanitised filename; the S3
  key never reaches the browser.
- **Transfer cannot be used to escape a ceiling.** Destination project and domain
  limits are re-checked inside the transaction, after the lock, not just on the
  preview screen.

## 6. Usage and billing

- Inbound is metered in `usage_records` under the metric `inbound_emails`
  (id `ur_inb_<messageId>`, `ON CONFLICT DO NOTHING`). Every outbound query
  filters on `emails_sent`, so the two allowances cannot contaminate each other
  by construction.
- **A 10 000-outbound customer keeps 10 000 after 500 inbound.** An integration
  test asserts that after several received messages the outbound ledger has zero
  units and no `emails` row exists.
- New plan fields: `inboundEmailsPerMonth` (500 / 2 000 / 10 000 / 50 000 /
  custom), `receivingDomains` (2 / 3 / 10 / 50), `inboundStorageMb`
  (100 / 500 / 2 048 / 10 240). A plan with no inbound number is a hand-priced
  contract plan, never "unlimited by accident".
- **No silent unlimited.** Exceeding the inbound allowance stores no body, takes
  no storage, is not metered, and leaves a `rejected` row with the reason so the
  customer can see it happened.
- Stored bytes are metered but not capped; `inboundStorageMb` is listed in
  `UNENFORCED_PLAN_LIMITS`, so the control page says so rather than implying a
  guarantee.
- Inbox count and team members are not metered. Team members are already the
  `seats` ceiling; inbox count has no ceiling because an inbox is not a resource
  that can be used to gain capacity — it only routes mail inside a project the
  customer already pays for. This is a deliberate decision, not an oversight.

## 7. Tests and verification

| Suite                                                                             | Result                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config` (`plan-limits.test.ts`, incl. 5 inbound-allowance tests)        | 29 passed                                                                                                                                                                                     |
| `packages/db` unit (incl. 8 inbox-permission tests, 16 notification-policy tests) | 77 passed, 55 skipped (integration-gated)                                                                                                                                                     |
| `packages/db/src/inbox-routing.integration.test.ts` (`RUN_INTEGRATION_TESTS=1`)   | 18 passed — routing, threading, catch-all precedence, orphans, reopen, unique address, optimistic concurrency, cross-organisation isolation                                                   |
| `apps/api/src/lib/inbound/parse.test.ts`                                          | 8 passed                                                                                                                                                                                      |
| `apps/api/src/lib/inbound/ingest.integration.test.ts`                             | 7 passed — store/parse/meter, duplicate no-op, attachments, ignored domains, non-S3 refusal, **inbound does not touch the outbound allowance**, quota refusal with no storage and no metering |
| `apps/dashboard` unit                                                             | 275 passed, 52 skipped                                                                                                                                                                        |
| `apps/dashboard/lib/projects/transfer.integration.test.ts`                        | 8 passed                                                                                                                                                                                      |
| `apps/dashboard/lib/context.test.ts`                                              | 15 passed                                                                                                                                                                                     |
| Typecheck (`tsc --noEmit`) dashboard + api                                        | clean                                                                                                                                                                                         |
| ESLint on all new files                                                           | clean                                                                                                                                                                                         |
| Prettier `--check`                                                                | clean                                                                                                                                                                                         |
| `packages/db` `schema-drift`                                                      | "schema matches 43 committed migration(s)"                                                                                                                                                    |
| Migrations against local Postgres 17                                              | 43/43 applied, none pending                                                                                                                                                                   |
| `next build` (dashboard, production)                                              | succeeded, including the new routes                                                                                                                                                           |

**Known pre-existing failure, unrelated to this work:**
`apps/api/src/scripts/verify-deploy.test.ts` (5 tests) fails in this sandbox
because the test spawns `pnpm`, which is not on `PATH` here.

**What these tests do not prove.** Nothing here exercised real S3, SNS, SES
receipt rules or MX. The ingest tests use an in-memory store and synthetic
notifications. That gap is exactly why the UI says "AWS rule not recorded" and
why `docs/INBOUND.md` §3 step 8 requires a real end-to-end send before inbound is
called working.

## 8. Infrastructure still required

None of the following is configured, and the product says so:

1. **S3 bucket** for raw mail, with a lifecycle rule, SSE and a bucket policy for
   the SES principal; IAM for the API (`GetObject`/`PutObject`/`DeleteObject`).
2. **SNS topic** `calder-inbound-receipts`, subscribed to
   `https://<api-host>/v1/inbound/sns`, with `INBOUND_SNS_TOPIC_ARNS` set before
   confirming (the endpoint only auto-confirms an allowlisted topic).
3. **SES receipt rule set** with one rule per receiving domain: S3 action + SNS
   action.
4. **MX records** on a customer-owned dedicated subdomain pointing at
   `INBOUND_MX_HOST` — never on a domain whose MX a live provider owns.
5. **Environment**: `INBOUND_ENABLED=true`, `INBOUND_BUCKET`,
   `INBOUND_SNS_TOPIC_ARNS`, `INBOUND_SES_RULE_SET`, optionally
   `INBOUND_MX_HOST`.
6. **Per-domain operator assertion**:
   `POST /v1/admin/receiving-domains/:id/provisioned` — until this row exists,
   ingestion ignores the domain on purpose.

`INBOUND_ENABLED` defaults to false, so every inbound route 404s on the current
deployment and no half-configured receive path is reachable.

## 9. Incomplete, deferred or blocked

- **API writes for the inbox.** Replies, notes, assignment and status changes are
  dashboard-only: they need a signed-in author, and an API key is not a person.
  The API exposes inboxes and conversations read-only.
- **SES provisioning from code.** Creating receipt rules requires account-level
  API calls this deployment cannot verify, so rule creation is an operator action
  recorded per domain (with the actor), never a claim by the code.
- **Storage cap.** Metered, not enforced (see §6).
- **Receiving-domain API.** Domains are added and verified in the dashboard;
  there is no `/v1/receiving-domains` route yet.
- **Labels UI.** The tables, actions (`setLabels`) and API shape exist; the
  conversation sidebar does not yet render a label picker. Creating labels has no
  UI either.
- **Unread counts.** The bell shows a real unread notification count and the
  total unread conversations across the inboxes you belong to
  (`unreadConversationCounts`), but the `/inbox` list itself still has no
  per-inbox badge.
- **Notification delivery is poll-based.** One request a minute per open tab,
  plus on focus and navigation. No sockets (see §3), so a notification can be up
  to a minute late on a tab that is left open and untouched.
- **Forwarding and IMAP/SMTP.** Not implemented: Calder receives, stores and
  replies; it does not forward inbound mail elsewhere.
- **Org-scoped inbox access on switch.** Inboxes are per project, so switching
  organisation changes which inboxes are visible automatically; there is no
  org-wide inbox view.
- **Native Postgres enum ordering.** `UPDATE`/`setLabels` are not covered by
  HTTP-level tests because the dashboard's actions require a real session
  (`next/headers`); the rules they enforce are covered by the pure capability
  tests and the package-level queries.
