# 04 — Risk register (email scope)

| ID | Risk | Likelihood | Impact | Finding | Mitigation | Gate |
|---|---|---|---|---|---|---|
| R-01 | Spammer signup burns shared SES reputation → throttling/suspension for all customers | High (no friction today) | Critical (AWS account-level) | ABUSE-001 | Abuse floor + kill-switch + daily review | 0 |
| R-02 | SMTP buyer converts, finds nothing to connect to → refund + reputation damage | High (advertised in-plan) | High | SMTP-001 | Relabel or build before any traffic | 0 |
| R-03 | DB loss / bad migration with no backup/restore/rollback | Medium | Critical | OPS-001 | PITR + drill + rollback runbook | 0 |
| R-04 | Paid-plan purchase impossible or silently broken (mock billing) | Certain (today) | High | BILL-001 | Early-access labels now; real rails before public | 1/2 |
| R-05 | Account takeover → spam cannon (no MFA, no notifications, long sessions) | Medium | High | AUTH-001/002 | MFA + notifications + session hardening | 1/2 |
| R-06 | Known-vulnerable deps exploited (48 vulns, 4 critical, no scan) | Medium | High | SEC-001 | CI scan + triage criticals | 1 |
| R-07 | Job loss on crash (InMemory default) → silent non-delivery | Medium | High | SEND-001 | Require REDIS_URL in staging/prod | 1 |
| R-08 | Bounce/complaint feedback never arrives (SNS unwired) → reputation blind | Medium | High | DOM-001a | Owner SNS wiring + dashboard guard | 1 |
| R-09 | Key expiry ignored / prefix confusion → stale access | Low | Medium | KEY-001/002 | Enforce expiry; slow-hash new keys | 1/2 |
| R-10 | Cross-project read via residual queries | Low (narrow, FK-guarded) | Medium | B-002 | Add predicates | 1 |
| R-11 | Deletion/export request arrives before runbook exists → legal exposure | Low | Medium | LEGAL-001 | Tested runbook + retention table | 2 |
| R-12 | Unit economics negative at full usage on some plan | Unknown (no math) | Medium | BILL-003 | Margin table with real inputs | 2 |
| R-13 | Competitor (esp. Sendly NG) ships Naira billing + SMS while Calder debates | Medium | Medium | 05 §1.11 | Ship email wedge fast; don't pre-announce channels | 2 |
| R-14 | Landing prototype diverges from shipped product (second false-claim cycle) | Medium | Medium | SITE-001/07 | Claim-gate: every prototype claim links to a REAL feature or "coming soon" label | 2 |
