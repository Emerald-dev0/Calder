/**
 * The public plan comparison lives on the marketing site; buying does not.
 * In-app upgrades belong on `/billing`, which is the only surface that talks to
 * checkout. Every "see all prices" link must point at the marketing site, never
 * at a relative "/pricing" that 404s inside the dashboard app.
 *
 * Deliberately *not* `getConfig()`: this module is imported by client
 * components (`plan-gate`, the design-system upsell dialog), where a
 * server-only env read resolves to nothing and the link silently became
 * `http://localhost:3000/pricing` in production. `NEXT_PUBLIC_*` is inlined by
 * Next at build time, so the value survives into the browser bundle.
 */
const MARKETING_ORIGIN = (process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://calder.click").replace(
  /\/+$/,
  ""
);

export function pricingUrl(): string {
  return `${MARKETING_ORIGIN}/pricing`;
}
