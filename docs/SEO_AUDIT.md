# SEO Audit — Calder (calder.click)

Date: 2026-09-08. Method: source inspection (no crawler, no Search Console access yet).
Scale: P0 = blocks indexing, P1 = meaningful loss, P2 = polish.

## Findings

| #   | Problem                                            | Severity | Impact                                               | Fix                                                             | Status                             |
| --- | -------------------------------------------------- | -------- | ---------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| 1   | No sitemap.xml                                     | P0       | Crawlers discover pages slowly/incompletely          | `app/sitemap.ts` from route registry                            | DONE this pass                     |
| 2   | No robots.txt                                      | P0       | No crawl guidance, no sitemap pointer                | `app/robots.ts`                                                 | DONE this pass                     |
| 3   | No canonical URLs anywhere                         | P1       | Duplicate-content risk (www, trailing slash, params) | `lib/seo.ts` canonical helper, wired on key pages               | DONE (pattern documented for rest) |
| 4   | OG/Twitter only on root layout, no og:image        | P1       | Link shares render bare                              | Generated `og-image.png` + per-page OG via helper               | DONE this pass                     |
| 5   | Zero JSON-LD                                       | P1       | Weak entity grounding for AI + rich results          | Organization + WebSite (home), Article (posts)                  | DONE this pass                     |
| 6   | No llms.txt at root (only nested docs copy)        | P1       | AI crawlers look at `/llms.txt` by convention        | `public/llms.txt`                                               | DONE this pass                     |
| 7   | No comparison/alternative pages                    | P1       | Zero capture on high-intent queries                  | `/alternatives/resend` (honest, dated)                          | DONE this pass                     |
| 8   | No glossary                                        | P2       | Missing definitional queries + internal-link hub     | `/resources/glossary` + 6 terms                                 | DONE this pass                     |
| 9   | No what-is-calder entity page                      | P1       | AI grounding + brand queries                         | `/what-is-calder`                                               | DONE this pass                     |
| 10  | 1/45 pages missing metadata export                 | P2       | One untitled tab in the wild                         | Identified; fixed as found                                      | DONE (44/45 → 45/45)               |
| 11  | No Search Console/Bing verification hooks          | P1       | Can't measure anything                               | Verification meta slots documented; owner must claim property   | DOCS only — needs human            |
| 12  | No SEO CI checks                                   | P2       | Regressions silent                                   | `scripts/seo-check.mjs` (metadata/sitemap/llms/canonical)       | DONE this pass                     |
| 13  | Images: check alt coverage on illustrative `<img>` | P2       | Accessibility + image search                         | Audited; decorative SVGs already aria-hidden                    | DONE                               |
| 14  | Redirect registry                                  | P2       | Link rot as URLs evolve                              | Old blog slug redirect exists; registry section in SEO.md       | DONE (pattern)                     |
| 15  | No programmatic sitemap index                      | P2       | Needed at scale, not at 50 URLs                      | Single sitemap now; index architecture documented for >500 URLs | DEFERRED by design                 |

## Deliberately NOT done (with reasons)

- City/geo doorway pages (`/email-api-lagos` clones): abusive pattern, refused.
- Mass tutorial generation: docs quickstarts already rank-eligible; no duplicate spin-offs.
- Fake reviews/ratings schema, invented stats, backlink schemes: refused outright.
- Keyword-stuffed footer links: internal links are navigational, not stuffed.
