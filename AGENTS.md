# Calder — AI Agent Instructions

This file governs how AI coding agents (Claude Code, Codex, OpenCode, etc.) must operate in this repository. It is authoritative for _behavior_. It is not authoritative for _product scope_ (`PRD.md`), _system design_ (`ARCHITECTURE.md`), _security requirements_ (`SECURITY.md`), or _visual direction_ (`docs/DESIGN.md`) — read those first when relevant to the task.

## Before changing code

1. Read this file in full.
2. Read `PRD.md` if the task touches product behavior, scope, or pricing.
3. Read `ARCHITECTURE.md` before changing anything crossing a service/package boundary.
4. Read `SECURITY.md` before touching authentication, authorization, secrets, payments, email sending, or tenant isolation.
5. Read `docs/DESIGN.md` before touching any visible UI — marketing site, dashboard, emails, or shared components.
6. Read `docs/DECISIONS.md` before changing anything that looks like a deliberate past choice. If a past decision seems wrong, flag it — don't silently reverse it.

## When documents conflict

**Do not guess. Stop and identify the conflict explicitly.** Surface it to the human rather than picking whichever document is more convenient.

## Non-negotiable rules

- Do not invent APIs, endpoints, or infrastructure behavior not described in `PRD.md` or `ARCHITECTURE.md`.
- Do not introduce a new dependency without stating why an existing one can't do the job.
- Do not bypass existing abstractions.
- Do not put business logic inside UI components.
- Do not access the database directly from frontend applications.
- All asynchronous delivery work goes through the queue/worker architecture — never synchronously from an API handler.
- All external providers (email, payments, hosting-verification) sit behind a provider abstraction.
- Never expose secrets to clients. Never log raw API keys or webhook signing secrets.
- Every production-critical operation must be observable.
- Preserve multi-tenant isolation on every new query, not just at auth middleware.
- All schema changes go through migrations.
- Mutating operations that could cause harm if duplicated must support idempotency keys.
- Write tests for meaningful business logic.
- Update documentation only when behavior actually changes.
- Don't duplicate an existing service or package without reading the existing pattern first.
- Don't create a new microservice without citing which trigger in `ARCHITECTURE.md` §14 justifies it — "it felt cleaner" is not sufficient.
- Don't optimize for imaginary scale.

## Documentation evolution (permanent rule)

Whenever a meaningful product capability, architecture decision, pricing model, API behavior, branding decision, infrastructure change, or product direction changes:

1. update the authoritative relevant documentation;
2. update PRD/roadmap when scope changes;
3. update architecture documentation when architecture changes;
4. update API docs when behavior changes;
5. update landing-page copy when the product promise changes;
6. add significant decisions to `docs/DECISIONS.md`.

Documentation must evolve with the product. A capability merged without its docs is unfinished work, not velocity.

## CLI-first tooling

Wherever a CLI exists for a tool or platform Calder depends on, prefer it over clicking through a web dashboard — this applies to agents and humans alike. CLIs are scriptable, diffable, reviewable in a PR description, and reproducible in CI. A web-dashboard action leaves no trace an agent (or a teammate) can audit later.

Concretely:

- **GitHub** — use `gh` (GitHub CLI) for PRs, issues, releases, and repo config: `gh pr create`, `gh pr view`, `gh pr checks`, `gh issue create`, `gh release create`, `gh repo view`. Don't describe "go open a PR on GitHub.com" as a step if `gh` can do it.
- **Vercel** — use `vercel` CLI for deployments, environment variable management, and project linking: `vercel`, `vercel --prod`, `vercel env add`, `vercel link`, `vercel logs`. Especially relevant once the Vercel hosted-domain verification feature (ADR-005) is in development — the agent should already be fluent in the Vercel CLI's project/domain surface before building against it.
- **Database** — use the Drizzle CLI (`drizzle-kit generate`, `drizzle-kit migrate`) for schema changes, never hand-written ad-hoc SQL against a live database.
- **Payments (Bachs)** — use Bachs' CLI or API tooling if one exists once integration begins; if only a dashboard exists, document that gap explicitly in `docs/DECISIONS.md` rather than treating manual dashboard steps as normal workflow.
- **Package management** — `pnpm` for all install/workspace operations (matches the monorepo setup in `README.md`).
- **General rule** — if you catch yourself about to write "log into the dashboard and click X," stop and check whether a CLI/API equivalent exists first. If it genuinely doesn't, say so explicitly rather than silently defaulting to manual steps.

Any credentials a CLI needs (`gh auth`, `vercel login`, database connection strings) follow the same rule as everything else in `SECURITY.md` — never hardcoded, never logged, never committed.

## Git & PR conventions for agents

- Never commit directly to `main`. Always open a PR from `feat/...`, `fix/...`, or `chore/...`, using `gh pr create` per the CLI-first rule above.
- Fill in the PR template in `README.md`, including which docs were updated (or explicitly note none needed updating).
- Do not merge your own PR — flag for human review even if CI passes (`gh pr checks` to confirm CI status, but merging is a human decision).
- If the change touches the sending path or tenant-scoped data, run the relevant checklist and paste the result into the PR description.
- If the change touches visible UI, attach the visual QA evidence described below before opening the PR.
- Keep PRs scoped to one logical change.

## Definition of done for any change touching the sending path

- [ ] Runs through the queue, not inline in the request handler
- [ ] Idempotency key respected
- [ ] Retry/backoff behavior matches `ARCHITECTURE.md`
- [ ] Suppression list checked before send
- [ ] Rate limits apply at the correct dimension
- [ ] Relevant email event(s) recorded and webhook(s) fired
- [ ] Failure path produces a diagnosable error, not a silent drop

## Visual QA loop — required for any UI-visible change

Calder's design bar is defined in `docs/DESIGN.md` ("Editorial Infrastructure"). An agent must never assume code that compiles is code that looks right. Before opening a PR that touches marketing pages, the dashboard, shared UI components, or email templates:

1. **Render it.** Run the app locally or in a Vercel preview deployment (`vercel` CLI — see CLI-first tooling above).
2. **Screenshot it.** Capture the actual rendered state — not a description of it — at minimum at desktop (1440px) and mobile (390px) widths. Capture any interactive/motion states that materially changed (hover, scroll-triggered reveal, loading, empty state).
3. **Self-review against the checklist in `docs/DESIGN.md` §9** (typography, color restraint, spacing, motion purpose, generic-SaaS smell test).
4. **Check color intensity specifically.** Compare the screenshot against the palette rules in `docs/DESIGN.md` §3. If any element reads as louder, more saturated, or more "AI-startup-purple-gradient" than the reference palette implies — even if the hex value is technically correct — reduce hue, saturation, or lightness until it matches the restrained, editorial feel. Don't rely on the raw token value alone; judge the rendered pixels.
5. **Iterate at least once.** If the first screenshot doesn't clearly satisfy the checklist, adjust and re-screenshot before proceeding. Don't submit the first render as final by default.
6. **Attach evidence.** Include the screenshot(s) — before/after if this is a revision — and a short written self-assessment (what you checked, what you adjusted, what you're unsure about) in the PR description.
7. **When genuinely unsure**, flag the specific uncertainty in the PR rather than guessing confidently — e.g. "accent color may still be too saturated in the hero on mobile, wasn't sure whether to pull it down further without a second reference point."

This loop applies even to small changes (a button state, a spacing tweak) — the bar is "does this actually look like Calder," not "does this match the spec on paper."
