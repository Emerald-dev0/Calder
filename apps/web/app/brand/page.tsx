import type { Metadata } from "next";
import Image from "next/image";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
 title: "Brand, Calder",
 description: "The Calder visual identity: logo, colors, typography, and usage.",
};

const COLORS = [
 ["Ink", "#0B0C0E", "Primary text, dark surfaces"],
 ["Paper", "#F5F4EF", "Warm off-white background"],
 ["Surface", "#FFFFFF", "Cards and panels"],
 ["Muted", "#737373", "Secondary text"],
 ["Calder Blue", "#1E3A8A", "Interactive accents on light"],
 ["Signal Blue", "#3D5AFE", "The mark's dot, dark surfaces"],
] as const;

export default function BrandPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Brand"
 title={
 <>
 Editorial <em>infrastructure.</em>
 </>
 }
 lede="Technical precision with restrained, cinematic art direction. Serious infrastructure, designed by someone with exceptional taste, never a generic SaaS look."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <p className="eyebrow">The mark</p>
 <h2 className="h2">
 A signal, <em>a destination.</em>
 </h2>
 <p className="lede" style={{ marginTop: "1.2rem" }}>
 An origin dot and a bold route that resolves into an abstract A, connection,
 movement, reliability, without a single envelope in sight. The full exploration
 (nine concepts considered, one chosen) is documented in the repo.
 </p>
 </Reveal>
 <Reveal delay={100}>
 <div className="pipeline" style={{ marginTop: "2rem", textAlign: "center" }}>
 <Image
 src="/assets/brand/calder-logo-primary.png"
 alt="Calder primary logo lockup"
 width={1200}
 height={630}
 style={{ maxWidth: 640, width: "100%", height: "auto" }}
 />
 <div
 style={{
 display: "flex",
 gap: "0.8rem",
 justifyContent: "center",
 marginTop: "1.6rem",
 flexWrap: "wrap",
 }}
 >
 <a
 className="btn btn-secondary btn-sm"
 href="/assets/brand/final/calder-lockup.svg"
 download
 >
 Lockup (SVG)
 </a>
 <a
 className="btn btn-secondary btn-sm"
 href="/assets/brand/final/calder-lockup-dark.svg"
 download
 >
 Lockup dark (SVG)
 </a>
 <a
 className="btn btn-secondary btn-sm"
 href="/assets/brand/final/calder-symbol.svg"
 download
 >
 Symbol (SVG)
 </a>
 <a
 className="btn btn-secondary btn-sm"
 href="/assets/brand/final/calder-wordmark.svg"
 download
 >
 Wordmark (SVG)
 </a>
 <a className="btn btn-secondary btn-sm" href="/favicon.svg" download>
 Favicon (SVG)
 </a>
 </div>
 </div>
 </Reveal>
 <Reveal>
 <p className="eyebrow" style={{ marginTop: "3rem" }}>
 Color
 </p>
 <h2 className="h2">
 Quiet neutrals, <em>one signal.</em>
 </h2>
 </Reveal>
 <div
 className="pricing-grid"
 style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
 >
 {COLORS.map(([name, hex, use], i) => (
 <Reveal key={hex} delay={i * 60} className="price-card">
 <div
 style={{
 height: 72,
 borderRadius: 10,
 background: hex,
 border: "1px solid var(--border)",
 }}
 />
 <p className="price-quota" style={{ marginBottom: 2 }}>
 {name}
 </p>
 <p className="price-both mono">{hex}</p>
 <p className="caption" style={{ marginTop: 6 }}>
 {use}
 </p>
 </Reveal>
 ))}
 </div>
 <Reveal>
 <div className="pipeline" style={{ marginTop: "2rem" }}>
 <p className="eyebrow">Rules</p>
 <div className="minilog">
 <div className="minilog-row">
 <span className="status-dot ok" />
 <span className="addr">
 Accent is a signal, states, actions, emphasis. Never wallpaper.
 </span>
 </div>
 <div className="minilog-row">
 <span className="status-dot ok" />
 <span className="addr">Light mode first. Paper backgrounds, ink type.</span>
 </div>
 <div className="minilog-row">
 <span className="status-dot bad" />
 <span className="addr">
 No purple gradients, no glassmorphism, no rounded-blob logos.
 </span>
 </div>
 <div className="minilog-row">
 <span className="status-dot bad" />
 <span className="addr">
 Never stretch, recolor, or re-set the wordmark in another typeface.
 </span>
 </div>
 </div>
 </div>
 </Reveal>
 </div>
 </section>
 </main>
 <Footer />
 </>
 );
}
