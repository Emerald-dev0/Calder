# Inbound email and shared inboxes — operations

This document is the honest boundary between **what the repository implements**
and **what must exist in AWS**. Nothing here claims that AWS infrastructure is
configured. As of this branch, the code is complete but the infrastructure below
has **not** been provisioned or verified.

---

## 1. What the code does

| Concern                                     | Where                                                      | State                       |
| ------------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| Receiving domains, DNS proof, MX safety     | `packages/db/src/receiving-domains.ts`, `dns-challenge.ts` | implemented                 |
| Raw MIME storage                            | `packages/providers/src/inbound-storage.ts` (S3)           | implemented, needs a bucket |
| MIME parsing, caps, attachments             | `apps/api/src/lib/inbound/parse.ts` (postal-mime)          | implemented                 |
| Ingestion, dedupe, quota, metering, routing | `apps/api/src/lib/inbound/ingest.ts`                       | implemented                 |
| Routing + threading                         | `packages/db/src/inbox-routing.ts`                         | implemented                 |
| Shared inbox data + permissions             | `packages/db/src/inboxes.ts`, `inbox-permissions.ts`       | implemented                 |
| Inbound allowance (separate from outbound)  | `packages/config/src/plan-limits.ts`                       | implemented                 |
| Webhook `inbound.received`                  | ingest → `enqueueWebhookDeliveries`                        | implemented                 |

### The one thing the code cannot do

Create the SES receipt rule set, the S3 bucket policy, the SNS subscription or
the MX record. Those are account-level actions. The repository records an
operator's assertion that a rule exists (`receiving_domains.provisioned_at`,
via `POST /v1/admin/receiving-domains/:id/provisioned`) and **refuses to accept
mail for a domain without it**. That is deliberate: a green DNS check must never
be mistaken for a working receive path.

---

## 2. Environment variables

| Variable                                                   | Default                | Meaning                                                                             |
| ---------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `INBOUND_ENABLED`                                          | `false`                | Master switch. Every inbound route 404s while false.                                |
| `INBOUND_BUCKET`                                           | —                      | Bucket the SES receipt rule writes raw MIME into, and where attachments are stored. |
| `INBOUND_S3_PREFIX`                                        | `inbound/`             | Key prefix; must match the bucket's lifecycle rule.                                 |
| `INBOUND_MX_HOST`                                          | `inbound.calder.click` | MX target customers point at.                                                       |
| `INBOUND_SES_RULE_SET`                                     | —                      | Rule set name, recorded for operators.                                              |
| `INBOUND_SNS_TOPIC_ARNS`                                   | —                      | **Required allowlist** of SNS topics whose notifications are accepted.              |
| `INBOUND_MAX_BYTES`                                        | 25 MiB                 | Hard ceiling on a stored message.                                                   |
| `INBOUND_MAX_BODY_CHARS`                                   | 262 144                | Characters kept per body; longer bodies are marked truncated.                       |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | —                      | Already used by outbound SES; inbound reuses them.                                  |

`INBOUND_ENABLED=false` plus every other variable unset is the default state of
the repository: inbound is closed until someone opens it deliberately.

---

## 3. AWS work, in order

1. **Bucket.** Create one bucket for raw mail (e.g. `calder-inbound-<env>`) in
   `AWS_REGION`. Enable default encryption (SSE-S3 or SSE-KMS). Add a lifecycle
   rule that expires the raw MIME prefix (e.g. 30 days) — the parsed bodies and
   attachments live under different keys, so expiring raw mail does not break the
   inbox, but it does mean `raw_storage_key` will eventually point at nothing
   (attachments are stored separately and are unaffected).
2. **Bucket policy** allowing the SES service principal to `s3:PutObject` on
   `${INBOUND_S3_PREFIX}ses/*`.
3. **SNS topic** (e.g. `calder-inbound-receipts`) in the same region. Subscribe
   it to the API's HTTPS endpoint `https://<api-host>/v1/inbound/sns`. Confirm the
   subscription: the endpoint auto-confirms **only** for topics in
   `INBOUND_SNS_TOPIC_ARNS`, so set that variable before confirming.
4. **Receipt rule set** (`INBOUND_SES_RULE_SET`), activated. For each receiving
   domain, one rule:
   - recipients: the domain (or a subdomain pattern) the customer verified;
   - actions: **S3** (bucket from step 1, prefix `${INBOUND_S3_PREFIX}ses/`) then
     **SNS** (topic from step 3, encoding UTF-8);
   - no TLS requirement; no spam/virus gate beyond SES defaults (both verdicts
     are recorded per message).
5. **MX records**, added by _the customer_, on a **dedicated subdomain** that
   does not currently receive mail: `inbox.acme.com MX 10 <INBOUND_MX_HOST>`.
   The dashboard refuses to verify a domain whose MX already points at another
   provider (Google Workspace, Microsoft 365, Zoho…), because adding a second MX
   next to a live provider splits delivery and loses mail.
6. **IAM** for the API process: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`
   on the bucket, and nothing else.
7. **Record the rule** per domain:
   `POST /v1/admin/receiving-domains/:id/provisioned` with
   `{ "ruleSetName": "...", "ruleName": "..." }` and the admin key. Until this
   row exists, ingestion ignores the domain (`receivingDomainAccepts`).
8. **Verify end to end**: send a real message from an external account to
   `<something>@<verified-domain>` and check
   `GET /v1/inbound/messages` and the dashboard inbox. Do not mark this done
   from a passing test — tests use an in-memory store, not S3 or SNS.

---

## 4. Dedupe, retries and failure behaviour

- **Dedupe.** `inbound_messages.ses_message_id` is unique. SNS redelivery returns
  `{ ok: true, status: "duplicate" }` and writes nothing — including no second
  unit of usage.
- **Transient failures** (S3 read error, parse crash) leave the row in `failed`
  with `failure_reason` and increment `processing_attempts`. The endpoint returns
  500 so SNS retries; a retry of a `failed` row reprocesses it (up to
  `INBOUND_MAX_ATTEMPTS = 5`). After that, a redelivery is acknowledged and the
  row stays `failed` for an operator to inspect.
- **Permanent failures** (no S3 action in the receipt rule, unparseable MIME,
  oversized message) are recorded as `rejected`/`failed` with a reason and
  acknowledged, because retrying cannot change them.
- **Quota refusals** are recorded as `rejected` with the allowance message, take
  no storage and are **not metered**.
- **Unknown recipient domain** is acknowledged and ignored (not an error): a
  shared rule set can deliver mail for domains we no longer host, and retrying
  would be a storm.

---

## 5. Metering and allowances

- Inbound usage is written to `usage_records` under the metric
  `inbound_emails`, id `ur_inb_<inboundMessageId>`, `ON CONFLICT DO NOTHING`.
  Every outbound query filters on `emails_sent`, so an inbound row can never be
  added to an outbound total — the isolation is structural, not a convention.
- A plan's inbound allowance is `inboundEmailsPerMonth`
  (Beginner 500, Starter 2 000, Pro 10 000, Premium 50 000, Scale custom). A
  plan with no number is a hand-priced contract plan, never "unlimited by
  accident".
- Receiving domains are their own ceiling (`receivingDomains`: 2 / 3 / 10 / 50),
  counted apart from sending domains.
- Stored bytes are metered (`organizationInboundStorage`) but not capped:
  `inboundStorageMb` is listed in `UNENFORCED_PLAN_LIMITS`, so the product says
  so instead of pretending otherwise.

---

## 6. Shared inbox model

| Concept | Table                 | Notes                                                                                  |
| ------- | --------------------- | -------------------------------------------------------------------------------------- |
| Mailbox | `inboxes`             | Belongs to a project; `default_sender_id` is the identity replies are sent from.       |
| Routing | `inbox_routes`        | `(receiving_domain, local_part)` unique; `*` is the catch-all. One address, one inbox. |
| Team    | `inbox_members`       | `viewer` / `member` / `manager`, layered on the organisation role.                     |
| Thread  | `inbox_conversations` | Header threading first, then subject+participants within 45 days.                      |
| Replies | `inbox_replies`       | Points at the real `emails` row; sending goes through the ordinary send path.          |
| Notes   | `inbox_notes`         | Never sent.                                                                            |

Permissions are decided in exactly one pure function,
`inboxCapabilities({ organizationRole, inboxRole })`:

- organisation owner/admin → manager (a workspace cannot lock itself out);
- organisation member → their inbox role, or nothing if they have no row;
- no organisation membership → nothing, even if an `inbox_members` row survives
  (a removed colleague must lose the mailbox).

---

## 7. Deliberate gaps in this release

- **No inbox writes over the API.** Replies, notes, assignment and status are
  dashboard-only, because they need a signed-in author. The API exposes inboxes
  and conversations read-only.
- **No SES API provisioning.** Rule creation is an operator action recorded in
  `receiving_domains`; see §1.
- **No storage cap.** Metered, not enforced (§5).
- **No inbound DNS verification over the API.** Domains are added and verified
  in the dashboard; there is no `/v1/receiving-domains` route yet.
- **No IMAP/SMTP or forwarding out.** Calder receives, stores and replies; it
  does not forward inbound mail to another mailbox.
