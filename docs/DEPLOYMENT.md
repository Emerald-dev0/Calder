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

| Check             | Passes when                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| email provider    | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` present, provider is SES                               |
| SES account       | production access enabled, not sandbox (sandbox only mails verified recipients)                      |
| Calder sender     | `AUTH_EMAIL_FROM` set to a verified SES identity (defaults to `Calder <hello@calder.click>`)         |
| database          | reachable, migrations applied, internal tenant (`org_avenor` / `proj_website`) seeded                |
| waitlist template | dynamic confirmation template present (editable without a deploy)                                    |
| queue             | `REDIS_URL` set, so retries and delayed sends survive a restart                                      |
| delivery wake-up  | `CRON_SECRET` set, so a `202` leaves immediately instead of waiting for the scheduled drain          |
| admin access      | `ADMIN_API_KEY` set, so broadcasts and template edits work                                           |
| secrets           | `AUTH_SECRET` and `WEBHOOK_SIGNING_SECRET` are no longer development defaults                        |
| allowed origins   | `ALLOWED_ORIGINS` lists the first-party origins (`https://calder.click`, `https://app.calder.click`) |

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
