# 07 — Landing redesign (prototype only, email scope)

Prototype: `landing-redesign/index.html` (self-contained, no build, no changes to `apps/web`). Screenshots: `shot-1440.png`, `shot-390.png` (headless Chrome, 2026-10-02, `?noreveal` param disables scroll-reveal so the full page is capturable; live page animates on scroll and respects `prefers-reduced-motion`).

## 1. Messaging brief

- **Positioning (one sentence):** Calder is the Nigeria-first transactional email API — Resend-simple sending with Naira billing, WAT human support, and deliverability defaults that get Nigerian product email to the inbox. (From 05.)
- **Headline options:** (a) "Product email that reaches the inbox. Billed in Naira." ← used. (b) "Transactional email that bills in Naira and answers in WAT." (c) "From npm install to inbox in 5 minutes — without a dollar card."
- **Subheadline:** Resend-simple sending, human support in your timezone, deliverability defaults on from day one.
- **Who it is for:** developers whose dollar cards decline; indie/SaaS teams sending receipts, resets, OTPs; legacy stacks (WordPress/Laravel/Django) via SMTP when it ships.
- **The one feeling:** relief — "finally, infrastructure priced in my money, with humans who answer."

## 2. Page structure (purpose per section)

1. Sticky nav — logo, Product/Pricing/Compare/Docs, primary CTA (key, not signup — developers convert on keys).
2. Hero — eyebrow (category + wedge), H1 (outcome + Naira), sub (objection handling), dual CTA (send vs compare), micro-proof (free tier, no card, 5 min), live code block with Node/Python/cURL tabs (the actual API shape incl. idempotencyKey).
3. Product ("One pipe…") — 6 cards in Send/Prove/Protect/Start/Migrate/Grow, each with ● Live / ▲ Coming-soon badge (icon + label + color, never color alone). SMTP and marketing stream labeled honestly.
4. Pricing — real table from PRD (USD + NGN separate points, hard limits), early-access microcopy (no purchasable billing yet — honest).
5. Compare — them-vs-Calder at 50k emails (price + timezone + rails, not just $/1k).
6. Docs/Quickstart — 3 steps (key → domain → send + watch), sets the 5-minute expectation.
7. Final CTA — repeats free-tier terms + alpha status line.
8. Footer — prototype disclaimer.

## 3. Copy

In `index.html` (final). Claim audit: every "Live" badge maps to a REAL feature in 00-inventory.md §8; SMTP = "Coming soon", marketing stream = "In development"; pricing carries early-access note (BILL-001). No channel beyond email is promised (owner scope).

## 4. Self-review (rendered pixels, not hex)

- **Palette (Signal Ink, 06):** paper `#F6F5F0` reads warm-editorial, not bland-white; primary `#0E5C3F` on white ≈ 7.5:1, body `#101210` on paper ≈ 15:1, muted `#5B625B` ≈ 5.9:1 — all AA. Dark code block `#101210` + `#F2F3ED` ≈ 13.9:1. Accent `#D7F542` used only for the active tab pill (with dark text) and code keywords — never body text. No gradients anywhere; nothing purple; doesn't clone Resend/Stripe/Linear.
- **DESIGN.md §9 checklist:** typography (one sans + one mono, tight display tracking) ✓; color restraint (2 hues + neutrals) ✓; spacing (64px sections, 20px card gaps) ✓; motion purpose (single reveal-on-scroll, reduced-motion off-switch) ✓; generic-SaaS smell (no gradient mesh, no floating dashboard mock, no "supercharge" copy) ✓.
- **Colorblind:** Live/Coming-soon badges use ●/▲ glyphs + words; red/green never pair without lightness + symbol separation.
- **1440:** hero two-column balanced; code block legible; cards 3-up even; table full-width readable.
- **390:** single column, no clipping (fixed: grid `min-width:0`, h1 32px); CTAs full-width stacked; table scrolls/fits at 13.5px; tabs + code block intact.
- **Iteration log:** (1) cards rendered near-invisible in headless capture — reveal now gated on `html.js` so no-JS/headless still shows content; (2) h1 clipped on 390 — added `min-width:0` + smaller min size; (3) ₦ glyph missing in container fonts — table uses "NGN 25,000" (real browsers render ₦; keep ₦ in production with a font that ships it, or keep NGN — both honest).
- **Unsure:** whether "Billed in Naira" green line competes with the H1's black lines on small screens — flag for human eye; and whether the compare section needs a real Naira-vs-USD fee footnote (needs owner FX input, 03).

## 5. What the real site must change to match

1. Adopt Signal Ink tokens (or chosen palette) in `packages/ui` + both apps (single source, per PRD §11 pattern used for plans).
2. Replace/audit every SMTP mention per SMTP-001a; add Live/Coming-soon badges to feature grids.
3. Pricing page: early-access labels until BILL-001b closes; keep `plans.ts` as single source.
4. Add the `?noreveal`-safe reveal pattern (content visible without JS) if scroll animation is kept.
5. Anything the prototype claims that Gate 1 hasn't closed must carry its badge — re-run this file's claim audit before shipping.
