import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards for the sign-in and sign-up screens.
 *
 * Two failures are invisible to typecheck and to `next build`, which is exactly
 * why they survived until someone looked at the page:
 *
 * 1. **Prerendering froze the provider list.** `configuredProviders()` reads
 *    environment variables. In a static page that runs once, at build time — so
 *    a build without OAuth secrets shipped "OAuth isn't configured" and hid the
 *    Google and GitHub buttons forever, even though production had the secrets.
 *    Both pages must stay dynamic.
 * 2. **The two screens drifted.** Each form carried its own copy of the provider
 *    label map and its own anchor markup, so the buttons were text-only ("Continue
 *    with Google") with no brand marks, and fixing one screen did not fix the
 *    other. Both must render the shared component that owns the marks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "app");
const COMPONENTS = join(HERE, "..", "components");

const read = (path: string) => readFileSync(path, "utf8");

const PAGES = ["login", "signup"] as const;

describe("auth screens", () => {
  it.each(PAGES)("/%s reads provider configuration per request, never at build time", (page) => {
    const source = read(join(APP, page, "page.tsx"));
    expect(source).toMatch(/export const dynamic = "force-dynamic";/);
  });

  it.each(PAGES)("/%s renders the shared OAuth buttons and no local copy", (page) => {
    const source = read(join(APP, page, `${page}-form.tsx`));
    expect(source).toContain('from "../../components/auth/oauth-buttons"');
    expect(source).toContain("<OAuthButtons providers={providers} />");
    // A local label map or a hand-rolled anchor is the drift this test exists
    // to stop: it is how the buttons lost their logos in the first place.
    expect(source).not.toMatch(/const LABELS = \{/);
    expect(source).not.toMatch(/href=\{`\/api\/auth\/\$\{/);
  });

  it("draws both brand marks inline, with the provider's own colours", () => {
    const source = read(join(COMPONENTS, "auth", "oauth-buttons.tsx"));
    // Google's four-colour G and GitHub's single-colour mark. Inline SVG, so no
    // image request can 404 behind the CSP and no CDN decides the branding.
    for (const colour of ["#4285F4", "#34A853", "#FBBC05", "#EA4335"]) {
      expect(source).toContain(colour);
    }
    expect(source).toContain("M8 0C3.58 0 0 3.58 0 8c0 3.54");
    expect(source).toContain('className="auth-oauth-btn"');
  });

  it("keeps the social anchors as full navigations", () => {
    const source = read(join(COMPONENTS, "auth", "oauth-buttons.tsx"));
    // Next <Link> prefetches the redirect target with fetch; the provider's
    // CORS response kills that fetch instead of navigating.
    expect(source).not.toContain("next/link");
    expect(source).toContain("href={`/api/auth/${provider}`}");
  });

  it("styles both sign-in paths from one pair of rules", () => {
    const css = read(join(APP, "globals.css"));
    // The primary button and the social buttons must exist as real classes; a
    // missing rule is how "Sign in" rendered as an unstyled default button.
    for (const rule of [".auth-oauth-btn {", ".auth-spinner {", ".auth-btn-primary {"]) {
      expect(css).toContain(rule);
    }
  });
});
