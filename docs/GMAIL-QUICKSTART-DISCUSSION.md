# Gmail quickstart and pricing

The beginner journey is to connect Gmail using Google OAuth, create a project
live API key, and request transactional mail through the same Calder API without
configuring Nodemailer or a custom sending domain. Google approval, production
configuration and a real Gmail delivery remain unverified; see
[Gmail Google verification](GMAIL-GOOGLE-VERIFICATION.md).

## Allowance and delivery behavior

The implementation reserves an account-level allowance atomically immediately
before calling Gmail's send endpoint. The first 24-hour period starts with the
first provider-bound send attempt, not connection: 20 attempts in that period,
then 100 per UTC calendar day. Attempts reaching Google count even if the call
fails or times out: Google may have accepted a timed-out message. A failure before
the Gmail request (e.g. token refresh) does not start the clock. This is a
conservative approximation of “first email sent”: an explicit Gmail rejection
can still start the clock. The Senders page shows the remaining allowance; other
organization/abuse/Google restrictions can apply, and the API's 202 means queued,
not necessarily sent. A cap rejection is recorded as a failed delivery.

The ledger is shared across projects for the same normalized Google email,
survives reconnects/project deletion, and counts each provider attempt including
retries. Google identity email changes are not linked across addresses. Account
hashes are retained for enforcement and may be linkable to an email address.
The historical backfill uses available sender/project attribution and message
creation time as an approximation, including all project Gmail transports when
there is no unique sender; deleted history cannot be reconstructed.

Gmail uses only `gmail.send` and Google identity scopes, rejects marketing-stream
mail, and never collects passwords. The same account's token is encrypted at rest.
Enforced limits and abuse watch do not replace Google's own restrictions or
verification. Test keys go through the mock provider, not Gmail.

Pricing alternatives remain under discussion: free Gmail quickstart, charging
for it, usage-based billing in NGN/USD, or prepaid email packs. No payment, plan
or entitlement changes are made here.
