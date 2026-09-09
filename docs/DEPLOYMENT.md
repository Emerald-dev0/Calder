# Deployment

Status: launch track active — queue (BullMQ), DB client (TLS + pooler-safe), and
cookie hardening are implemented; providers/hosting below are decided unless
marked otherwise.

## Environments

`development → staging → production`. Production data never reachable from local dev; test/live API keys enforce this as a second guard.

## Planned deployment shape

- `apps/web`, `apps/dashboard` — Vercel (or equivalent) for web-facing surfaces, deployed via the `vercel` CLI (see `AGENTS.md` CLI-first tooling).
  Monorepo wiring: **one Vercel project per app**. When importing, set the
  **Root Directory** to `apps/web` for the marketing site and `apps/dashboard`
  for the app (framework preset: Next.js; build command and output left as
  Vercel defaults). Connect both projects to the same GitHub repo (`Calder`);
  production branches deploy `main`, previews deploy PRs. Environment variables
  are set per project (see inventory below) — never shared blindly between web
  and dashboard.
- `apps/api`, `apps/worker` — managed infra, provider TBD, must remain portable.
  Staging candidate: Pxxl (Nigerian, Africa-first deploy platform — GitHub-push
  deploys, managed databases, custom domains, NGN-friendly pricing). Pilot
  staging there first; production only after observed uptime justifies it —
  their stated 98.9% (~3.3 days/yr downtime) is not yet infrastructure-grade,
  and our status promises must exceed our host's. Frontend stays Vercel unless
  Pxxl proves equal or better. Cloudflare free tier adopted for: our own DNS
  (fast TXT management for verification/SPF/DKIM/DMARC), recommended customer
  DNS, and Email Routing for our inbound (support@, hello@). Cloudflare does
  not send mail — delivery stays SES; sending from dedicated subdomains
  (e.g. mail.&lt;domain&gt;) protects root-domain reputation. Note: Email
  Routing requires Cloudflare nameservers, is forwarding-only (not mailboxes),
  and pairs with Gmail Send-As for a $0 professional setup.
- Database — managed PostgreSQL. Recommended: **Neon** (serverless, branching
  for preview DBs, free tier; Supabase only if auth/storage extras are ever
  wanted — they aren't). Client enforces TLS outside localhost, disables
  prepared statements for pooler compatibility, pool via `DB_POOL_MAX`
  (default 10 — lower per-instance on serverless).
- Queue/cache — managed Redis-compatible service. Recommended: **Upstash**
  (TLS `rediss://` URL swap only — no code changes; BullMQ options already
  compatible). Never a second source of truth.

## Domains (owned: calder.click)

```
calder.click            marketing
app.calder.click        dashboard
api.calder.click        public API
docs.calder.click       documentation (when split from marketing)
status.calder.click     status page (when split)
mail.calder.click       reserved — future sending subdomain
```

Sub-`calder.com` hostnames in older docs/examples are placeholders from before
the purchase — treat any remaining reference as `calder.click` unless the
production domain decision changes again (recorded here if so).

Internal services never exposed publicly. A provider-generated URL (`calder.vercel.app`) is a preview address, never canonical product identity.

## OAuth setup (Google + GitHub, dev and prod)

Redirect URIs derive from `DASHBOARD_URL`, so each environment needs its own
registration. Do this once per provider per environment.

**Google Cloud Console** (one client covers both envs — Google allows many URIs):

1. APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized JavaScript origins: `http://localhost:3001`, `https://app.calder.click`.
3. Authorized redirect URIs (exact, no trailing slash):
   - `http://localhost:3001/api/auth/callback/google`
   - `https://app.calder.click/api/auth/callback/google`
4. Copy Client ID + Secret → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. While in Testing mode: add founder emails under Test users (unverified apps
   cap at 100 users and expire refresh tokens in 7 days — go Production/verified
   before launch). Requested scopes at runtime: `openid`, `profile`, `email`
   (login) and additionally `gmail.send` (Connect Gmail flow only).

**GitHub** (one OAuth App per environment — GitHub allows a single callback URL):

1. Settings → Developer settings → OAuth Apps → New OAuth App (dev), repeat for prod.
2. Dev: Homepage `http://localhost:3001`, callback
   `http://localhost:3001/api/auth/callback/github`.
3. Prod: Homepage `https://calder.click`, callback
   `https://app.calder.click/api/auth/callback/github`.
4. Copy Client ID + Secret → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
5. No special scopes needed for login (verified primary email is read by default).

**After either:** set `FOUNDER_EMAILS` to founder addresses, restart the
dashboard, sign in — org ownership grants automatically. Never commit these
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
design — schedule rotations, don't surprise users.

## Performance targets (for design/motion decisions)

UI work (Lenis, scroll effects, imagery) must not regress core web vitals. Target: no meaningful LCP/CLS regression from any single visual feature — this is a hard constraint in `docs/DESIGN.md` §8, enforced here at deploy/CI level once performance budgets are defined.

## CI/CD (target)

Every PR: typecheck → lint → unit tests → integration tests → build → dependency check. Main: tests → build → deploy → migration → health check. PR lifecycle managed via `gh` CLI; deploys via `vercel` CLI — see `AGENTS.md`.

## To be filled in once decided

- [ ] Hosting provider for `api`/`worker` (Pxxl staging pilot pending)
- [x] Queue implementation → BullMQ over Redis-compatible store
- [ ] Redis provider → recommended Upstash (URL swap only), final call with hosting
- [x] DB client production posture → TLS outside localhost, pooler-safe, `DB_POOL_MAX`
- [ ] Migration execution strategy in CI/CD
- [ ] Rollback procedure
- [ ] Performance budget thresholds (LCP/CLS/bundle size)
