# Founder foundation visual QA — 2026-10-29

## Actual components, fixture data

These are actual Chromium captures of the real `SidebarShell` and navigation,
with actual Metrics page markup and dashboard/control styles. Query results,
profile and route context are synthetic, explicitly labeled. The temporary Vite
harness lives in ignored `.cache/`; it does not change product auth or add a
production route. This is not a live signed-in tenant or backend integration.

- `metrics-1440.png`, `metrics-390.png`: restored Paper/Ink founder scope, current
  outcome cards and grouped navigation.
- `navigation-search-{1440,390}.png`: real hydrated search and mobile menu state.
- Prior state: owner's screenshot of the Maintenance page showed inherited dark
  background and unstructured panels. No exact before-Metrics capture is available;
  these are not presented as identical before/after routes.

## Checks and iteration

- Inspected desktop/mobile screenshots: restrained paper palette, white panels,
  clear text hierarchy and a quiet cobalt navigation accent. Browser computed
  founder background is `rgb(245, 244, 239)`.
- First render let a supposed two-column workspace become three cards plus an
  orphaned fourth. Corrected `.cp-grid-2` to explicit equal columns with a
  narrow-screen stack, then recaptured. This also prevents min-width overflow.
- Browser checks passed: search result filtering, no-results state, sidebar
  collapse persisted across reload, expand, mobile disclosure and mobile search.
- No document-width horizontal overflow at 1440/390. Active page is singular per
  navigation instance; section overviews no longer light up on every child.
- Fixture screenshots do not establish role mutation, DB correctness, real Next
  navigation, production data, loading/error boundary recovery or provider setup.
  Those have separate test/hosted acceptance gates.
- Local browser tooling required bundled runtime libraries; these were extracted
  outside the product dependency tree. No dependency added to Calder.
