# Deployment

Status: not finalized — placeholder pending decisions in `docs/DECISIONS.md` (queue implementation, Redis provider, final hosting).

## Environments

`development → staging → production`. Production data never reachable from local dev; test/live API keys enforce this as a second guard.

## Planned deployment shape

- `apps/web`, `apps/dashboard` — Vercel (or equivalent) for web-facing surfaces, deployed via the `vercel` CLI (see `AGENTS.md` CLI-first tooling)
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
- Database — managed PostgreSQL
- Queue/cache — managed Redis-compatible service

## Domains

```
calder.com              marketing
app.calder.com           dashboard
api.calder.com           public API
docs.calder.com          documentation
status.calder.com        status page
```

Internal services never exposed publicly. A provider-generated URL (`calder.vercel.app`) is a preview address, never canonical product identity.

## Performance targets (for design/motion decisions)

UI work (Lenis, scroll effects, imagery) must not regress core web vitals. Target: no meaningful LCP/CLS regression from any single visual feature — this is a hard constraint in `docs/DESIGN.md` §8, enforced here at deploy/CI level once performance budgets are defined.

## CI/CD (target)

Every PR: typecheck → lint → unit tests → integration tests → build → dependency check. Main: tests → build → deploy → migration → health check. PR lifecycle managed via `gh` CLI; deploys via `vercel` CLI — see `AGENTS.md`.

## To be filled in once decided

- [ ] Hosting provider for `api`/`worker`
- [ ] Queue implementation
- [ ] Redis provider
- [ ] Migration execution strategy in CI/CD
- [ ] Rollback procedure
- [ ] Performance budget thresholds (LCP/CLS/bundle size)
