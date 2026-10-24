You are reviewing a plan before it is built, in the Spideryarn repo (read CLAUDE.md for house rules). Read-only review.

The plan: docs/plans/261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address.md

Evidence to check it against:
- src/extract.ts § publicationDate and runExtract (where meta.publishedAt is set; stage 2)
- src/front-matter-authors.ts § pageOpening / readOpening (the opening records the dateline reader would scan)
- src/bibliographic.ts § realIsoDay, plausibleYear
- src/types.ts Meta.publishedAt comment; src/source-hash.ts datedArticleFingerprint
- src/matter.ts the evidence check (the `furniture` rule around line 790) — the plan defers a fix here
- tests/publication-date.test.ts
- docs/project/content-extraction.md § The journal and the publication day, from a registry; docs/project/front-and-back-matter.md

Production facts (already read, read-only): the article's current revision has published_at and published_year null; its matter is one stretch, kinds [title, dates], covering block "2025-11-02" (a <p>) and a <figure> captioned "One chonky MCP server". The page has no date meta tags or JSON-LD; its markup under the <h1> is `<p class="text-xs italic">2025-11-02</p>` then the figure.

Questions: Is the approach right and the simplest that works? Any way it produces a wrong date silently (silent-success class)? Is the dateline reader's scan of pageOpening sound (does the h1 record come first; what if no h1)? Is the address reader too eager (e.g. URLs whose dated segment is not a publication date)? Is deferring the matter-check fix defensible, and is "no question to Greg" right? Anything missed on freshness/fingerprints or the registry path (article-registry.ts only fills when publishedAt is undefined — does order matter now)?

Answer with numbered findings, each with severity (blocker/should/nit), evidence (file:line) and a concrete change. End with a verdict: approve / approve with changes / rework.
