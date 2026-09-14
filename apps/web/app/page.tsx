import { Navigation } from "../components/navigation";
import { Hero } from "../components/hero";
import { Opening } from "../components/opening";
import { Pipeline, StackStrip } from "../components/pipeline";
import { SmtpSection } from "../components/smtp-section";
import { BeginnerSection } from "../components/beginner";
import { Developers } from "../components/developers";
import { Streams } from "../components/streams";
import { Capabilities } from "../components/capabilities";
import { ProductTour } from "../components/product";
import { Pricing } from "../components/pricing";
import { FinalCta, Footer } from "../components/closing";

/**
 * Calder landing, Editorial Infrastructure.
 * Narrative: Human problem → Calder's promise → technical proof → product
 * capabilities → infrastructure → pricing → action.
 */
export default function Home() {
  return (
    <>
      <Navigation />
      <main>
        <Hero />
        <StackStrip />
        <Opening />
        <hr className="rule" />
        <Pipeline />
        <hr className="rule" />
        <SmtpSection />
        <hr className="rule" />
        <BeginnerSection />
        <hr className="rule" />
        <Developers />
        <hr className="rule" />
        <Streams />
        <hr className="rule" />
        <Capabilities />
        <hr className="rule" />
        <ProductTour />
        <hr className="rule" />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
