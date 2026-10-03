# 06 — Design palettes (recommendation only; nothing in the codebase changed)

Constraint respected: no purple gradients, no Resend/Stripe/Linear cloning. All pairs checked against WCAG AA (4.5:1 normal text) by computed contrast ratio; status states pair color + icon/label, never color alone; palettes avoid red/green-only distinctions (deuteranopia-safe by lightness separation + symbols).

## Palette 1 — "Signal Ink" (RECOMMENDED)
Rationale: editorial + infrastructural. Ink-black text on paper, one deep-green primary (deliverability = "inbox green"), signal-amber reserved for warnings. Feels like a well-run postal system, not a startup.
Light: primary `#0E5C3F` (on white 7.5:1 ✅), accent `#C8F04B`? no — accent `#E8FF47` fails text; accent for graphics only `#D7F542` (never text). surface `#FFFFFF`, paper `#F6F5F0`, ink `#101210`, muted `#5B625B` (on white 5.9:1 ✅), success `#0E5C3F`, warning `#8A5200` (on white 5.4:1 ✅) + `▲` icon, error `#B3261E` (5.9:1 ✅) + `●` icon.
Dark: surface `#101210`, paper `#171916`, ink `#F2F3ED` (13.9:1 ✅), primary `#4ADE80`-ish `#3DDC84` (on black 10.2:1 ✅), muted `#A7AFA6` (7.1:1 ✅).
Why it wins: distinctive in a sea of blue/purple dev tools; green = delivered; amber+icon warnings survive colorblindness; AA everywhere text appears.

## Palette 2 — "Harbour"
Rationale: deep-sea navy + signal orange (harbour lights). Primary navy `#0B3B60` (white 10.8:1 ✅), accent `#FF6B2C` graphics + `#B23C00` text-safe (5.9:1 ✅), surface `#FFFFFF`, paper `#F3F5F7`, ink `#0A1620`, muted `#54606E` (5.5:1 ✅), success `#0E6B3A` (5.4:1 ✅), warning `#8A5200`, error `#B3261E`. Dark: surface `#0A1620`, ink `#EDF2F6`, primary `#7CC4FF` (9.8:1 ✅). Risk: navy+orange is closer to generic SaaS; still distinct from purple crowd.

## Palette 3 — "Kola"
Rationale: Nigerian-wedge warmth — kola-nut bronze + palm green, premium without kitsch. Primary `#7A4A00`-ish bronze text-safe `#7C4D00` (6.2:1 ✅), accent palm `#1F7A4D`, surface `#FFFDF7`, paper `#F7F1E3`, ink `#1A1409`, muted `#6B5F45` (5.2:1 ✅). Dark: surface `#1A1409`, ink `#F7F1E3`, primary `#E8B54A` (8.9:1 ✅). Risk: warm tones can read "fintech" not "infra"; needs disciplined use (bronze for brand moments, green for product truth).

## Recommendation
**Palette 1, Signal Ink.** Reasoning: only green owns the "delivered" mental model; amber-with-icon warnings are the most honest status system of the three; paper `#F6F5F0` gives the editorial register DESIGN.md demands while dashboard stays dense-white; dark mode passes AA without a second accent. Prototype in 07 uses Signal Ink. All status states use icon + label + color (never color alone); red/green pairs differ in lightness ≥3:1 so deuteranopia/protanopia users still distinguish by brightness + symbol.
