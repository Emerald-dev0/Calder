# Interface Specification — CR-001 (Phase 03)

Visual law: docs/DESIGN.md "Editorial Infrastructure", register = precise/dense/functional. Light Paper theme (DEC-003).

## Tokens (control.css, light register)

```
--cp-bg: #F5F4EF        (Paper — page background)
--cp-panel: #FFFFFF     (Surface — cards/panels only where a boundary helps)
--cp-panel-2: #FAFAF7   (subtle inset)
--cp-border: #E4E2D9    (warm hairline)
--cp-border-soft: #ECEAE2
--cp-text: #0B0C0E      (Ink)
--cp-muted: #737373
--cp-faint: #A3A094
--cp-accent: #3D5AFE    (cobalt — signal only: active/selected/interactive/actionable)
--cp-ok / --cp-warn / --cp-bad: status hues, desaturated in rendering
```

Accent discipline (§03): cobalt marks active nav indicator, selected chart series, primary action, focus rings, live-state dots. Never section backgrounds, never wallpaper, never large solids.

## Type hierarchy (§33)

- Section label: 10.5px, uppercase, letter-spacing 0.14em, muted — used as open-canvas eyebrows (not every section needs a panel).
- Heading: 15–18px semibold Ink. Page title 24px. No marketing hero.
- Metric: 26–30px tabular-nums ("instrument readings").
- Context/comparison: 12px muted with explicit basis ("vs previous 30 days").
- Metadata: 11px mono (timestamps, IDs, emails).

## Composition rules (§35)

- Open canvas: growth chart, acquisition/geography tables, recent activity, top pages — hairline-separated open sections, not cards.
- Cards only where boundary helps: metric strip modules, funnel, platform health, email delivery, health summary.
- Grid rhythm (§33 alt): large analytical view → two compact views side-by-side → open section. Never 20 identical cards.
- Charts: single accent + Ink series (max 3 active), minimal grid, no rainbow, no gradients, no 3D, tooltips with explicit period labels and comparison.

## Interaction states (§36)

- Buttons: hover (border+bg shift), active (1px press), focus-visible (2px cobalt ring, 2px offset), disabled (40% + no pointer), loading (inline 12px spinner, label kept), success/error via toast or inline text — never color-only.
- Tables: row hover (2% ink tint), sortable headers with direction glyph, sticky header in scroll areas, pagination footer "Showing X–Y of Z".
- Chart series toggles: checkbox-chips with series color swatch; disabled = struck swatch, not gone.

## Responsive (§32/NFR-007)

- Desktop 1440 primary. Tablet: 2-col grids → 1-col at ≤1024. Mobile 390: sidebar → drawer; metric strip stacks 2-up then 1-up; charts keep horizontal scroll with min-width; tables → stacked rows (label: value); email editor → settings → content → preview flow.

## Motion (NFR-003)

- Transition durations 120–180ms, transform/opacity only. Relative timestamps refresh in place. New feed items enter via fade/translate ≤ 12px. `prefers-reduced-motion`: all of the above become instant.
