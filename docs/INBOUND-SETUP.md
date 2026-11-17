# Inbound email — setup runbook (zero → a real received message)

This is the operator's path from "the code is deployed" to "mail actually arrives,
threads, notifies and can be answered". It is written to be followed in order,
with real commands.

Everything in `docs/INBOUND.md` describes what the code does. This file describes
what **you** must do in AWS and DNS, and — importantly — the steps where a green
checkmark in the product can still mean mail is not arriving.

As of this commit: **none of this has been provisioned.** `INBOUND_ENABLED=false`,
so every inbound route returns 404 and nothing half-wired is reachable.

---

## 0. Definition of done

Inbound is live when all eight are true. Not before.

1. `GET /v1/health` (or your equivalent) is reachable over public HTTPS on the API
   host you will give SNS.
2. `aws sns list-subscriptions-by-topic` shows your endpoint with a real
   `SubscriptionArn` — **not** `PendingConfirmation`.
3. The receiving domain shows **DNS verified** in `/receiving`.
4. The domain is also a verified **SES identity** in the same region (see §1.2 —
   this is the step everyone forgets).
5. `POST /v1/admin/receiving-domains/:id/provisioned` returned `ok: true`.
6. A real message sent from an outside account (Gmail, not your own domain)
   appears in `GET /v1/inbound/messages`, in `/receiving`, and in `/inbox` as a
   conversation.
7. The bell shows a notification for it and the inbox rail shows an unread badge.
8. A reply from the inbox reaches that outside account, and the reply arrives back
   in the same thread when they answer.

---

## 1. Prerequisites and honest constraints

### 1.1 Region

SES email **receiving** only exists in some regions. `us-east-1` (N. Virginia) is
one of them and is where this deployment already sends from (ADR-023). Use the
same region for the bucket, the SNS topic and `AWS_REGION` — SES, SNS and the
receipt rule must all be in the SES region. S3 may be elsewhere, but there is no
reason to make that harder on yourself.

### 1.2 The domain must be a verified SES identity in _your_ AWS account

AWS will not accept mail for a domain you have not proven you own. Calder's own
`_calder-inbound.<domain>` TXT record proves the _customer_ owns the domain to
_Calder_; it does not prove anything to SES.

Today the SES identity comes from the existing **sending-domain** flow: a domain
added and verified as a sender (`/domains` → DKIM CNAMEs at
`CreateEmailIdentity`) is a verified identity, and receiving for that exact domain
then works. A domain used **only** for receiving must still be verified in SES —
verify the exact subdomain you will receive on, since a verified `acme.com` does
not cover `inbox.acme.com`.

This is the single most likely cause of "DNS is green, product says provisioned,
and no mail ever arrives". It is a product gap, not a documentation gap — see
§11.

### 1.3 DNS control, and the dedicated-subdomain rule

The customer must be able to add MX and TXT records. **Never** point a live
domain's MX at Calder: MX is a single delivery path, so a domain whose mail
currently goes to Google Workspace or Microsoft 365 will lose mail if you add a
second MX next to it. Use a subdomain that receives nothing today:

```
inbox.acme.com     MX  10  inbound-smtp.us-east-1.amazonaws.com
_calder-inbound.inbox.acme.com   TXT  calder-inbound-verify=<token from the dashboard>
```

Calder refuses to verify a domain whose MX already includes another provider, for
exactly this reason.

### 1.4 Public HTTPS endpoint for SNS

SNS must be able to `POST https://<api-host>/v1/inbound/sns` and read the
`SubscriptionConfirmation`. If the API is behind Vercel, that URL must not be
protected by deployment authentication.

### 1.5 Things you need to hand

- AWS account access with rights to S3, SNS, IAM, SES.
- `ADMIN_API_KEY` for the admin call in §8 (it is already set for other admin
  routes, or admin routes are 503 and this step cannot be done).
- The ability to redeploy the API after changing environment variables.

---

## 2. Step 1 — the S3 bucket

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export BUCKET=calder-inbound-prod
export TOPIC=calder-inbound-receipts

aws s3api create-bucket --bucket "$BUCKET" --region us-east-1

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
```

Lifecycle: expire **raw SES-written mail** after 30 days. Attachments live under a
different prefix (`inbound/<project>/<message>/attachments/…`) and are what the
inbox serves, so they must not expire with the raw copy.

```bash
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-raw-inbound-mail",
      "Filter": {"Prefix": "inbound/ses/"},
      "Status": "Enabled",
      "Expiration": {"Days": 30},
      "AbortIncompleteMultipartUpload": {"DaysIncompleteMultipartUpload": 1}
    }]
  }'
```

Bucket policy — let SES write, and only SES, and only into its own prefix:

```bash
cat > /tmp/ses-bucket-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowSESPuts",
    "Effect": "Allow",
    "Principal": {"Service": "ses.amazonaws.com"},
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::$BUCKET/inbound/ses/*",
    "Condition": {"StringEquals": {"AWS:SourceAccount": "$ACCOUNT_ID"}}
  }]
}
JSON
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/ses-bucket-policy.json
```

---

## 3. Step 2 — the SNS topic and subscription

```bash
export API_HOST=api.calder.click
export TOPIC_ARN=$(aws sns create-topic --name "$TOPIC" --region "$AWS_REGION" \
  --query TopicArn --output text)
echo "$TOPIC_ARN"
```

**Order matters.** Set `INBOUND_SNS_TOPIC_ARNS=$TOPIC_ARN` and redeploy (§5)
_before_ subscribing. The endpoint refuses to auto-confirm a topic that is not on
that allowlist — deliberately, because anyone can make SNS sing.

```bash
aws sns subscribe --topic-arn "$TOPIC_ARN" \
  --protocol https \
  --notification-endpoint "https://$API_HOST/v1/inbound/sns" \
  --region "$AWS_REGION"

# Must print an ARN, not "PendingConfirmation":
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].SubscriptionArn' --output text
```

If it stays `PendingConfirmation`, SNS keeps retrying for three days; check the
API logs for `503 INBOUND_SNS_TOPIC_ARNS is not configured` and fix the env var.

---

## 4. Step 3 — IAM for the API

The API needs to read the raw mail SES wrote and to store attachments. Nothing
else in the bucket.

```bash
cat > /tmp/calder-inbound-iam.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::$BUCKET/inbound/*"
  }]
}
JSON

aws iam put-user-policy \
  --user-name calder-api \
  --policy-name calder-inbound-s3 \
  --policy-document file:///tmp/calder-inbound-iam.json
```

(If the API runs with a role, attach this as an inline policy to that role
instead. Do not widen it to the whole bucket — the SES-write prefix should stay
write-only for SES.)

---

## 5. Step 4 — environment variables, then redeploy

| Variable                 | Example                                                      | Notes                                                                                                          |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `INBOUND_ENABLED`        | `true`                                                       | Master switch. Default false = every route 404s.                                                               |
| `INBOUND_BUCKET`         | `calder-inbound-prod`                                        | Must match §2.                                                                                                 |
| `INBOUND_S3_PREFIX`      | `inbound/`                                                   | Attachments land under this. Keep the default.                                                                 |
| `INBOUND_SNS_TOPIC_ARNS` | `arn:aws:sns:us-east-1:123456789012:calder-inbound-receipts` | Comma-separated allowlist. Required.                                                                           |
| `INBOUND_SES_RULE_SET`   | `calder-inbound`                                             | Recorded for operators; must match §6.                                                                         |
| `INBOUND_MX_HOST`        | `inbound-smtp.us-east-1.amazonaws.com`                       | **Not** `inbound.calder.click` unless that name is a CNAME to SES — the MX check compares this string exactly. |
| `AWS_REGION`             | `us-east-1`                                                  | SES region.                                                                                                    |
| `ADMIN_API_KEY`          | ≥16 chars                                                    | Needed for §8.                                                                                                 |

Redeploy the API. Then confirm the switch is really on:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$API_HOST/v1/inbound/sns" \
  -H 'content-type: application/json' -d '{}'
# 400 = enabled and validating. 404 = INBOUND_ENABLED is still false.
```

---

## 6. Step 5 — the SES receipt rule set

One rule set, activated, with one rule per receiving domain. SES allows exactly
one active rule set per account, so if you already have one (bounced mail, other
products), add rules to **it** instead of creating a second and deactivating
theirs.

```bash
export RULE_SET=calder-inbound
export DOMAIN=inbox.acme.com
export RULE_NAME=acme-inbox

aws ses create-receipt-rule-set --rule-set-name "$RULE_SET" --region "$AWS_REGION" || true

cat > /tmp/rule.json <<JSON
{
  "Name": "$RULE_NAME",
  "Enabled": true,
  "ScanEnabled": true,
  "Recipients": ["$DOMAIN"],
  "Actions": [{
    "S3Action": {
      "BucketName": "$BUCKET",
      "ObjectKeyPrefix": "inbound/ses/",
      "TopicArn": "$TOPIC_ARN"
    }
  }]
}
JSON

aws ses create-receipt-rule --rule-set-name "$RULE_SET" \
  --rule file:///tmp/rule.json --region "$AWS_REGION"

aws ses set-active-receipt-rule-set --rule-set-name "$RULE_SET" --region "$AWS_REGION"
```

Why `S3Action` **with** `TopicArn` and no separate `SNSAction`: the S3 action
already publishes one receipt notification. Adding an `SNSAction` as well
publishes a second copy of the same event. Ingest dedupes on `ses_message_id`, so
it is harmless — but it doubles SNS traffic for no gain.

`ScanEnabled: true` keeps SES's spam/virus scanning; both verdicts are stored per
message and shown in the inbox.

---

## 7. Step 6 — the customer's DNS, then verify in the product

1. In the dashboard, `/receiving` → add the domain (`inbox.acme.com`).
2. The page gives you the exact TXT record (`_calder-inbound.inbox.acme.com`) and
   the MX target (from `INBOUND_MX_HOST`).
3. Customer publishes both records.
4. Click **Check DNS**. The product reads both records fresh — no cached "maybe".

Recommended TTL while setting up: 300. Once verified, raise it.

---

## 8. Step 7 — record the rule (the product refuses to guess)

```bash
curl -sS -X POST "https://$API_HOST/v1/admin/receiving-domains/<rcd_id>/provisioned" \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d "{\"ruleSetName\":\"$RULE_SET\",\"ruleName\":\"$RULE_NAME\"}"
```

`<rcd_id>` is the receiving domain's id (shown in `/receiving`, or
`select id, domain from receiving_domains`).

Until this succeeds, `receivingDomainAccepts` is false and ingest **ignores** the
domain — even though DNS is green and SES is delivering. That is on purpose: the
code cannot see AWS, so it refuses to claim the pipeline is complete.

---

## 9. Step 8 — the only proof that counts

```bash
# From an outside account (Gmail), NOT from your own domain:
#   To: support@inbox.acme.com   Subject: test from the outside

# Then, with a project API key:
curl -sS "https://$API_HOST/v1/inbound/messages?limit=5" -H "authorization: Bearer $CALDER_API_KEY"
```

Expected within a few seconds:

- `GET /v1/inbound/messages` shows the message, `status: parsed`, with a body and
  a `conversation_id` if an address routes to an inbox.
- `/receiving` shows it with the spam/virus verdicts.
- `/inbox` shows a new conversation, the rail badge increments, and the bell has
  one notification.
- Reply from `/inbox/<id>` → the outside account receives it.
- The outside account replies → it lands **in the same conversation**.

Prove the duplicate path too, because SNS is at-least-once:

```bash
# Re-deliver the same SNS message from the console (SNS → topic → publish a copy
# of the notification JSON). Nothing may change: no new message, no second unit
# of usage, no second notification, no second email.
```

---

## 10. Kill switch and rollback

| Want                               | Do                                                                    |
| ---------------------------------- | --------------------------------------------------------------------- |
| Stop accepting new mail, keep data | `INBOUND_ENABLED=false` and redeploy. Every route 404s.               |
| Stop SES delivering for one domain | Delete that receipt rule, or deactivate the rule set.                 |
| Stop SNS retries                   | Delete the SNS subscription.                                          |
| Stop one domain being processed    | Clear `receiving_domains.provisioned_at` (operator action).           |
| Turn mail back on                  | Re-enable in the same order: env → subscription → rule → provisioned. |

Inbound never touches the outbound ledger (`emails_sent`), so killing inbound
cannot affect sending quota.

---

## 11. What is still missing after all of the above

State these honestly rather than discovering them from a customer.

1. **SES identity verification is a manual prerequisite, not a product step**
   (§1.2). Recommended fix: create the SES identity when a receiving domain is
   added, show its DKIM records on `/receiving`, and refuse to mark a domain
   "accepting mail" until SES reports it verified. Until that exists, inbound
   works only for domains the workspace has already verified as senders.
2. **No spam filtering beyond SES verdicts.** Junk mail with a passing verdict
   becomes a conversation. There is no blocklist, no per-domain allowlist.
3. **No forwarding, no IMAP/SMTP.** Calder receives, stores and replies. It does
   not push mail to an existing mailbox.
4. **No attachment scanning or size policy beyond the caps** in
   `INBOUND_MAX_BYTES` / parse limits.
5. **Retention is not enforced** (`retentionDays` is currently unenforced, see the
   plan-limits note) — raw mail expires via the S3 lifecycle only.
6. **Notifications are poll-based** (≤1 min on an idle tab); no sockets.
7. **Per-member unread state is per person and per thread**, and only for people
   who are members of the inbox. Organisation admins who are not members see the
   inbox (they can open it) but get no badge until they are added.

---

## 12. Troubleshooting

| Symptom                                         | Most likely cause                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every inbound route 404s                        | `INBOUND_ENABLED` is false, or the API was not redeployed.                                                                                                       |
| SNS subscription stuck on `PendingConfirmation` | `INBOUND_SNS_TOPIC_ARNS` unset/typo; endpoint returns 503 by design.                                                                                             |
| SNS notifications arrive, ingest says `ignored` | Domain row not `verified`, or `provisioned_at` is null (§8).                                                                                                     |
| Ingest accepts but `/inbox` shows nothing       | No inbox route matches the recipient. Unrouted mail is stored at project level with `inbox_id = NULL` — that is intended, and the fix is a route, not a re-send. |
| Nothing arrives at all, DNS green               | Domain is not a verified SES identity in this region (§1.2).                                                                                                     |
| `Receipt notification has no S3 objectKey`      | The rule's action is SNS-only; it must include the S3 action (§6).                                                                                               |
| Mail arrives, reply bounces or is refused       | Sender identity not verified, or the workspace is over its outbound allowance — replies are ordinary sends and are metered as outbound.                          |
| `502`/`500` looping in SNS                      | Transient ingest failure; ingest retries up to 5 times then marks the message `failed` with a reason. Check `inbound_messages.failure_reason`.                   |
| Duplicate-looking spikes in logs                | SNS at-least-once delivery. Duplicates return `status: duplicate` and write nothing.                                                                             |
