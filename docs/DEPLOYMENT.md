# Deployment

Status: not finalized — placeholder pending decisions in `docs/DECISIONS.md` (queue implementation, Redis provider, final hosting).

## Environments

`development → staging → production`. Production data never reachable from local dev; test/live API keys enforce this as a second guard.

## Planned deployment shape

- `apps/web`, `apps/dashboard` — Vercel (or equivalent) for web-facing surfaces, deployed via the `vercel` CLI (see `AGENTS.md` CLI-first tooling)
- `apps/api`, `apps/worker` — managed infra, provider TBD, must remain portable
- Database — managed PostgreSQL
- Queue/cache — managed Redis-compatible service

## Domains

```
avenor.com              marketing
app.avenor.com           dashboard
api.avenor.com           public API
docs.avenor.com          documentation
status.avenor.com        status page
```

Internal services never exposed publicly. A provider-generated URL (`avenor.vercel.app`) is a preview address, never canonical product identity.

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
