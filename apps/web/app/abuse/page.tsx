import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";

export const metadata: Metadata = {
  title: "Report abuse, Calder",
  description: "Report an unwanted email sent through Calder.",
};

export default function AbusePage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Trust & safety"
          title="Report an email."
          lede="Received an unwanted or suspicious email sent through Calder? Let us know so we can investigate."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <p className="lede">
              Forward the email, including its full headers if possible, to{" "}
              <a href="mailto:support@calder.click?subject=Email%20abuse%20report">
                support@calder.click
              </a>
              . Please do not include passwords or other sensitive information.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
