import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "../../../../components/navigation";
import { Footer } from "../../../../components/closing";
import { Reveal } from "../../../../components/reveal";
import { pageMeta } from "../../../../lib/seo";
import { TERMS, getTerm } from "../terms";

export function generateStaticParams() {
 return TERMS.map((t) => ({ term: t.slug }));
}

export async function generateMetadata({
 params,
}: {
 params: { term: string };
}): Promise<Metadata> {
 const term = getTerm(params.term);
 if (!term) return {};
 return pageMeta({
 title: `${term.term}, Glossary`,
 description: term.short,
 path: `/resources/glossary/${term.slug}`,
 });
}

export default function GlossaryTerm({ params }: { params: { term: string } }) {
 const term = getTerm(params.term);
 if (!term) notFound();

 return (
 <>
 <Navigation />
 <main>
 <section className="section">
 <div className="wrap" style={{ maxWidth: 720 }}>
 <Reveal>
 <p className="eyebrow">Glossary</p>
 <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5vw, 3.4rem)" }}>
 {term.term}
 </h1>
 <p className="lede" style={{ marginTop: "1rem" }}>
 {term.short}
 </p>
 </Reveal>
 <Reveal delay={100}>
 <div className="docs-main" style={{ maxWidth: "100%" }}>
 {term.definition.map((p, i) => (
 <p key={i}>{p}</p>
 ))}
 <div className="docs-note">
 <strong>In Calder:</strong>{" "}
 <Link href={term.calderLink.href}>{term.calderLink.label}</Link>
 </div>
 <h3>Related terms</h3>
 <p>
 {term.related.map((slug, i) => {
 const rel = TERMS.find((t) => t.slug === slug);
 if (!rel) return null;
 return (
 <span key={slug}>
 {i > 0 && " · "}
 <Link href={`/resources/glossary/${slug}`}>{rel.term}</Link>
 </span>
 );
 })}
 </p>
 </div>
 </Reveal>
 </div>
 </section>
 </main>
 <Footer />
 </>
 );
}
