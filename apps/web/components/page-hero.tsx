import { Reveal } from "./reveal";

interface PageHeroProps {
 eyebrow: string;
 title: React.ReactNode;
 lede: string;
}

/** Shared inner-page hero: eyebrow, display title, lede. */
export function PageHero({ eyebrow, title, lede }: PageHeroProps) {
 return (
 <section className="page-hero">
 <div className="wrap">
 <Reveal>
 <p className="eyebrow">{eyebrow}</p>
 <h1 className="display page-title">{title}</h1>
 <p className="lede" style={{ marginTop: "1.4rem" }}>
 {lede}
 </p>
 </Reveal>
 </div>
 </section>
 );
}
