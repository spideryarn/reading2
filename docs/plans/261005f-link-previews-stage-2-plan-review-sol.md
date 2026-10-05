No P0 findings. The design is workable, with these changes.

1. **P1 — The deployment check is not a deployment gate.**  
   The plan relies on deployed checks to resolve its Vercel assumptions, but [`scripts/deploy.ts:1549`](/tmp/spideryarn-wt/seo-own-pages-and-cards/scripts/deploy.ts:1549) never invokes `check-public-shell.ts`. That checker also exits successfully when required checks were skipped ([line 1453](/tmp/spideryarn-wt/seo-own-pages-and-cards/scripts/check-public-shell.ts:1453)).

   **Change:** explicitly wire the expanded checker into deployment verification on the production custom domain. Require a public article fixture and fail when essential checks skip. Check every listed page, `/read/public`, an article, an app path, an API path, and direct requests to the generated HTML files.

2. **P2 — The shell migration misses an existing consumer and fixtures.**  
   [`scripts/check-two-builds.ts:189`](/tmp/spideryarn-wt/seo-own-pages-and-cards/scripts/check-two-builds.ts:189) serves `index.html` as the fallback shell and describes that as production behaviour. Its build command invokes Vite directly, bypassing an additional npm build step. Existing fixtures also write the shell to `index.html`: [`tests/client-shell.test.ts:56`](/tmp/spideryarn-wt/seo-own-pages-and-cards/tests/client-shell.test.ts:56) and [`tests/knip-without-build-output.test.ts:200`](/tmp/spideryarn-wt/seo-own-pages-and-cards/tests/knip-without-build-output.test.ts:200).

   **Change:** include these in the migration. Add a regression fixture containing both a homepage `index.html` and a default `shell.html`, with the same commit stamp, and prove the API embeds the latter. Strengthen `assertShellShape` to reject an indexable marketing head; its current checks establish markers and built assets, not default-head semantics ([line 89](/tmp/spideryarn-wt/seo-own-pages-and-cards/scripts/client-shell.ts:89)).

3. **P2 — Exact robots rules omit common forms of marketing links.**  
   `Allow: /pricing$` permits `/pricing`, but blocks `/pricing?utm_source=x` and `/pricing/`. The router accepts trailing slashes ([`router.ts:501`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/web/router.ts:501)). Google’s `$` matching includes the query-bearing URL, so this is a real difference from Vercel’s pathname matching. [Google’s matching specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec).

   **Change:** define the policy for these forms. Allow query-bearing versions of each listed page, retaining the query-free canonical. Redirect trailing-slash marketing URLs to their canonical paths and permit crawlers to fetch those redirects. Test both forms without opening unrelated descendants.

4. **P2 — `/read/public` becomes crawlable without being named in the scope change.**  
   `Allow: /read/` includes the public shelf and every nested reading path. `/read/public` is explicitly a separate page ([`router.ts:571`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/web/router.ts:571)); the server returns its default shell with status 200 ([`page.ts:231`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/public/page.ts:231)).

   **Change:** explicitly name the public shelf as newly crawlable but still `noindex`, and test that contract. This is consistent with letting crawlers read its exclusion. If shelf crawling is unwanted, add precise exclusions covering its bare, query-bearing and trailing-slash forms; avoid a prefix exclusion that also blocks article slugs such as `public-interest`.

5. **P2 — Composer tests alone cannot prove the lead image reaches the head.**  
   The current head projection selects no image manifest ([`public-reader.ts:467`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/store/public-reader.ts:467)), and `loadHead` returns only five fields ([line 995](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/store/public-reader.ts:995)). The real-database test pins that exact key set ([`public-visibility-pg.test.ts:983`](/tmp/spideryarn-wt/seo-own-pages-and-cards/tests/public-visibility-pg.test.ts:983)).

   **Change:** add a failing database-to-head test before implementation: a shared revision with an eligible stored image must produce its public image URL; private and unsuitable cases must not. Return narrowly selected image metadata, rather than the whole manifest containing publisher URLs.

6. **P3 — Search crawlers remain blocked from branding assets.**  
   The proposed wildcard group allows `/assets/`, but neither `/og-card.png` nor the root favicon files referenced by [`index.html:124`](/tmp/spideryarn-wt/seo-own-pages-and-cards/index.html:124). Google requires its image crawler to fetch the favicon for search-result eligibility. [Google’s favicon requirements](https://developers.google.com/search/docs/appearance/favicon-in-search).

   **Change:** add exact allowances for the branding files intended for search presentation, with tests. Keep article asset APIs restricted to the preview group as proposed.

7. **P3 — The byte floor is a heuristic, and the reference-doc update is missing.**  
   Twenty kilobytes does not establish useful dimensions: metadata can inflate a small image, while compression can make a large image small. There is already an [`imageDimensions` helper](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/assets.ts:869).

   **Change:** describe the floor as a temporary heuristic, explicitly accepting small-image false positives and large-image false negatives. If reliable filtering is required, persist optional dimensions during ingest using that helper; avoid image downloads during head requests. Also update [`deployment.md:586`](/tmp/spideryarn-wt/seo-own-pages-and-cards/docs/project/deployment.md:586), [`public-readable-sharing.md:45`](/tmp/spideryarn-wt/seo-own-pages-and-cards/docs/project/public-readable-sharing.md:45), and [`page-titles.md:343`](/tmp/spideryarn-wt/seo-own-pages-and-cards/docs/project/page-titles.md:343), which currently describe blanket exclusions, unread canonicals, and brand-only pictures.

The three Vercel assumptions are supported. Filesystem matches precede rewrites, supporting the homepage `index.html`; rewrites to static `.html` files are explicitly documented. Wrapped negative lookaheads are supported too. [Vercel configuration documentation](https://vercel.com/docs/project-configuration/vercel-json#rewrites). However, `headers.source` is compiled through `path-to-regexp`, with strict and case-sensitive options—it is not an arbitrary plain regex. The proposed `/((?!(?:pricing|help)?$).*)` fits that syntax. Test the actual Vercel converter instead of only `new RegExp(source)`. [Vercel’s converter implementation](https://github.com/vercel/vercel/blob/main/packages/routing-utils/src/superstatic.ts).

The shared-article indexing reasoning is correct for engines supporting `noindex`: a disallowed URL can still be listed, and the crawler must fetch it to see the exclusion. Restricting `/read/` permission to named search bots would reduce crawler access, but would leave other indexers with the same bare-URL problem. [Google’s noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

The public image route is a sound choice: it rechecks sharing and manifest membership before reading storage ([`public-reader.ts:1042`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/store/public-reader.ts:1042)), supports HEAD, and preserves `no-store`. Entries are explicitly reordered into document order after concurrent fetching ([`collect-assets.ts:1190`](/tmp/spideryarn-wt/seo-own-pages-and-cards/src/collect-assets.ts:1190)). Use the existing `publicAssetPath` builder and escape the resulting absolute URL.

Beyond the public shelf, I found no additional private shelf, profile, admin or non-asset API access opened by the design. All files were left unedited.

VERDICT: approve with changes