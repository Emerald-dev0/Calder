# Calder

Developer-first communication infrastructure. Transactional email is the first primitive.

> Application → Calder → User

## Status

Foundation scaffold complete (v0.1). API → queue → worker → provider → event vertical slice implemented with mock provider. See `PRD.md` for product scope, `docs/DECISIONS.md` for why things are built the way they are, `docs/DESIGN.md` for visual direction, `docs/CONTROL-PLANE.md` for the founder/admin Control Plane.

## Documentation map

Read in this order before touching code:

1. `PRD.md`, what Calder is, who it's for, what's in/out of scope
2. `ARCHITECTURE.md`, how the system is put together
3. `SECURITY.md`, required before touching auth, secrets, payments, or tenant isolation
4. `docs/DESIGN.md`, required before touching any UI, marketing surface, or dashboard visual work
5. `docs/DECISIONS.md`, why specific choices were made (don't "fix" these without reading first)
6. `AGENTS.md`, rules for AI coding agents working in this repo

## Project structure

```text
calder/
├── apps/
│ ├── web/ # marketing site, editorial/expressive
│ ├── dashboard/ # customer-facing app, precise/dense/functional
│ ├── api/ # public REST API
│ └── worker/ # async job processing (email sending, retries, cron)
├── packages/
│ ├── db/
│ ├── auth/
│ ├── config/
│ ├── email/
│ ├── providers/ # SES + future provider adapters
│ ├── queue/
│ ├── billing/ # Bachs adapter
│ ├── rate-limit/
│ ├── validation/
│ ├── observability/
│ └── ui/ # shared design system components
├── docs/
├── AGENTS.md
├── PRD.md
├── ARCHITECTURE.md
├── SECURITY.md
└── README.md
```

## Stack

Next.js, TypeScript, Tailwind (frontend) · Lenis (smooth scroll) · Hono (API) · PostgreSQL + Drizzle (database) · Redis-compatible store (cache/queue) · AWS SES (initial email provider) · Bachs (initial payment provider, pending validation)

## Tooling philosophy: CLI-first

Wherever a CLI exists for a tool Calder depends on, prefer it over the web dashboard, for humans and especially for AI agents, since it's scriptable, reviewable, and reproducible. See `AGENTS.md` § "CLI-first tooling" for the concrete rules and the list of CLIs in use (GitHub CLI, Vercel CLI, database/migration CLIs, etc.).

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infrastructure (PostgreSQL + Redis)
docker compose up -d

# 3. Copy environment config
cp .env.example .env

# 4. Run database migrations
pnpm db:generate
pnpm db:migrate

# 5. Start all services
pnpm dev
```

**Services:**

| Service          | URL                   | Description              |
| ---------------- | --------------------- | ------------------------ |
| `apps/web`       | http://localhost:3000 | Marketing site           |
| `apps/dashboard` | http://localhost:3001 | Customer dashboard       |
| `apps/api`       | http://localhost:3002 | REST API                 |
| `apps/worker`    | health :3003          | Background job processor |

**Infrastructure:**

| Service    | URL            |
| ---------- | -------------- |
| PostgreSQL | localhost:5432 |
| Redis      | localhost:6379 |

**Key commands:**

```bash
pnpm dev # Start all apps + worker
pnpm build # Build all packages + apps
pnpm lint # Lint all packages
pnpm typecheck # Type-check all packages
pnpm test # Run all tests
pnpm format # Format with Prettier
pnpm db:studio # Open Drizzle Studio
pnpm launch-check # Verify the confirmation-email path is launch-ready
```

## Git workflow & pull requests

**Branching**

- `main` is always deployable.
- Feature branches: `feat/<short-description>`, fixes: `fix/<short-description>`, chores: `chore/<short-description>`.
- No direct commits to `main`, everything goes through a PR, including agent-authored changes.

**Commits**

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `design:`.
- Squash-merge into a single commit on `main`.

**Pull requests**

- Opened and managed via `gh pr create` / `gh pr view` / `gh pr checks` (GitHub CLI) rather than the web UI where practical, see `AGENTS.md`.
- PR description states: what changed, why, and which doc (if any) it required updating.
- PRs touching the sending path confirm the sending-path checklist in `AGENTS.md`.
- PRs touching auth, secrets, payments, or tenant-scoped queries confirm the tenant-isolation invariant in `SECURITY.md`.
- PRs touching any visible UI include the visual QA evidence described in `docs/DESIGN.md` (before/after screenshots, self-assessment notes).
- CI must pass before merge. No exceptions for "quick fixes."
- At least one human review required before merge, including for AI-agent-authored PRs.

**PR template**

```
## What
## Why
## Docs updated? (PRD / ARCHITECTURE / SECURITY / DESIGN / DECISIONS / none)
## Sending-path checklist? (yes / n/a)
## Tenant-isolation checklist? (yes / n/a)
## Visual QA screenshots attached? (yes / n/a)
```

## Contributing

All schema changes go through migrations. All external providers sit behind an interface in `packages/providers`. All UI work follows `docs/DESIGN.md`, including the self-review loop before a PR is opened. See `AGENTS.md` for the full rule set.
