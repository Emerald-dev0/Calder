# Public changelog cleanup — 2026-10-29

- Before: `../launch-2026-10-29/changelog-{1440,390}.png`.
- After: `changelog-{1440,390}.png` in this directory, captured from the actual
  local Next.js `/changelog` page using Playwright and npm-distributed Chromium.
- Removed the commit-evidence rows and replaced the audit-oriented introduction
  with a short product-update description. Dates, titles, details and availability
  caveats remain. Evidence stays in repository source and `CHANGELOG.md`.
- Reviewed both widths: existing type hierarchy, paper palette, restrained accent,
  dividers and spacing are unchanged. No horizontal overflow, commit-evidence
  text or commit links in the rendered main content at 1440 or 390 px.
- Repeated capture after fixing the isolated browser harness's page lifecycle;
  inspected desktop and mobile results. No additional visual adjustment needed.
- Scroll-reveal entries were scrolled into view before full-page capture; this is
  local dev evidence, not a production deployment or motion evaluation.
- Initial browser launch lacked bundled runtime libraries; extracting those into
  temporary external QA tooling resolved it. No product dependency was added.
