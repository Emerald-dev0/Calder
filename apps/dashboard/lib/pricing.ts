import { getConfig } from "@calder/config";

/**
 * The dashboard has no pricing route (and no checkout yet), pricing lives on
 * the marketing site. Every in-app "pricing" link must point there, never at
 * a relative "/pricing" that 404s inside the dashboard app.
 */
export function pricingUrl(): string {
  return `${getConfig().APP_URL.replace(/\/+$/, "")}/pricing`;
}
