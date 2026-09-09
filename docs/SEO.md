# Calder SEO System

Canonical domain: **https://calder.click** (no www, https only, no trailing slash).

## Architecture

| Piece           | Location                                                 | Rule                                                                                                                                        |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sitemap         | `apps/web/app/sitemap.ts`                                | Static public routes only; never dashboard/login/API/admin; `lastmod` = content change date, never deploy date                              |
| Robots          | `apps/web/app/robots.ts`                                 | Allow `/`, disallow `/api/`, dashboard paths, `_next/`; sitemap pointer; AI crawlers (OAI-SearchBot, Bingbot, Googlebot) explicitly allowed |
| Metadata        | `apps/web/lib/seo.ts` (`pageMeta()`)                     | Every public page: title, description, canonical, OG, Twitter. New pages must use the helper                                                |
| Structured data | `apps/web/lib/seo.ts` (`orgJsonLd()`, `articleJsonLd()`) | Organization + WebSite on home; Article on posts. No invented ratings                                                                       |
| Machine index   | `public/llms.txt` (+ `public/docs/llms*.txt` deep docs)  | Hand-maintained alongside docs; never secrets                                                                                               |
| Validation      | `scripts/seo-check.mjs`                                  | Fails on missing metadata, sitemap drift, missing og:image, missing canonicals on key pages                                                 |

## URL design

Lowercase, hyphenated, stable: `/docs/smtp`, `/alternatives/resend`, `/resources/glossary/dkim`.
Old blog slug (`hello-avenor`) 301s to the new one — see Redirect registry below.

## Redirect registry

| From                            | To                   | Why          |
| ------------------------------- | -------------------- | ------------ |
| `/blog/hello-avenor`            | `/blog/hello-calder` | Rebrand slug |
| _(add rows here, never chains)_ |                      |              |

## Internal linking

Homepage → product → docs → glossary → comparisons → signup. Every pillar links
down to guides; every guide links up to its pillar and sideways to siblings.
Glossary terms link back into docs usage. No stuffed footer links.

## Content architecture (what exists, by cluster)

- **Brand:** `/`, `/about`, `/what-is-calder`, `/brand`, `/blog`, `/changelog`, `/status`
- **Product:** `/pricing`, `/templates`, `/webhooks`, `/domains`, `/developers`, `/product/*` (as built)
- **Docs (rank-eligible):** `/docs/*` quickstarts + guides
- **Comparisons:** `/alternatives/resend` (honest, dated; more only with real research)
- **Glossary:** `/resources/glossary/*` (6 terms; expand only with original definitions)
- **Tools:** none yet — pricing calculator + DNS checker specced as next builds (real tools only)

## AI discoverability

Entity consistency (name/description/logo/domain identical everywhere) +
crawlability (robots allows OAI-SearchBot/Bingbot/Googlebot; same content for
humans and crawlers) + `/what-is-calder` as the canonical answer +
`/llms.txt` as the machine index. No crawler-specific content, no manipulation.

## Measurement (needs human)

Claim Search Console + Bing Webmaster Tools, submit sitemap, watch: branded vs
non-branded impressions, comparison-page traffic, docs traffic, signup
attribution. Monthly report cadence once data exists. Verification meta slots
live in `lib/seo.ts` (`verification` field) — paste tokens, never commit secrets.

## Sitemap index (future)

Single `sitemap.xml` until ~500 URLs, then split: pages/docs/blog/guides/
glossary/tools/comparisons/alternatives. Only canonical, indexable, public URLs.
