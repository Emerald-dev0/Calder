import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { WaitlistForm } from "../../components/waitlist-form";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
 title: "Waitlist, Calder",
 description:
 "Join the Calder early-access waitlist. Take a number, share your link, get your API key first.",
};

const NEXT_STEPS = [
 [
 "Take a number",
 "One email, one seat. Your position is computed live from real signups, no vanity numbers.",
 ],
 [
 "Share your link",
 "Everyone who joins with your link queues behind you. Early users shape the API.",
 ],
 [
 "Get your key first",
 "We onboard in position order. Test keys from day one, live keys as domains verify.",
 ],
] as const;

export default function WaitlistPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Early access"
 title={
 <>
 Skip the line <em>by joining it.</em>
 </>
 }
 lede="Calder opens in position order. Take a number now and you'll get test keys the moment your batch opens, plus a direct line to the people building it."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <WaitlistForm />
 </Reveal>
 <div style={{ marginTop: "3rem" }}>
 {NEXT_STEPS.map(([title, body], i) => (
 <div className="ed-row" key={title} style={{ padding: "1.6rem 0" }}>
 <Reveal>
 <div className="ed-index">0{i + 1}</div>
 <h3 style={{ margin: 0, fontSize: "1.25rem", letterSpacing: "-0.015em" }}>
 {title}
 </h3>
 </Reveal>
 <Reveal delay={80}>
 <p style={{ margin: 0, color: "var(--ink-soft)" }}>{body}</p>
 </Reveal>
 </div>
 ))}
 </div>
 </div>
 </section>
 </main>
 <Footer />
 </>
 );
}
