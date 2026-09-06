# Avenor — Security

Read before touching authentication, authorization, secrets, payments, email sending, or tenant isolation.

## 1. What Avenor handles

Credentials, email addresses, domains, application data, potentially email content, billing information. Treat all of it as sensitive by default.

## 2. Secrets

No raw secret keys stored — API keys hashed at rest, only a prefix kept for identification. Webhook signing secrets and payment credentials never logged or exposed to clients. Managed through dedicated secret management, never hardcoded or committed. This includes CLI credentials (`gh auth`, `vercel login`, database connection strings) — see `AGENTS.md` CLI-first tooling.

## 3. API keys

`test`/`live`, cryptographically distinct, scoped to environment. Creation/last-used timestamps, revocation, rotation supported. Fine-grained permissions are future work.

## 4. Authentication & authorization

Standard, non-custom session/token mechanisms. Every data access scoped by organization/project at the data-access layer, not only route guards.

## 5. Tenant isolation

**A request in one organization must never read, modify, or infer the existence of another organization's resources.** Any new query or endpoint is reviewed against this before merging.

## 6. Webhooks

Outgoing webhooks are signed. Incoming webhooks (payment/email provider) are verified before being trusted, never processed on shape alone.

## 7. Abuse prevention

Mandatory. New accounts progress: limited sending → domain verification → reputation checks → full production sending. Continuously monitor bounce rate, complaint rate, sending velocity, account behavior — Avenor's own SES reputation depends on this.

## 8. Input handling

All external input validated at the API boundary. Output encoding wherever user-controlled content could render as HTML (dashboard, email previews).

## 9. Transport & headers

Encrypted transport everywhere. Standard security headers on all web-facing surfaces.

## 10. Dependencies

Dependency scanning in CI. No dependency added without stated justification (see `AGENTS.md`).

## 11. Audit logs

Immutable-from-UI records for: `organization.created`, `member.invited`, `api_key.created`, `api_key.revoked`, `domain.added`, `domain.verified`, `template.published`, `subscription.changed`, `project.created`.

## 12. Visual QA tooling — security note

Screenshot/preview tooling used for the `docs/DESIGN.md` visual QA loop must run against local or staging environments only, and must never capture or embed real customer data, live API keys, or production email content in a screenshot that gets attached to a PR.

## 13. Incident posture

Not yet formalized. Disaster recovery (backups, RPO/RTO, restoration) must be implemented and _tested_ before being described as supported.
