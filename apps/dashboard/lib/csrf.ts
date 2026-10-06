/**
 * Browser state-changing requests use SameSite=Lax cookies plus an explicit
 * Origin/Referer check. Non-browser callers may omit both headers; a present
 * cross-origin header is always rejected. This is intentionally centralized so
 * new cookie-authenticated routes do not silently skip the CSRF posture.
 */
export function sameOriginRequest(req: Request): boolean {
  const expected = new URL(req.url).origin;
  const origin = req.headers.get("origin");
  if (origin) return origin === expected;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  // Same-site is not the same as same-origin: a sibling subdomain can still
  // submit a cookie-authenticated request. If the browser supplies this
  // signal, require same-origin (or an explicit non-browser `none`) rather
  // than treating same-site as safe. Requests without browser metadata remain
  // usable for server-to-server callers because they do not carry a browser
  // cookie by default.
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
