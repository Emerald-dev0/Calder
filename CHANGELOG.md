# Changelog

Selected changes reconstructed from the GitHub `main` commit history through
`d16774cae8` (October 28, 2026), reviewed October 29. This is a curated history,
not a claim that every implemented feature is configured or available in production.
No release tags or semantic versions are invented. See [launch availability](docs/LAUNCH-STATUS.md).

## Unreleased — this PR (#87)

- Fix dashboard/API automatic drain wake-up lifecycle. Requires API and dashboard
  configuration, redeployment and a hosted no-manual-drain delivery test.
- Patch transitive Zod used by Vercel CLI configuration; keep the high/critical audit gate.
- Hide the paid plan catalogue/upgrade offers from Usage, retain actual quota enforcement,
  correct provider-accepted wording and document unverified SDK distribution/billing.

## 2026-10-28 — Production API packaging and diagnostics

- Added a tracked Vercel function entry so discovery no longer depends on a generated file.
- Embedded the OpenAPI document in the serverless bundle to fix cold-start failures when the source JSON is absent.
- Improved readiness/deploy verification and provider failure diagnostics. Liveness, dependency readiness, provider acceptance and inbox delivery remain distinct.

Evidence: [`d16774cae8`](https://github.com/Emerald-dev0/Calder/commit/d16774cae8), [`646b4fe52b`](https://github.com/Emerald-dev0/Calder/commit/646b4fe52b), [`277db97caf`](https://github.com/Emerald-dev0/Calder/commit/277db97caf), [`35b54cd0cb`](https://github.com/Emerald-dev0/Calder/commit/35b54cd0cb), [`faa5cf1e3c`](https://github.com/Emerald-dev0/Calder/commit/faa5cf1e3c).

## 2026-10-27 — Configuration, schema and dependency repairs

- Upgraded first-party Zod usage to the patched v4 release and corrected organization-profile schema gaps.
- Updated CSP and the five-tier configuration catalogue. A catalogue entry is not an active payment subscription.

Evidence: [`2c829ec627`](https://github.com/Emerald-dev0/Calder/commit/2c829ec627), [`2833ed1c02`](https://github.com/Emerald-dev0/Calder/commit/2833ed1c02), [`b27c0e9cf8`](https://github.com/Emerald-dev0/Calder/commit/b27c0e9cf8).

## 2026-10-26 — Source integrity and migration checks

- Added source/history integrity scans, pinned CI actions, schema-coverage checks and review ownership for sensitive paths.
- Repaired migration generation/build prerequisites and strengthened post-deploy verification.

Evidence: [`9f6d2e6607`](https://github.com/Emerald-dev0/Calder/commit/9f6d2e6607), [`017c77513c`](https://github.com/Emerald-dev0/Calder/commit/017c77513c), [`834ed4695f`](https://github.com/Emerald-dev0/Calder/commit/834ed4695f), [`d184451fa8`](https://github.com/Emerald-dev0/Calder/commit/d184451fa8), [`04624db2e0`](https://github.com/Emerald-dev0/Calder/commit/04624db2e0).

## 2026-10-22–23 — Sender, message and marketing foundations

- Added plan-limited sender identities, message filters/detail/resend/CSV export and reason-aware suppression controls.
- Implemented audience consent/history and broadcast/reporting code plus company-email/control tooling. Marketing production rollout remains unverified and publicly marked in development.

Evidence: [`61e8243528`](https://github.com/Emerald-dev0/Calder/commit/61e8243528), [`de73b8d33c`](https://github.com/Emerald-dev0/Calder/commit/de73b8d33c), [`de588d88fa`](https://github.com/Emerald-dev0/Calder/commit/de588d88fa), [`1681c15734`](https://github.com/Emerald-dev0/Calder/commit/1681c15734), [`311a459d54`](https://github.com/Emerald-dev0/Calder/commit/311a459d54), [`995c4247f4`](https://github.com/Emerald-dev0/Calder/commit/995c4247f4).

## 2026-10-03–19 — Abuse controls and operational hardening

- Added sending safeguards, operational checks and dashboard improvements; corrected simulated-send and provider-accepted-versus-delivered wording.
- Added SES stream configuration/setup tooling and stuck-message detection. Provider-event and infrastructure configuration still require deployment validation.

Evidence: [`542c73670c`](https://github.com/Emerald-dev0/Calder/commit/542c73670c), [`2da0af47ec`](https://github.com/Emerald-dev0/Calder/commit/2da0af47ec), [`21daba66e3`](https://github.com/Emerald-dev0/Calder/commit/21daba66e3), [`63e76482fe`](https://github.com/Emerald-dev0/Calder/commit/63e76482fe), [`c01301f601`](https://github.com/Emerald-dev0/Calder/commit/c01301f601), [`137da8c3b6`](https://github.com/Emerald-dev0/Calder/commit/137da8c3b6).

## 2026-09-25–30 — Delivery correctness and SDK source

- Added transactional/marketing stream separation, safer SES retry classification and delivery-path tests.
- Authored SDK source and corrected API response-envelope handling. This records source implementation, not registry publication or a production SDK support commitment.
- Fixed test-mode sender tests and strengthened auth/schema migration handling.

Evidence: [`f70c11907e`](https://github.com/Emerald-dev0/Calder/commit/f70c11907e), [`124290b4ba`](https://github.com/Emerald-dev0/Calder/commit/124290b4ba), [`25ce1bd368`](https://github.com/Emerald-dev0/Calder/commit/25ce1bd368), [`ffa9d22a43`](https://github.com/Emerald-dev0/Calder/commit/ffa9d22a43), [`743d61c882`](https://github.com/Emerald-dev0/Calder/commit/743d61c882), [`462a8c9b9a`](https://github.com/Emerald-dev0/Calder/commit/462a8c9b9a).

## 2026-09-09–19 — Dashboard and control-plane expansion

- Added team invites, organization/project controls and founder/admin operational views.
- Expanded dashboard message, template and delivery data views and documented the production-readiness roadmap.

Evidence: [`63c3bca85c`](https://github.com/Emerald-dev0/Calder/commit/63c3bca85c), [`d2a9977134`](https://github.com/Emerald-dev0/Calder/commit/d2a9977134), [`c0bbc98c93`](https://github.com/Emerald-dev0/Calder/commit/c0bbc98c93), [`f0a01ad133`](https://github.com/Emerald-dev0/Calder/commit/f0a01ad133).

## 2026-09-06–08 — Foundation and first pipeline

- Created the monorepo and public site, rebranded Avenor to Calder, and added onboarding, domain/key/usage dashboard pages and Redis delivery foundations.
- Documented an SMTP gateway program; this did not deploy a public SMTP service.

Evidence: [`53c3c5714b`](https://github.com/Emerald-dev0/Calder/commit/53c3c5714b), [`a3eb44b529`](https://github.com/Emerald-dev0/Calder/commit/a3eb44b529), [`7367a7f3eb`](https://github.com/Emerald-dev0/Calder/commit/7367a7f3eb), [`9c3b1635da`](https://github.com/Emerald-dev0/Calder/commit/9c3b1635da), [`be8be5acd7`](https://github.com/Emerald-dev0/Calder/commit/be8be5acd7), [`9b6964e29e`](https://github.com/Emerald-dev0/Calder/commit/9b6964e29e).
