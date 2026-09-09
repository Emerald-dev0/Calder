import { Navigation } from "../components/navigation";
import { Hero } from "../components/hero";
import { Pipeline, StackStrip } from "../components/pipeline";
import { SmtpSection } from "../components/smtp-section";
import { BeginnerSection } from "../components/beginner";
import { Developers } from "../components/developers";
import { Capabilities } from "../components/capabilities";
import { TransmissionBand } from "../components/transmission";
import { ProductTour } from "../components/product";
import { Pricing } from "../components/pricing";
import { FinalCta, Footer } from "../components/closing";

/**
 * Calder landing, Editorial Infrastructure.
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
 <SmtpSection />
 <hr className="rule" />
 <BeginnerSection />
 <hr className="rule" />
 <Developers />
 <hr className="rule" />
 <Capabilities />
 <TransmissionBand />
 <ProductTour />
 <hr className="rule" />
 <Pricing />
 <FinalCta />
 </main>
 <Footer />
 </>
 );
}
