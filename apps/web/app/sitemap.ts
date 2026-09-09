import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";
import { POSTS } from "./blog/posts";

/**
 * Sitemap: canonical, indexable, public URLs only. Never dashboard, login,
 * API, invite, or auth routes. lastmod = content change date (update the row
 * when the page meaningfully changes — never the deploy date).
 */
interface Entry {
  path: string;
  lastmod: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
}

const STATIC: Entry[] = [
  { path: "/", lastmod: "2026-09-08", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", lastmod: "2026-09-08", changeFrequency: "monthly", priority: 0.9 },
  { path: "/developers", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.8 },
  { path: "/templates", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.7 },
  { path: "/webhooks", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.7 },
  { path: "/domains", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.7 },
  { path: "/waitlist", lastmod: "2026-09-07", changeFrequency: "monthly", priority: 0.8 },
  { path: "/about", lastmod: "2026-09-06", changeFrequency: "yearly", priority: 0.6 },
  { path: "/what-is-calder", lastmod: "2026-09-08", changeFrequency: "monthly", priority: 0.8 },
  { path: "/blog", lastmod: "2026-09-06", changeFrequency: "weekly", priority: 0.7 },
  { path: "/changelog", lastmod: "2026-09-06", changeFrequency: "weekly", priority: 0.5 },
  { path: "/security", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/status", lastmod: "2026-09-06", changeFrequency: "weekly", priority: 0.5 },
  { path: "/support", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.5 },
  { path: "/brand", lastmod: "2026-09-06", changeFrequency: "yearly", priority: 0.4 },
  { path: "/migrate", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  {
    path: "/alternatives/resend",
    lastmod: "2026-09-08",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { path: "/resources/glossary", lastmod: "2026-09-08", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs", lastmod: "2026-09-06", changeFrequency: "weekly", priority: 0.8 },
  {
    path: "/docs/quickstart/nodejs",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/docs/quickstart/python",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/docs/quickstart/go", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  {
    path: "/docs/quickstart/php",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/docs/quickstart/ruby",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/docs/quickstart/curl",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/docs/quickstart/cli",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/docs/gmail-quickstart",
    lastmod: "2026-09-08",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/docs/sending", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/smtp", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/domains", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/api-keys", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/webhooks", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/idempotency", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/suppression", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/usage-billing", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/templates", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.4 },
  { path: "/docs/otp", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.4 },
  { path: "/legal/privacy", lastmod: "2026-09-06", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/terms", lastmod: "2026-09-06", changeFrequency: "yearly", priority: 0.3 },
  { path: "/docs/concepts", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.6 },
  { path: "/docs/api-reference", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/docs/deliverability",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  { path: "/docs/examples", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.5 },
  { path: "/docs/security", lastmod: "2026-09-06", changeFrequency: "monthly", priority: 0.5 },
  {
    path: "/docs/migrate-resend",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/docs/migrate-postmark",
    lastmod: "2026-09-06",
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/email-api",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/smtp",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/transactional-email",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/deliverability",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/webhook",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/resources/glossary/idempotency",
    lastmod: "2026-09-08",
    changeFrequency: "yearly",
    priority: 0.5,
  },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const blog = POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date("2026-09-06"),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [
    ...STATIC.map((e) => ({
      url: `${SITE_URL}${e.path}`,
      lastModified: new Date(e.lastmod),
      changeFrequency: e.changeFrequency,
      priority: e.priority,
    })),
    ...blog,
  ];
}
