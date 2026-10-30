import Link from "next/link";

export const metadata = {
  alternates: { canonical: "https://calder.click/docs/availability" },
  title: "Launch Availability, Calder Docs",
  description:
    "Current Calder service availability and launch limitations for sending, Gmail, SMTP, SDKs and billing.",
};

export default function Availability() {
  return (
    <>
      <h1>Launch availability</h1>
      <p className="docs-lede">
        What is implemented is not always what is configured in Production.
      </p>
      <h2>Start with the REST API</h2>
      <p>
        The sending API, test/live keys, sender/domain setup, message history, templates,
        suppression controls, usage limits and webhook code are implemented. A production health
        response and two manually drained emails reaching an inbox were confirmed by the operator on
        October 28, 2026. That is evidence of those requests, not a reliability SLA.
      </p>
      <p>
        Use <Link href="/docs/quickstart/curl">cURL</Link> or the language-specific HTTP examples.
        Test keys simulate sending; live keys require an eligible sender and correctly configured
        delivery infrastructure.
      </p>
      <h2>Not offered as ready at launch</h2>
      <ul>
        <li>
          Paid checkout, recurring subscriptions, invoices and self-service upgrades: not
          configured.
        </li>
        <li>
          Official SDK package distribution: not verified. Node/Python/Ruby/PHP source exists in the
          repository; this is not proof that registry packages belong to Calder or are published.
        </li>
        <li>
          Public SMTP gateway: specification exists, but this repository has no gateway app. Do not
          assume smtp.calder.click accepts submissions.
        </li>
        <li>
          Gmail OAuth: code exists; production OAuth approval and configuration have not been
          verified here.
        </li>
        <li>
          Campaign/audience code exists, but the marketing suite is still marked in development;
          production rollout is not certified.
        </li>
      </ul>
      <h2>Automatic delivery is a separate check</h2>
      <p>
        Queued means accepted, not sent. The automatic wake-up fix was merged in{" "}
        <a href="https://github.com/Emerald-dev0/Calder/pull/87">PR #87</a>. Production deployment
        still requires matching server-only CRON_SECRET and the API_URL on the API and dashboard,
        followed by deployment and a new send without a manual drain. Until that succeeds, immediate
        automatic sending is not verified. The configured fallback cron is daily, not a
        prompt-delivery guarantee.
      </p>
      <p>
        Webhook delivery and bounce/complaint reporting require their own provider event
        configuration. A healthy /health response alone does not test dependencies or inbox
        delivery.
      </p>
      <p>
        <Link href="/docs/usage-billing">Read about current usage limits and billing status</Link>.
      </p>
    </>
  );
}
