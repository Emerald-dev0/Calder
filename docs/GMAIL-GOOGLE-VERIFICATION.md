# Gmail sender: deployment and Google OAuth verification checklist

This is an operator checklist, not evidence of Google approval or a successful
production send. The code and local tests use simulated Google responses. Do not
invite general users until the real Google test and Google review succeed.

## 1. Deploy safely first

- Review the changes and CI; take a database backup and apply the migrations with
  `pnpm --filter @calder/db db:migrate` in the target environment, then check
  `pnpm --filter @calder/db db:status`. Migration 0033 conservatively attributes
  old Gmail sends when an account cannot be uniquely identified. Old emails use
  creation time as an approximation; history deleted before migration or tied to
  a deleted transport cannot be reconstructed. Check existing customers' history
  and contact support if that approximation is unacceptable before rollout.
- Deploy API, dashboard, web, and worker (if your deployment uses it) together.
  Set `DASHBOARD_URL` to `https://app.calder.click` for production, and set the
  same Google OAuth `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the dashboard
  and whichever processes actually deliver (API drain and/or worker). These are
  server-side environment variables, not `NEXT_PUBLIC_` variables. Keep the
  existing `AUTH_SECRET` identical where tokens are encrypted/decrypted; changing
  it without a migration makes stored credentials unreadable. Ensure the dashboard
  and API have the correct database, Redis, `API_URL`, and matched `CRON_SECRET`
  for the chosen deployment. Follow `docs/OPERATIONS.md`; verify `/ready` and
  delivery wake-ups. Do not paste secrets into a terminal recording or chat.
- No deployment was performed by this checklist. Verify the privacy and terms
  pages and homepage are publicly reachable, match the deployed behavior, and
  show a support email you actually monitor. Have someone review the privacy
  language, data retention/deletion process, and Google API policy compliance.

## 2. Google Cloud project and OAuth configuration

You do not need to create another Calder workspace/project merely to test: an existing
Calder project you can administer works. For isolated testing, Google policy calls
for a separate **Google Cloud project** for staging/development and a production
Cloud project for `app.calder.click`. You may reuse an existing production Google
Cloud project and OAuth web client if they are already configured correctly; do
not switch the existing production client to Testing or replace its credentials
without understanding the effect on existing Google sign-in. The review must use the production app and client. These
OAuth consent, audience, branding and verification controls are in Google Auth
Platform in Cloud Console; use the Console where review fields are interactive.
The Gmail API can be enabled with the CLI:

```sh
gcloud services enable gmail.googleapis.com --project YOUR_PROJECT_ID
```

1. Select the intended production Cloud project. Enable the **Gmail API** under
   APIs & Services → Library (or use the command above).
2. Under **Google Auth Platform → Branding**, enter Calder's real app name,
   monitored user-support email, developer contact, app homepage
   `https://calder.click`, privacy policy `https://calder.click/legal/privacy`,
   and terms `https://calder.click/legal/terms` if appropriate. Confirm these
   are the actual deployed URLs and that the homepage describes Gmail sending.
3. Verify domain ownership in Google Search Console with a Google account that
   has the required Cloud project access. Add the top-level authorized domain
   `calder.click` in Branding. Check every homepage, policy, origin and redirect
   domain Google lists; verify any other domains you actually use as well.
4. In **Audience**, choose **External** for a public product. For initial
   testing, add the Google accounts that will connect as test users. Google
   permits up to 100 test users in Testing; because `gmail.send` is requested,
   test grants/refresh tokens expire after seven days. They may need to reconnect.
   This is not public production approval.
5. In **Data Access**, declare exactly the scopes the deployed app uses. The
   Gmail connection requests:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/gmail.send`

   The existing Google sign-in flow uses the same configured client and may
   request additional identity scopes; inspect it and declare every actually
   requested scope. `gmail.send` is **sensitive**, not restricted. Do not add
   `gmail.readonly`, `gmail.modify`, `gmail.compose` or `mail.google.com` merely
   to send. Google will assess your use case and exact scope set.

6. In **Clients**, create/use an OAuth client of type **Web application**. Add
   these exact authorized redirect URIs using the _real_ `DASHBOARD_URL` origin:

   ```text
   https://app.calder.click/api/auth/gmail/callback
   https://app.calder.click/api/auth/callback/google
   ```

   The second is for the existing Google sign-in flow if enabled. If using a
   different client or domain in staging, configure that separately; do not add
   staging/local redirect URIs to the production client. Redirect URIs must
   match exactly, including scheme and path. Authorized JavaScript origins, if
   needed for other client flows, are origins without a path.

7. Store the client ID and secret securely in the deployment environment, not in
   Git or the video. Redeploy the relevant services. Never change `AUTH_SECRET`
   casually. Publishing the web/privacy changes is separate from changing Google
   Console settings.

## 3. Do a real test before recording

1. Sign into Calder as an owner/admin and open a project. On **Senders**, choose
   **Add Sender Identity → Connect Gmail On-Ramp → Connect Gmail with Google**
   (or use the onboarding Gmail step). Select an added Google test account and
   grant the requested permissions. Return to Calder and verify the connected
   sender. Reload Senders and inspect the allowance; initially 20 remain.
2. Create a **live**, send-capable Calder API key for that same project. A test
   key deliberately uses a mock provider and will not send through Gmail.
   Store the live key in a private environment variable, never print it.
3. Send an actual message to an inbox you control, substituting the connected
   sender and recipient. Run this from a server-side shell, not browser code:

   ```sh
   curl -sS https://api.calder.click/v1/emails \
     -H "Authorization: Bearer $CALDER_API_KEY" \
     -H 'Content-Type: application/json' \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"from":"YOUR-CONNECTED-ADDRESS@gmail.com","to":"YOUR-TEST-INBOX@example.com","subject":"Calder Gmail test","text":"Hello from Calder."}'
   ```

   Use your deployed API URL if different. HTTP 202 means _queued_, not delivered.
   Check the email log/status and actual recipient inbox (including spam), and
   confirm the visible sender and Calder footer. Refresh Senders and check the
   allowance decreased. Check retry, revocation/reconnection and error behavior
   on a test account. Gmail/organization limits can be lower than Calder's cap.

4. If sending fails, inspect sanitized logs/status, OAuth callback and scopes,
   enabled Gmail API, client credentials on the delivery service, Redis/queue and
   cron/wake-up health. Do not assume a 202 or mock test proves inbox delivery.

## 4. Record the review video

Google asks for a YouTube link. Record the real deployed production app and
production client in English, using test accounts and non-sensitive example
content. Google requires the end-to-end OAuth grant, the complete consent screen
in English, all scopes requested, and the feature using each sensitive scope;
show every OAuth client and flow in the project that requests reviewed scopes.
Check current Google review instructions before submitting.

Suggested continuous sequence:

1. Show the public Calder homepage and explain that the developer connects their
   own Gmail account to send low-volume application messages via Calder's API.
2. Sign in, select a project, open Senders, and click **Connect Gmail with
   Google**. Show the browser address bar on Google's consent screen including
   the OAuth client ID; show the full screen, exact requested permissions and
   the user's affirmative consent. Never expose the OAuth client secret, token,
   cookies or one-time authorization code. Do not edit away required consent
   steps. If previously authorized, revoke access to the test account first so
   the complete consent flow is visible.
3. Return to Calder and show the connected sender and usage/remaining allowance.
   Explain that the token is stored encrypted and Gmail access is send-only;
   Calder cannot read the inbox through `gmail.send`.
4. Show creating or selecting a project **live** API key without revealing its
   value. Send a message to an inbox you control via the API using a shell with
   the key held in an environment variable. Show the request body and 202, then
   the email log's eventual status, the received message, and the reduced
   allowance. A test-key/mock result is not a real Gmail demonstration.
5. Explain that sending begins when the customer requests an email; the provider
   attempt consumes allowance even if Google rejects it or the response is lost.
   Show where the user can revoke Calder's access in Google Account settings.
   Do not claim a dashboard disconnect feature unless it has been implemented.
6. If the same OAuth project has additional clients or sensitive-scope flows,
   demonstrate all of them as Google requests. Provide reviewer login/testing
   instructions through Google's verification process if the app requires an
   account; don't put passwords, keys or tokens into the video or this chat.

Upload to YouTube with reviewer-accessible visibility, then open the link in a
private browser to confirm Google can play it. Follow Google's current guidance
for English, consent-screen scopes, URL/client-ID visibility and reviewer access.

## 5. Submit and monitor

- In Google Auth Platform, complete branding verification and publish approved
  branding when prompted. Then follow the Verification Center/Data Access flow.
  Google says production projects must be published before scope verification;
  publishing is not the same as receiving scope approval. Users may see an
  unverified-app warning or caps before approval.
- Scope justification draft, adapt to the actual deployed app: “Calder is an
  email API for developers. A user explicitly connects their own Google account
  so Calder can send application-requested transactional messages as that Gmail
  address using the Gmail API. We request `gmail.send` solely to send those
  messages; we do not request inbox read/modify access. We use the verified Google
  email identity to identify the sender and an encrypted refresh token to send
  asynchronously.” Submit the video URL and requested reviewer access details.
- Google quotes approximately 10 business days for sensitive-scope verification,
  not a guarantee. Respond to reviewer requests and re-record if requested. Only
  describe the feature as publicly available after approval and a fresh real
  production connect/send/inbox test.

## References

- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://support.google.com/cloud/answer/13464321?hl=en
- https://support.google.com/cloud/answer/13461325?hl=en
- https://support.google.com/cloud/answer/15549945?hl=en
- https://support.google.com/cloud/answer/13463817?hl=en

## Vercel project mapping and safe setup order

The connected Vercel account lists `calder-web`, `calder-dashboard`, and
`calder-api`. They are separate projects. The dashboard already has Google
client environment-variable names configured in production; their values and
whether they are the correct Cloud client have not been checked. Do not replace
an existing Google sign-in client blindly: changing the dashboard client may
interrupt sign-in and invalidate existing refresh tokens. Make a rollback plan,
confirm the OAuth client and current sign-in callback, and preserve access to
existing production settings without printing or sharing secrets.

1. First create a separate staging setup with its own Google Cloud project,
   OAuth client, test users, database and Redis. Give it a stable HTTPS dashboard
   URL you control and its own matching callback URI. Do **not** point a staging
   test at the production database. The production callback above is only for
   the deployed production dashboard.
2. For each staging delivery process and dashboard, configure the staging
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, stable `DASHBOARD_URL`, and a
   matching staging `AUTH_SECRET`. Configure the existing staging `DATABASE_URL`,
   `REDIS_URL`, `API_URL`, and `CRON_SECRET` according to operations docs; don't
   copy production secrets into staging. Set the Vercel environment scope
   deliberately (Preview vs Production). A Vercel preview URL is not stable
   unless you assign a stable owned domain; Google's callback must match exactly.
3. Apply migrations to the isolated staging database and deploy the PR. Run the
   real Google test and inspect the inbox, as above. The local tests in the PR
   used simulated Google responses, not a Google account.
4. Only after review, backup and migration, configure the **production**
   dashboard and API with the production Google OAuth client. The existing
   production `AUTH_SECRET` must remain unchanged and match between services
   that encrypt/decrypt Gmail credentials. Never run production migrations
   against an unknown URL. If a separate worker is deployed outside Vercel,
   configure it there too; this checklist does not assume one exists.
5. Merge and confirm Vercel production deployments for `calder-web`,
   `calder-dashboard`, and `calder-api` reach Ready and are aliased to the
   expected domains. Vercel environment changes only apply to new deployments;
   coordinate their rollout with the schema migration. Then run the real test
   with an authorized account and monitor delivery status.

`gcloud` can create a Google Cloud project and enable the Gmail API, but OAuth
client credentials, branding, tester enrollment and verification still need
Google Auth Platform setup. The CLI is not installed in this workspace and no
Google Cloud account is connected here. Run these on your own authenticated
machine if you choose the CLI route, substituting a unique project ID:

```sh
gcloud projects create YOUR_UNIQUE_TEST_PROJECT_ID --name="Calder Gmail Test"
gcloud services enable gmail.googleapis.com --project=YOUR_UNIQUE_TEST_PROJECT_ID
```

Creating a Cloud project may require organization permissions and billing setup;
Google's current requirements apply. Never share OAuth client secrets here.
