# Founder workflows — local QA, October 29, 2026

## Main evidence: `authenticated/`

18 screenshots: nine actual Next.js views at 1440px and 390px. Metrics,
activation, support search, incident list/detail, role administration, billing,
organization list and maintenance. Screenshots contain synthetic `example.invalid`
accounts in an isolated local PostgreSQL database, not customer or production data.

Founder/support sessions were provisioned using the real auth package session and
sealed-cookie helpers. The pages, authorization guards, Next server actions and
Postgres persistence were real. The final captures use the optimized production
build with isolated local PostgreSQL and Redis. This does **not** test password
login, external providers, hosted Redis availability/failover or hosted deployment.

Browser checks passed for actual incident creation and identified → monitoring →
resolved updates; an actual founder role form with reason/acknowledgment persisted
a role change (analyst in the development run, support in the final production-build run); the Metrics GET environment filter; support access allowed to its
workspace and denied to administration/incidents; an explicit cross-origin auth
POST rejected with 403; unauthenticated incident access redirected to login.
No browser page errors or document-level horizontal overflow in the captured views.
Wide informational tables may scroll inside their panels.

## Visual iteration

Paper/Ink with restrained cobalt, clear operational scope labels and a single
main landmark. Reviewing the first authenticated mobile administration capture
showed the role action stranded offscreen in a wide table. Candidate management
was changed to responsive identity/role/action cards; final authenticated captures
were regenerated. Current-account and other wide data tables still scroll locally.

Real-browser testing exposed the existing development CSP blocking Next hydration.
Evaluation permission is now development-only, with three header regression tests
checking development/test/production and retaining production HSTS/CSP restrictions.
Next configuration now externalizes the observability package to keep dynamic
Pino worker paths out of bundled chunks. The final production-build runtime was
clean; a fresh development-only pretty-printer transport run was not separately certified.

## Supplementary evidence and limits

The 18 PNGs at this directory's root are earlier **view-only SSR fixtures**, with
synthetic disclosure and submissions prevented. They do not prove actions, auth
or final mobile role layout; prefer `authenticated/`.

The final optimized-build route scan passed **55/55 static control routes**, with
HTTP 200, actual headings and no error-boundary views; see `route-audit.json`.
Earlier development scans had cold-render timeouts and one memory-triggered dev
restart. The first production-build scan exposed the Communications/Audiences raw
Date binding failure; the ISO/timestamptz repair now has a real Postgres regression
test and both routes passed the final scan. Action checks wait for each POST/RSC
transition to settle before the next submission; incident updates redirect back
to the authoritative detail view.
Dynamic incident detail is covered above; arbitrary dynamic customer/detail routes
are not all covered by the static scan. Local checks are not production certification.

Signup remains open. Production incident routes require migration
`0032_special_logan`; no migration was run against production. Private incidents
send no notifications and are not public status-page publication. Shared global
pause, step-up auth, alert routing and hosted delivery proof remain outstanding.
