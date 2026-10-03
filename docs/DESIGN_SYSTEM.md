# Calder Design System (`v2.0`)

Single-source reference for tokens, typography, iconography, and reusable UI primitives across the Calder dashboard (`apps/dashboard`) and `@calder/ui`.

- **Living Style Guide**: `/dev/design-system` (`apps/dashboard/app/(app)/dev/design-system/page.tsx`)
- **Token Stylesheet**: `apps/dashboard/app/globals.css` & `packages/ui/src/tokens.ts`
- **Component Barrel**: `apps/dashboard/components/design-system/index.ts`

---

## 1. Design Tokens & Dual-Theme Architecture

All colors, radii, elevations, motion timings, and layout dimensions are defined as CSS custom properties on `:root` (Warm Paper Light theme) with full Dark mode overrides under `html[data-theme="dark"]` (Carbon Obsidian Dark theme).

### Zero-FOUC Theme Initialization
`THEME_INIT_SCRIPT` in `apps/dashboard/components/design-system/theme-provider.tsx` executes synchronously in `<head>` before first paint:
- Reads `localStorage.getItem("calder_theme")` (`"light" | "dark" | "system"`).
- Resolves `"system"` against `window.matchMedia("(prefers-color-scheme: dark)")`.
- Sets `document.documentElement.dataset.theme` and `colorScheme` immediately.

### Surface & Ink Tokens
| Token | Role |
|---|---|
| `--color-bg` | Primary page canvas background |
| `--color-bg-subtle` | Secondary canvas / subtle grouping surface |
| `--color-surface` | Card, table, and modal surface |
| `--color-surface-elevated` | Hover rows, headers, code tabs, and nested containers |
| `--color-surface-sunken` | Sunken wells and input backgrounds |
| `--color-ink` | Primary high-contrast text (`>= 14:1` contrast) |
| `--color-ink-secondary` | Secondary body copy |
| `--color-muted` | Supporting labels, captions, and timestamps (`>= 4.6:1` contrast) |
| `--color-accent` | Brand signal coral (`#FF5C35` light / `rgb(255, 107, 71)` dark) |
| `--color-border` | Hairline structural border (`1px solid`) |
| `--color-border-strong` | Interactive / hover border |

### Semantic Status Tokens
Every semantic state provides foreground (`--color-{state}`), surface (`--color-{state}-bg`), and border (`--color-{state}-border`) tokens:
- `success`: Delivered, Verified, Active, Operational
- `warning`: Queued, Pending DNS, Degraded, Rate-limited
- `danger`: Bounced, Complained, Failed, Revoked
- `info`: Processing, Informational, Scheduled

---

## 2. Typography & Numeric Discipline

- **UI Sans (`--type-sans-family`)**: Inter / system geometric sans for navigation, headings, and body copy.
- **Technical Mono (`--type-mono-family`)**: JetBrains Mono for message IDs, API keys, DNS records, webhook signatures, and HTTP status codes.
- **Tabular Numerals**: All metrics, latencies, quotas, and timestamps apply `font-variant-numeric: tabular-nums` (`.tabular-nums`) so vertical columns align to the pixel.

---

## 3. Iconography

- **Single Library**: `lucide-react` is the sole icon library across the dashboard.
- **Sizing & Stroke**: `15px–16px` inside navigation and buttons, `12px` inside status pills, `20px–22px` inside empty state badges.

---

## 4. Component Inventory (`components/design-system`)

### Primitives (`primitives.tsx`)
- `DsButton`: Variants `primary`, `secondary`, `ghost`, `danger`, `accent`; sizes `sm` (`30px`), `md` (`34px`), `lg` (`40px`); `loading` spinner and `disabled` states.
- `DsInput`, `DsSelect`, `DsTextarea`: Accessible form fields with built-in label, hint description, prefix/suffix slots, and `aria-invalid` error message display.
- `DsSwitch`, `DsCheckbox`, `DsRadioCards`: Interactive selection controls with full keyboard activation.
- `StatusPill`: Semantic badge that **always pairs a vector icon + text label** (`delivered`, `verified`, `active`, `queued`, `pending`, `bounced`, `complained`, `failed`, `revoked`, `suppressed`, `test`, `pro`).
- `CopyField`: Read-only monospace credential/DNS field with optional secret masking (`•`) and one-click clipboard copy + toast feedback.
- `CodeBlock`: Dark-canvas code viewer with language tab switcher and copy button.
- `DsBanner`: Contextual callout (`info`, `success`, `warning`, `danger`) with icon, title, description, and optional action slot.
- `StatCard`: KPI card with tabular numeral value, optional delta pill, and sublabel.
- `KeyValueList`: Responsive definition list for metadata inspection.
- `DsEmptyState`: First-run card with icon badge, eyebrow, title, description, primary CTA, and secondary doc link.
- `DsPageHeader`, `Breadcrumbs`, `Avatar`, `Kbd`, `DsSkeleton`.

### Overlays (`overlays.tsx`)
- `DsDialog`: Accessible modal dialog (`role="dialog"`, `aria-modal="true"`, Escape & backdrop dismissal).
- `ConfirmDialog`: Destructive confirmation modal with optional `confirmPhrase` verification input.
- `DsDrawer`: Slide-over right inspector sheet (`560px` max width) for message timelines, webhook deliveries, and DNS records.
- `ShortcutsDialog`: Keyboard shortcut cheat sheet (`?`).
- `ProUpgradeModal`: Tasteful upgrade preview modal for PRO-badged capabilities.

### Data Table (`data-table.tsx`)
- `DataTable`: Sticky header, sortable columns, comfortable/compact row density toggle, bulk row selection, copyable monospace IDs (`CopyableMono`), relative timestamps with UTC ISO tooltip (`RelativeTime`), and empty-filter recovery state.

### Command Palette (`command-palette.tsx`)
- `CommandPalette`: Triggered globally via `⌘K` / `Ctrl+K`, providing instant fuzzy search across pages, quick actions, and theme switching.
