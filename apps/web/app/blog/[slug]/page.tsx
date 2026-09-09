import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { Reveal } from "../../../components/reveal";
import { POSTS, getPost } from "../posts";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = getPost(params.slug);
  if (!post) return {};
  return { title: `${post.title} — Calder Blog`, description: post.description };
}

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();
  // Registry-driven import: one MDX file per slug, same name as the folder entry.
  const { default: Body } = await import(`../posts/${post.slug}.mdx`);

  return (
    <>
      <Navigation />
      <main>
        <section className="section">
          <div className="wrap" style={{ maxWidth: 720 }}>
            <Reveal>
              <p className="eyebrow">
                {post.date} · {post.readTime}
              </p>
              <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>
                {post.title}
              </h1>
            </Reveal>
            <Reveal delay={100}>
              <div className="docs-main" style={{ maxWidth: "100%" }}>
                <Body />
                <p style={{ marginTop: "2rem" }}>
                  <Link href="/waitlist">Get a test key</Link> and watch your first email travel the
                  whole pipeline. That&rsquo;s the whole pitch.
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
