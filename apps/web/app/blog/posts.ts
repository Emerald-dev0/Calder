/**
 * Blog registry: adding a post = one entry here + one .mdx file in
 * app/blog/posts/. The index, RSS-shaped metadata, and waitlist-broadcast
 * copy all read from this single source. No JSX edits per post.
 */
export interface PostMeta {
 slug: string;
 title: string;
 description: string;
 date: string;
 /** ISO date for structured data. Update when the post meaningfully changes. */
 published: string;
 readTime: string;
 excerpt: string;
}

export const POSTS: PostMeta[] = [
 {
 slug: "hello-calder",
 title: "Hello, Calder: why transactional email deserves its own company",
 description: "Why transactional email deserves its own infrastructure company.",
 date: "September 2026",
 published: "2026-09-06",
 readTime: "4 min",
 excerpt:
 "Sending an email is easy. Knowing it arrived is the whole business, and why we said no to newsletters, yes to idempotency, and maybe to naira pricing.",
 },
];

export function getPost(slug: string): PostMeta | undefined {
 return POSTS.find((p) => p.slug === slug);
}
