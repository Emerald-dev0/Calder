import { getConfig } from "@calder/config";

/**
 * The public plan comparison lives on the marketing site; buying does not.
 * In-app upgrades belong on `/billing`, which is the only surface that talks to
 * checkout. Every "see all prices" link must point at the marketing site, never
 * at a relative "/pricing" that 404s inside the dashboard app.
 */
export function pricingUrl(): string {
  return `${getConfig().APP_URL.replace(/\/+$/, "")}/pricing`;
}
