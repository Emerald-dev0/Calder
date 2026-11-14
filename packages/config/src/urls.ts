/**
 * Which host a link belongs to.
 *
 * Calder runs as three deployed applications, and they are three different
 * origins:
 *
 *   marketing   calder.click      apps/web       pricing, docs, blog
 *   dashboard   app.calder.click  apps/dashboard login, settings, invites, exports
 *   api         api.calder.click  apps/api       /v1/*
 *
 * `APP_URL` used to mean "our site" and was used for all three. That is how an
 * invitation email came to contain `https://calder.click/invite/<token>` — a
 * route that only exists in the dashboard, and a 404 for every invitee. The
 * same mistake was present in six other links.
 *
 * These helpers exist so a caller has to say *which product* it is linking to.
 * Getting it wrong is then a reviewable mistake, not an invisible default.
 */

export type PublicHostKind = "marketing" | "dashboard" | "api";

export class UrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlConfigError";
  }
}

const ENV_VAR: Record<PublicHostKind, "APP_URL" | "DASHBOARD_URL" | "API_URL"> = {
  marketing: "APP_URL",
  dashboard: "DASHBOARD_URL",
  api: "API_URL",
};

const LOCALHOST_DEFAULT: Record<PublicHostKind, string> = {
  marketing: "http://localhost:3000",
  dashboard: "http://localhost:3001",
  api: "http://localhost:3002",
};

const EXAMPLE_HOST: Record<PublicHostKind, string> = {
  marketing: "https://calder.click",
  dashboard: "https://app.calder.click",
  api: "https://api.calder.click",
};

/** `https://app.example.com/` + `settings` → `https://app.example.com/settings`. */
export function joinUrl(base: string, path = ""): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!path) return trimmed;
  const clean = path.startsWith("/") ? path : `/${path}`;
  // Collapse a leading `//` so a user-supplied id can never turn the path into
  // a protocol-relative URL (`https://host//evil.com` is a same-host path;
  // some clients disagree). Defence in depth only — ids are validated too.
  return `${trimmed}${clean.replace(/^\/{2,}/, "/")}`;
}

/**
 * Refuse to emit a `localhost` link from a hosted deployment.
 *
 * The original bug was invisible precisely because a wrong-but-plausible URL
 * still renders. An unset variable in staging/production is not a preference —
 * it is a misconfiguration, and it should fail where the link is built (inside
 * a request), not be discovered by a customer clicking a 404.
 *
 * An explicit value is always honoured, including a preview host, so this never
 * blocks a deliberate non-production origin.
 */
export function assertConfiguredUrl(
  kind: PublicHostKind,
  value: string,
  options: { hosted: boolean; env?: Record<string, string | undefined> }
): void {
  if (!options.hosted) return;
  const name = ENV_VAR[kind];
  const configured = options.env?.[name]?.trim();
  if (configured) return;
  if (value.trim() !== LOCALHOST_DEFAULT[kind]) return;
  throw new UrlConfigError(
    `${name} is not set, so links to the ${kind} would point at "${value}". ` +
      `Set ${name} to the deployed origin (e.g. ${EXAMPLE_HOST[kind]}).`
  );
}

/** Build an absolute link for one of the three hosts. Throws when hosted and unset. */
export function publicUrl(
  kind: PublicHostKind,
  base: string,
  path = "",
  options: { hosted: boolean; env?: Record<string, string | undefined> } = { hosted: false }
): string {
  assertConfiguredUrl(kind, base, options);
  return joinUrl(base, path);
}
