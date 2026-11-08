/**
 * Public site constants. One place to change where a CTA points, so launch
 * day does not mean editing twelve files.
 */

/** Where the product lives. The dashboard owns signup, login and billing. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.calder.click";

/** Product entry point for "start building" CTAs. */
export const SIGNUP_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;

/** Support address, used by support, security and Scale conversations. */
export const SUPPORT_EMAIL = "support@calder.click";

/**
 * Marketing suite status. `coming_soon` means the product is out of this
 * release: the API refuses it and the dashboard labels it Coming Soon. Flip to
 * "live" only in the commit that ships campaigns with acceptance evidence.
 *
 * The authoritative inventory is `packages/config/src/features.ts`; this
 * constant exists for marketing-site copy only.
 */
export const MARKETING_SUITE: "coming_soon" | "live" = "coming_soon";
