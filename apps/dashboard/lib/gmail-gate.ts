import { featureAvailability, featureDisabledMessage } from "@calder/config/features";
import { gmailConnectAvailable } from "@calder/auth";

/**
 * Can this deployment offer "Connect Gmail" right now?
 *
 * Two independent facts have to agree, and collapsing them is what produced
 * the drift this module fixes:
 *
 *  1. **Product.** `gmail_integration` in `@calder/config/features` is
 *     `coming_soon` until Google production approval and one verified
 *     end-to-end send exist. Flipping that registry entry is the launch switch.
 *  2. **Deployment.** OAuth cannot start without `GOOGLE_CLIENT_ID` and
 *     `GOOGLE_CLIENT_SECRET`. A launched feature on an unconfigured deployment
 *     would still dead-end the customer, so the credentials are checked too.
 *
 * The old behaviour was a live "Connect Gmail" link on `/senders` and in
 * onboarding while `/integrations` said "Coming soon" — three surfaces, two
 * answers. Every surface now asks this function, and the API refuses the same
 * feature independently (`assertFeatureAvailable("gmail_integration")`).
 *
 * Server-only: it reads configuration and must never be imported into a client
 * bundle. The result is passed down as props instead.
 */
export interface GmailGate {
  /** True only when the product is launched *and* credentials are configured. */
  offered: boolean;
  /** Short customer-facing claim shown on the disabled card. */
  title: string;
  /** Why it is unavailable and what to use instead. Never empty when closed. */
  note: string;
}

export function gmailGate(deps: { available?: boolean; credentials?: boolean } = {}): GmailGate {
  const available = deps.available ?? featureAvailability("gmail_integration", null).available;
  if (!available) {
    return {
      offered: false,
      title: "Gmail connection · coming soon",
      note: `${featureDisabledMessage("gmail_integration")} Use the shared test sender or a verified domain for now.`,
    };
  }

  const credentials = deps.credentials ?? gmailConnectAvailable();
  if (!credentials) {
    return {
      offered: false,
      title: "Gmail connection · not configured",
      note: "Google OAuth credentials are not configured on this deployment yet, so no account can be connected. Use the shared test sender or a verified domain for now.",
    };
  }

  return { offered: true, title: "Connect Gmail", note: "" };
}

/**
 * Guard for server actions. A page that renders a Coming Soon card is not a
 * control: a crafted POST still reaches the exported action.
 */
export function assertGmailOffered(): void {
  const gate = gmailGate();
  if (!gate.offered) throw new Error(gate.note);
}
