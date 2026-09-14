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
 * Marketing suite status. Flip to "live" in the same commit that ships
 * campaigns, and every "in development" mark on the site disappears with it.
 */
export const MARKETING_SUITE: "dev" | "live" = "dev";
