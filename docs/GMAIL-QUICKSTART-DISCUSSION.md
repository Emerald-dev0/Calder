# Gmail quickstart and pricing

The beginner journey is to connect Gmail using Google OAuth, create a project
live API key, and request transactional mail through the same Calder API without
configuring Nodemailer or a custom sending domain. Google approval, production
configuration and a real Gmail delivery remain unverified; see
[Gmail Google verification](GMAIL-GOOGLE-VERIFICATION.md).

## Allowance and delivery behavior

The first 24-hour period starts when Gmail first confirms acceptance of a
message: up to 20 sends in that period, then 100 per UTC calendar day. Google
acceptance is not proof the message reached the inbox. Capacity is reserved
before each provider call to enforce caps under concurrency. A definite client
rejection releases its reservation; network errors, 408s, 5xx responses or a
process crash can be ambiguous and remain reserved, potentially requiring
operator investigation. They cannot start the clock without confirmed acceptance.
The dashboard shows remaining capacity, including reservations. Other
organization/abuse/Google limits may apply, and API 202 means queued.

The ledger is shared across projects for the same normalized Google email and
survives reconnects/project deletion. A changed Google identity email is not
linked across addresses. Hashes are retained for enforcement and may be linkable
to an email address. Historical backfill uses available attribution and message
creation time as an approximation; deleted history cannot be reconstructed.

Gmail uses only `gmail.send` and Google identity scopes, rejects marketing-stream
mail, and never collects passwords. The same account's token is encrypted at rest.
Enforced limits and abuse watch do not replace Google's own restrictions or
verification. Test keys go through the mock provider, not Gmail.

Pricing alternatives remain under discussion: free Gmail quickstart, charging
for it, usage-based billing in NGN/USD, or prepaid email packs. No payment, plan
or entitlement changes are made here.
