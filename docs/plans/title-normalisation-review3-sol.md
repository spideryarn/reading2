CHANGES REQUESTED

Blockers

1. The server still does not predict two earlier rewrites.

   - `/read/a?slug=b`: the server loads and titles `a` ([vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:321)); `main.tsx` accepts `slug=b` on any pathname and rewrites to `/read/b` ([main.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/main.tsx:198)).
   - `/read/a?add=https://example.com/x`: the server titles `a`; `canonicalAddHref` accepts `?add=` outside `/` and rewrites to `/add/...` ([router.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/router.ts:442)). I confirmed that exact input returns `/add/https%3A%2F%2Fexample.com%2Fx`.

   These are sixth and seventh divergences. Both happen before `parseRoute`, so React renders a different article—or a different kind of page—from the one the server titled. The docs describe the legacy entrances specifically as `/?slug=` and `/?add=` ([url-state.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/url-state.md:229)); constraining them to `/` looks like the smaller fix.

2. `not-shared` is incorrectly treated as “ready”.

   `ArticlePage` maps every non-error, non-slow-loading state to `ready` ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:602)). `articleWaitTitle("ready")` yields ownership, but `NotSharedPage` sets no title ([PublicChrome.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicChrome.tsx:193)).

   After SPA navigation to an unavailable article, the tab therefore remains the previous article when fast, or `Loading…` indefinitely when slow. The second comparison guard is sound; the missing terminal state is the fault.

3. A renamed public article still changes title for its owner.

   The public head deliberately excludes the private title override, while the owned payload deliberately applies it ([public-reader.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:23), [api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:914)). Thus an owner hard-loading their renamed public article gets:

   `extracted title` → `private override`

   The existing PG fixture already proves those values differ ([public-visibility-pg.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-visibility-pg.test.ts:725)). This may be the necessary security tradeoff, but it contradicts the unqualified “tab does not change” guarantee. It needs an explicit accepted exception and test, or different tab semantics—never disclosure of the private rename in the public head.

Direct answers

- `redirectsToMetadata` and the strip agree for valid composed `/read/<slug>` addresses. `about=0` is cleaned but does not redirect, correctly.
- The `articleWaitTitle` equality guard behaves correctly for mode changes, legacy metadata addresses, and back navigation. Its problem is the omitted `not-shared` outcome.
- Moving `ArticleView` and `VIEW_LABEL` introduces no behavioural change.
- Nit: `viewFor` documents a query-string input, but production passes the full restored URL ([vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:341)). It works only because today’s regex scans for `?`/`&`; the tests use the documented input shape.
- Not fit to commit yet.

Focused validation: 116 tests passed across three relevant files. `public-read-rewrite.test.ts` failed during collection on the unrelated shared-tree `GUARDED` initialization error.