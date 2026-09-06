# Avenor — Design System & Art Direction

Read before touching any visible UI: marketing site, dashboard, email templates, or shared components in `packages/ui`.

## 0. Design principle (locked)

**Editorial Infrastructure** — technical precision with restrained, cinematic art direction.

The feeling: _"This is serious infrastructure, but someone with exceptional taste designed it."_
Not: _"This is another developer SaaS dashboard."_

Every page must have an articulable visual idea. "It's just a dashboard" is not sufficient.

| Surface     | Visual idea                                         |
| ----------- | --------------------------------------------------- |
| Homepage    | Invisible communication infrastructure made visible |
| Pricing     | Simple, predictable infrastructure economics        |
| Docs        | Clarity and speed                                   |
| Status page | Trust through transparency                          |
| Onboarding  | From zero to first successful delivery              |

## 1. Personality

**Should feel:** premium, technical, calm, precise, editorial, confident, slightly cinematic, human, extremely polished.

**Should NOT feel:** generic SaaS, purple-gradient AI startup, corporate enterprise, glassmorphic, crypto/Web3, cartoonish, excessively rounded, animation-for-animation's-sake.

Restraint + strong concept + meaningful motion over decoration.

## 2. Typography

Maximum two primary typefaces, plus an optional monospace for technical metadata only.

```
DISPLAY  → distinctive (modern grotesk, or grotesk + restrained serif accent)
BODY     → extremely readable
MONO     → technical metadata only (IDs, timestamps, keys)
```

- Fluid typography (scales with viewport, not fixed breakpoints jumps).
- Establish semantic type roles (`display`, `heading`, `body`, `caption`, `mono`) as design tokens — components reference roles, not raw font sizes.
- No arbitrary font choices outside the locked type system.

## 3. Color

**Base palette:**

```
Ink     #0B0C0E   (primary text / dark surfaces)
Paper   #F5F4EF   (warm off-white background)
Surface #FFFFFF   (cards/panels on Paper)
Muted   #737373   (secondary text)
```

**One accent** — sophisticated electric blue/cobalt ("Avenor Blue"), exact hex not yet locked. Used sparingly.

**The rule: the accent is a signal, not wallpaper.** Never let the accent dominate a full section — it marks state, action, or emphasis, not decoration.

**No purple-gradient startup palette** (`#7C3AED` / `#8B5CF6` / `#6366F1` territory) — this is explicitly the look Avenor is differentiating away from.

**Rendered-pixel check, not just token check:** a color can be "correct" by hex value and still read as too loud, too saturated, or too AI-startup once actually rendered (font weight, surrounding whitespace, and adjacent colors all affect perceived intensity). The visual QA loop in `AGENTS.md` exists specifically to catch this — judge screenshots, not just CSS values.

## 4. Imagery

Avenor pages should never feel visually empty just because it's a developer product — but imagery requires art direction, not filler.

**Avoid:** programmer-typing-on-laptop stock photos, server rooms, smiling-startup-team photos, generic abstract purple blobs.

**Prefer:** conceptual imagery communicating movement → connection → delivery → reliability → systems. Every major image supports the page's narrative — never "find a picture to fill whitespace."

Formats: WebP/AVIF for raster, SVG for scalable illustration.

## 5. Illustration system

Avenor's own illustration language, not assets from three different unrelated sources:

```
thin geometric lines + technical diagrams + small human elements
+ controlled (single-accent) color + large negative space
```

Example concept: an application → Avenor → OTP/Email/Events fan-out, rendered as an editorial technical illustration rather than a literal flowchart.

## 6. The Avenor Signal

One recurring abstract visual object representing a message moving through infrastructure — appears in favicon, loading states, hero, docs, empty states, diagrams, social graphics, 404, onboarding. Gives Avenor a recognizable identity independent of the wordmark. Exact form TBD at brand-identity phase.

## 7. Layout & composition

Avoid the repeating template:

```
[centered container] → [headline] → [paragraph] → [three cards] → [pricing] → [FAQ]
```

Use editorial composition — asymmetric layouts, large type moments, product screenshots treated as artwork (not generic dashboard screenshots dropped in), progressive reveal on scroll.

**Visual primitives vary by content** — not everything is a rounded card with a shadow. Use flat sections, thin bordered panels, editorial text blocks, large image panels, technical diagrams, small rounded controls, and cards only where a card is actually the right shape.

## 8. Motion

**Tooling:** Lenis for smooth scroll on `apps/web`; used more conservatively on `apps/dashboard` where it must not interfere with dense data scrolling (long log/table views default to native scroll behavior).

**Motion must communicate**, not decorate:

- **State** (queued → processing → accepted → delivered)
- **Relationship** (Application → Avenor → Provider → Recipient)
- **Progression** (Problem → Infrastructure → Delivery → Observability)

**Rules:**

- Always respect `prefers-reduced-motion` — Lenis and scroll-triggered animation degrade to instant/native behavior.
- Never sacrifice performance for a visual effect.
- Avoid scroll-jacking that fights the user's intent.
- Keep animation GPU-friendly (transform/opacity, not layout-triggering properties).

## 9. Visual QA checklist (self-review before every UI PR)

Used by both humans and agents per the loop defined in `AGENTS.md`. Check the actual rendered screenshot against:

- [ ] Does this look like Avenor, or could it be any SaaS product? (generic-template smell test)
- [ ] Is there a maximum of two type families in use, roles applied consistently?
- [ ] Is the accent color used as a signal (states, actions, emphasis) rather than as background/wallpaper?
- [ ] Does any color, once actually rendered, look more saturated/intense than the base palette implies? If so, pull back hue/saturation/lightness rather than accepting the raw token value.
- [ ] Is there a clear visual idea for this specific page (see table in §0), not just "content in a template"?
- [ ] Does motion (if any) explain state/relationship/progression, or is it decorative?
- [ ] Does the layout vary its visual primitives appropriately, or is everything a rounded card?
- [ ] Mobile width (390px) checked, not just desktop?
- [ ] `prefers-reduced-motion` respected?

## 10. Marketing vs. dashboard register

Same universe, different register:

```
MARKETING (apps/web)        DASHBOARD (apps/dashboard)
editorial                    precise
expressive                   dense
cinematic                    functional
```

Dashboard example feel:

```
Avenor
──────────────────────────
Overview

98.92%          42,891         1.02s
Delivery rate   Emails sent    Avg processing

Recent activity
──────────────────────────
✓ Delivered     welcome@example.com
✓ Delivered     verification@example.com
↻ Processing    receipt@example.com
✕ Bounced       test@example.com
```

Minimal decoration — density made beautiful through typography, spacing, and hierarchy, not through ornament.

## 11. Design system layers

```
                    AVENOR
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   DESIGN SYSTEM   ART DIRECTION   MOTION
   typography       imagery         transitions (Lenis)
   spacing          illustration    scroll
   colors           composition     microinteraction
   components       photography     state
```

Design system tokens live in `packages/ui` and are shared; art direction and motion choices can vary more freely by surface as long as they stay within this system.
