import { ComingSoon } from "../../../components/coming-soon";

export const metadata = { title: "Calder — Inbox" };

/**
 * Inbound email does not exist in this release.
 *
 * This page previously rendered an "Inbound Inbox" PRO badge, a fake webhook
 * preview and a plan gate selling inbound routing that has no ingestion
 * pipeline, no MX handling and no inbound event. Outbound webhooks are real;
 * receiving mail is not. The honest surface is Coming Soon with a pointer to
 * what does work.
 */
export default function InboxPage() {
  return (
    <ComingSoon
      feature="inbound_email"
      title="Inbound Inbox"
      description="Receiving email is not part of the Calder MVP. Outbound email delivery, templates, signed webhooks and transactional suppression are available today."
      alternative={{ href: "/emails", label: "View outbound email" }}
      checklist={[
        "No MX or inbound ingestion endpoint exists",
        "No inbound webhook event is emitted",
        "Outbound webhooks are available under Webhooks",
      ]}
    />
  );
}
