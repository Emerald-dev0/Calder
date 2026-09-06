import { Navigation } from "../components/navigation";
import { Hero } from "../components/hero";
import { Pipeline, StackStrip } from "../components/pipeline";
import { Developers } from "../components/developers";
import { Capabilities } from "../components/capabilities";
import { TransmissionBand } from "../components/transmission";
import { Observability } from "../components/observability";
import { ProductTour } from "../components/product";
import { Pricing } from "../components/pricing";
import { FinalCta, Footer } from "../components/closing";

/**
 * Avenor landing — Editorial Infrastructure.
 * Narrative: promise → invisible made visible → proof (code) → depth
 * (capabilities) → trust (observability, domains) → economics → action.
 */
export default function Home() {
  return (
    <>
      <Navigation />
      <main>
        <Hero />
        <StackStrip />
        <Pipeline />
        <hr className="rule" />
        <Developers />
        <hr className="rule" />
        <Capabilities />
        <TransmissionBand />
        <Observability />
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
