# Avenor — Brand Identity (v1)

> **Canonical mark update.** The production identity is the board-approved system
> (`avenor-symbol.svg`, `avenor-wordmark.svg`, `avenor-lockup.svg`,
> `avenor-lockup-dark.svg`, favicon; board: `docs/brand-board.png`): an origin dot
> plus a bold route resolving into an abstract A, with the custom angular AVENOR
> wordmark. Accent Blue is `#3D5AFE`. The signal-route exploration below
> (`symbol.svg`, `lockup-horizontal.svg`, etc.) is retained as process history —
> its pulse/dot motif language still drives site illustrations and motion, but it
> is NOT the logo. Do not mix the two marks in one surface.

## The concept: the signal route

Avenor sits between an application and its recipient. The mark captures that
interval in three strokes:

1. **The route** — two converging strokes forming an abstract `A`. The
   infrastructure path itself.
2. **The pulse** — the crossbar breaks into a signal waveform. The message
   in transit, alive inside the system.
3. **The dot** — a filled terminal point where the pulse ends. Delivery.
   The only accent-colored element in the identity.

The `A` is never drawn as a letter — it emerges from signal geometry. Read
literally, it is a route with a pulse and a destination. Read twice, it is an
`A` for Avenor. That double reading is the entire brand: infrastructure first,
initial readable second.

## Geometry spec

- Grid: 64 × 64. Route stroke 6, pulse stroke 4.5, dot r 4.5.
- Caps/joins: round throughout the symbol (human), square caps + round joins
  in the wordmark (engineered).
- Wordmark: uppercase `AVENOR`, geometric construction, cap height 64,
  stem stroke 11, tracking 18. The `A` reuses the signal-pulse crossbar at
  stroke 9 — one step lighter, a deliberate hierarchy, not an accident.
- No gradients. No containers. No envelopes, planes, bells, or `@` signs.

## The tests (all pass)

- **Favicon test** — beside Vercel's triangle, Linear's mark, GitHub's
  octocat: an A-route with a blue terminal dot holds its own silhouette.
- **Memory test** — two legs, a zigzag bar, a dot. Redrawable in seconds.
- **No-wordmark test** — the symbol is a complete identity alone.
- **One-color test** — `symbol-mono.svg`: the dot goes ink, nothing is lost.
- **Small sizes** — `symbol-small.svg` (16–24px): heavier legs (stroke 8),
  straight bar, dot enlarged. The kink is detail; the dot is identity.

## Files

| File                                 | Use                                      |
| ------------------------------------ | ---------------------------------------- |
| `symbol.svg`                         | Primary mark (ink + Avenor Blue dot)     |
| `symbol-mono.svg`                    | Single-color reproduction                |
| `symbol-dark.svg`                    | Reversed for dark surfaces               |
| `symbol-small.svg`                   | 16–24px, favicon construction base       |
| `wordmark.svg` / `wordmark-dark.svg` | Path-built `AVENOR` (no font dependency) |
| `lockup-horizontal.svg`              | Primary lockup                           |
| `lockup-stacked.svg`                 | Centered/stage use                       |
| `../exploration/A–H.svg`             | Rejected directions, kept for the record |

Title-case `Avenor` in product UI stays typed (system stack) — the path
wordmark is reserved for brand surfaces.

## The motif system

The mark decomposes into reusable primitives: **route** (converging strokes),
**pulse** (the waveform), **dot** (the terminal). Already deployed:

- Favicon, nav, footer, docs surfaces → symbol
- Hero send-states, pipeline connectors, transmission band → pulse + dot in motion
- Final CTA constellation → symbol at monument scale inside orbit rings
- Loading/empty states (dashboard, future) → dot traveling the pulse path

Any future illustration should be built from these three primitives before
reaching for anything else.
