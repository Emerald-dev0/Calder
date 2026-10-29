# Launch-copy visual QA — 2026-10-29

## Captures

All files are local screenshots at **1440 px** and **390 px**, not production
customer pages. No customer data, keys or email content is included.

- `usage-*`: actual Usage server component rendered with a synthetic workspace,
  actual design-system components and dashboard stylesheet; not the full signed-in
  application shell or real database. Counters/limits and billing notice are visible.
- `http-examples-*`: actual quickstart client component server-rendered with a
  synthetic project, actual dashboard styles. This verifies layout and absence of
  SDK-install tabs, not hydrated tab/key-creation/copy behavior.
- `availability-*`, `usage-billing-*`, `changelog-*`, `pricing-*`: actual Next.js
  public routes in the local dev server (all HTTP 200). Reveal sections were made
  visible for full-page capture; scroll animation itself was not evaluated.

Playwright's browser download was blocked by the network allowlist. A Chromium
binary distributed through npm (`@sparticuz/chromium`) plus its bundled runtime
libraries was used only as local QA tooling, outside the product dependency tree.
The resulting browser screenshots succeeded; browser installation was not counted
as a successful test when the initial CDN attempt failed.

## Review and iteration

- Retained existing typography, paper/surface palette and spacing; no new gradients,
  saturated accents, hero styles or purchase buttons were introduced.
- Checked cards/notes for wrapping and horizontal overflow at both widths; the
  captured routes/fixtures all reported no document-width overflow.
- First review caught a green **Delivered** pill on the provider-accepted Usage
  stat, despite the corrected label. Removed the pill, added a regression assertion,
  rerendered the fixture and captured a second pass.
- Confirmed paid plan table and upgrade CTA are absent from Usage, quota/period
  details remain, and the billing-unavailable notice is readable on mobile.
- Confirmed HTTP examples remain, while SDK install tabs/claims are absent.
- Changelog includes commit evidence and availability caveats rather than fabricated
  releases. The pricing page still displays the planned catalogue, but clearly
  labels it as unavailable for purchase; its offer JSON-LD is removed.

## Limits / required hosted review

No signed-in shell screenshot, actual tenant navigation, clipboard interaction,
production provider configuration, hosted background wake-up, billing checkout,
SDK publication/provenance or install-to-live test is proven by these images.
API/dashboard/web deployment plus one new send without a manual drain is still a
launch check, not marked complete by visual QA. Pricing outside Usage remains a
planning catalogue; this change does not enable billing or remove enforced caps.
