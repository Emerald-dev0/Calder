# Deployment

Status: launch track active, queue (BullMQ), DB client (TLS + pooler-safe), and
cookie hardening are implemented; providers/hosting below are decided unless
marked otherwise.

## Environments

`development → staging → production`. Production data never reachable from local dev; test/live API keys enforce this as a second guard.

## Planned deployment shape

- `apps/web`, `apps/dashboard`, Vercel (or equivalent) for web-facing surfaces, deployed via the `vercel` CLI (see `AGENTS.md` CLI-first tooling).
  Monorepo wiring: **one Vercel project per app**. When importing, set the
  **Root Directory** to `apps/web` for the marketing site and `apps/dashboard`
  for the app (framework preset: Next.js; build command and output left as
  Vercel defaults). Connect both projects to the same GitHub repo (`Calder`);
  production branches deploy `main`, previews deploy PRs. Environment variables
  are set per project (see inventory below), never shared blindly between web
  and dashboard.
- `apps/api`, `apps/worker`, managed infra, provider TBD, must remain portable.
  (Pxxl evaluated and dropped, Vercel purchased domain + hosting keeps one
  vendor while pre-revenue.)
- `apps/api` deploys to Vercel as serverless functions. Vercel's runtime executes
  plain Node and does not compile the TS sources this monorepo's workspace
  packages export, so the shipped function is pre-bundled: `pnpm build` runs
  `scripts/bundle-serverless.mjs` (esbuild), which compiles `src/serverless.ts`
  — inlining every `@calder/*` workspace source while keeping npm packages
  external — into the generated, gitignored `api/index.js`, with a catch-all
  rewrite funneling every path (including `/v1/cron/drain`) to it and
  `maxDuration: 60` covering drain batches. The long-running node server
  (`src/index.ts`) remains for local dev and non-serverless deploys.
- DNS lives with the registrar (Vercel) until custom receiving email is needed;
  moving nameservers to Cloudflare free tier unlocks Email Routing for inbound
  (support@, hello@) plus faster TXT management. Cloudflare does not send mail
  , delivery stays SES; sending from dedicated subdomains (e.g. mail.&lt;domain&gt;)
  protects root-domain reputation. Note: Email Routing requires Cloudflare
  nameservers, is forwarding-only (not mailboxes), and pairs with Gmail Send-As
  for a $0 professional setup.
- Database, managed PostgreSQL. Recommended: **Neon** (serverless, branching
  for preview DBs, free tier; Supabase only if auth/storage extras are ever
  wanted, they aren't). Client enforces TLS outside localhost, disables
  prepared statements for pooler compatibility, pool via `DB_POOL_MAX`
  (default 10, lower per-instance on serverless).
- Queue/cache, managed Redis-compatible service. Recommended: **Upstash**
  (TLS `rediss://` URL swap only, no code changes; BullMQ options already
  compatible). Never a second source of truth.

## Launch checklist (confirmation email is the go/no-go)

SES production access is live (ADR-023: 50k/day, 14/s, us-east-1). The remaining
risk is a deploy that lacks the credentials, which is why the sending path now
fails loudly instead of simulating delivery (ADR-026).

```bash
# 1. Pull the production environment (Vercel project: api)
vercel env pull .env.production.local --environment=production

# 2. Verify every part of the confirmation path, in one command
pnpm launch-check          # exits non-zero when the path is not launch-ready
```

`launch-check` verifies, in order of what actually breaks launches:

| Check             | Passes when                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| email provider    | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` present, provider is SES                                                                                                         |
| SES account       | production access enabled, not sandbox (sandbox only mails verified recipients)                                                                                                |
| sending identity  | `SES_FROM_DOMAIN` is verified for sending with DKIM `SUCCESS` — an unverified identity rejects every live send while everything else looks healthy                             |
| delivery truth    | a configuration set is in play (`SES_CONFIGURATION_SET`, or the identity's own default) AND `SES_SNS_TOPIC_ARNS` is set — without both, bounces and complaints never come back |
| Calder sender     | `AUTH_EMAIL_FROM` set (the address itself must be verified in SES — launch-check cannot see inside the header value)                                                           |
| database          | reachable, migrations applied, internal tenant (`org_avenor` / `proj_website`) seeded                                                                                          |
| waitlist template | dynamic confirmation template present (editable without a deploy)                                                                                                              |
| queue             | `REDIS_URL` set, so retries and delayed sends survive a restart                                                                                                                |
| delivery wake-up  | `CRON_SECRET` set, so a `202` leaves immediately instead of waiting for the scheduled drain                                                                                    |
| admin access      | `ADMIN_API_KEY` set, so broadcasts and template edits work                                                                                                                     |
| secrets           | `AUTH_SECRET` and `WEBHOOK_SIGNING_SECRET` are no longer development defaults                                                                                                  |
| allowed origins   | `ALLOWED_ORIGINS` lists the first-party origins (`https://calder.click`, `https://app.calder.click`)                                                                           |

### Environment variables by project

| Variable                   | web | dashboard | api      | worker   |
| -------------------------- | --- | --------- | -------- | -------- |
| `AWS_ACCESS_KEY_ID/SECRET` |     |           | required | required |
| `AWS_REGION=us-east-1`     |     |           | required | required |
| `AUTH_EMAIL_FROM`          |     | required  |          |          |
| `SES_FROM_DOMAIN`          |     |           | required |          |
| `DATABASE_URL`             |     | required  | required | required |
| `REDIS_URL`                |     | required  | required | required |
| `CRON_SECRET`              |     |           | required |          |
| `ADMIN_API_KEY`            |     |           | required |          |
| `ALLOWED_ORIGINS`          |     |           | required |          |
| `API_URL`                  |     | required  | required |          |

Notes that cost time when missed:

- The dashboard sends its own auth mail (verification codes, magic links) through
  SES directly, so it needs AWS credentials too, not only the API.
- `AUTH_EMAIL_FROM` must be an identity verified in SES (domain or address).
  Without it, production mail goes out as `Calder <hello@calder.click>`, which
  fails unless that address is verified.
- A `202` from `POST /v1/emails` only means "accepted". Delivered means the drain
  ran: check `scripts/verify-delivery.sh` or the dashboard timeline.
- `/ready` returning 503 with `progress: degraded` after a deploy means the
  database, Redis or the email provider is not reachable from that deployment.

## SES/DNS sanity (read before anything SES-related)

Before enabling anything, prove the public DNS is coherent — SES verifies
records from its own resolvers, and "visible in my registrar panel" is NOT the
same as "visible to the internet" (learned 2026-09-21: records edited in the
Vercel DNS UI were invisible because the zone was actually delegated to
Cloudflare, and an MX target missing its FQDN got the zone name appended).

```bash
dig NS  calder.click +short                    # whose zone is SERVED? edit records THERE
dig MX  mail.calder.click +short               # must be exactly: 10 feedback-smtp.us-east-1.amazonses.com.
dig TXT mail.calder.click +short               # v=spf1 include:amazonses.com ~all
dig CNAME <dkim-token>._domainkey.calder.click +short   # one per SES token, 3 total
aws sesv2 get-email-identity --email-identity calder.click --region us-east-1 \
  --query '{dkim: DkimAttributes, mailFrom: MailFromAttributes}'
# dkim.SigningEnabled=true, dkim.Status=SUCCESS, mailFrom.MailFromDomainStatus=SUCCESS
```

Common traps: MX/CNAME targets typed without the full domain (zone name gets
appended → `feedback-smtp...amazonses.com.calder.click`); DKIM record names
must include `._domainkey`; AWS DKIM checks fail silently for days — the
AWS Health "AWS_SES_DKIM_FAILING" notice gives a 5-day re-add window.

## SES feedback wiring (SNS → /v1/ses/events)

Delivery truth (ADR-035) requires SNS to reach the API. This is the ONE piece
of the Phase 1 milestone that cannot be done from code — it is AWS console /
CLI work, done once per environment.

```bash
# 1. Create the SNS topic (one topic carries all SES event types)
aws sns create-topic --name calder-ses-events
# → arn:aws:sns:us-east-1:<account-id>:calder-ses-events

# 2. Set the topic allowlist on the API FIRST, deploy, THEN subscribe.
vercel env add SES_SNS_TOPIC_ARNS production \
  <<< "arn:aws:sns:us-east-1:<account-id>:calder-ses-events"
# (the endpoint refuses to auto-confirm subscriptions when unset — ADR-035 gate 3)

# 3. Subscribe the API endpoint (HTTPS, raw-message delivery off —
#    Calder expects the SNS envelope, it verifies the signature itself)
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:<account-id>:calder-ses-events \
  --protocol https \
  --notification-endpoint https://api.calder.click/v1/ses/events
# The API receives SubscriptionConfirmation, verifies its signature,
# and confirms automatically (log: "SNS subscription confirmed").

# 4. Create a configuration set that publishes everything to the topic
aws sesv2 create-configuration-set --configuration-set-name calder-default
aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name calder-default \
  --event-destination-name sns-all \
  --event-destination '{
    "Enabled": true,
    "MatchingEventTypes": ["SEND","DELIVERY","BOUNCE","COMPLAINT","OPEN","CLICK","REJECT","RENDERING_FAILURE"],
    "SnsDestination": {"TopicArn": "arn:aws:sns:us-east-1:<account-id>:calder-ses-events"}
  }'

# 5. Attach the configuration set to the sending identity.
#    NOTE: the identity is the DOMAIN (calder.click) — mail.calder.click is the
#    MAIL FROM subdomain, not an identity. If you verified individual addresses
#    (e.g. hello@calder.click), repeat for each address identity too.
aws sesv2 put-email-identity-configuration-set-attributes \
  --email-identity calder.click \
  --configuration-set-name calder-default

# 6. Tell the worker to send WITH the configuration set explicitly. The identity
#    default (step 5) is only a fallback; explicit ConfigurationSetName means
#    events keep flowing even for identities without a default assignment.
vercel env add SES_CONFIGURATION_SET production <<< "calder-default"
```

Verification (SES sandbox-safe): send to the simulator addresses, then check
`provider_events` and the email's status:

```bash
# hard bounce → status bounced + suppression row auto-created
aws sesv2 send-email --from-email-address hello@mail.calder.click \
  --destination ToAddresses=bounce@simulator.amazonses.com --content ... \
  --configuration-set-name calder-default
psql "$DATABASE_URL" -c \
  "select event_type, unmatched from provider_events order by created_at desc limit 3;"
```

Operational notes: SNS redelivers for ~1 hour on non-2xx, which is exactly
the desired behavior — Calder dedupes on the SNS MessageId, so replays are
no-ops. Unknown message ids (foreign SES accounts, manual tests) are ledgered
with `unmatched: true` and acknowledged; alerting on a sustained unmatched
rate > 20% suggests misconfiguration.

## Domains (owned: calder.click)

```
calder.click marketing
app.calder.click dashboard
api.calder.click public API
docs.calder.click documentation (when split from marketing)
status.calder.click status page (when split)
mail.calder.click reserved, future sending subdomain
```

Sub-`calder.com` hostnames in older docs/examples are placeholders from before
the purchase, treat any remaining reference as `calder.click` unless the
production domain decision changes again (recorded here if so).

Internal services never exposed publicly. A provider-generated URL (`calder.vercel.app`) is a preview address, never canonical product identity.

## OAuth setup (Google + GitHub, dev and prod)

Redirect URIs derive from `DASHBOARD_URL`, so each environment needs its own
registration. Do this once per provider per environment.

**Google Cloud Console** (one client covers both envs, Google allows many URIs):

1. APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized JavaScript origins: `http://localhost:3001`, `https://app.calder.click`.
3. Authorized redirect URIs (exact, no trailing slash):

- `http://localhost:3001/api/auth/callback/google`
- `https://app.calder.click/api/auth/callback/google`

4. Copy Client ID + Secret → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. While in Testing mode: add founder emails under Test users (unverified apps
   cap at 100 users and expire refresh tokens in 7 days, go Production/verified
   before launch). Requested scopes at runtime: `openid`, `profile`, `email`
   (login) and additionally `gmail.send` (Connect Gmail flow only).

**GitHub** (one OAuth App per environment, GitHub allows a single callback URL):

1. Settings → Developer settings → OAuth Apps → New OAuth App (dev), repeat for prod.
2. Dev: Homepage `http://localhost:3001`, callback
   `http://localhost:3001/api/auth/callback/github`.
3. Prod: Homepage `https://calder.click`, callback
   `https://app.calder.click/api/auth/callback/github`.
4. Copy Client ID + Secret → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
5. No special scopes needed for login (verified primary email is read by default).

**After either:** set `FOUNDER_EMAILS` to founder addresses, restart the
dashboard, sign in, org ownership grants automatically. Never commit these
values; rotate immediately on any leak.

## Production environment inventory

| App       | Required env                                                                                                                                                                           | Notes                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| dashboard | `DATABASE_URL` (Neon, pooled), `AUTH_SECRET` (32+ chars, generated), `AUTH_URL=https://app.calder.click`, `GOOGLE_*`, `GITHUB_*`, `FOUNDER_EMAILS`, `API_URL=https://api.calder.click` | `ALLOW_DEV_LOGIN` must be unset                      |
| api       | `DATABASE_URL`, `REDIS_URL` (`rediss://` Upstash), `AUTH_SECRET`, `AWS_*` (SES), `WEBHOOK_SIGNING_SECRET`, `ADMIN_API_KEY`                                                             | Migrations run before deploy (`drizzle-kit migrate`) |
| worker    | Same as api + `WORKER_CONCURRENCY`                                                                                                                                                     | Shares Redis + Postgres with api                     |
| web       | None required (static)                                                                                                                                                                 | Rebuild on copy changes                              |

Secrets live in the hosting provider's env store (Vercel env / container
secrets), never in the repo. Rotate `AUTH_SECRET` invalidates all sessions by
design, schedule rotations, don't surprise users.

## Performance targets (for design/motion decisions)

UI work (Lenis, scroll effects, imagery) must not regress core web vitals. Target: no meaningful LCP/CLS regression from any single visual feature, this is a hard constraint in `docs/DESIGN.md` §8, enforced here at deploy/CI level once performance budgets are defined.

## CI/CD (target)

Every PR: typecheck → lint → unit tests → integration tests → build → dependency check. Main: tests → build → deploy → migration → health check. PR lifecycle managed via `gh` CLI; deploys via `vercel` CLI, see `AGENTS.md`.

## To be filled in once decided

- [ ] Hosting provider for `api`/`worker` (Pxxl staging pilot pending)
- [x] Queue implementation → BullMQ over Redis-compatible store
- [ ] Redis provider → recommended Upstash (URL swap only), final call with hosting
- [x] DB client production posture → TLS outside localhost, pooler-safe, `DB_POOL_MAX`
- [ ] Migration execution strategy in CI/CD
- [ ] Rollback procedure
- [ ] Performance budget thresholds (LCP/CLS/bundle size)
