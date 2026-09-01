# Review this plan before it is built

You are reviewing a planning doc for the Spideryarn codebase (TypeScript + ESM, React web client,
single hand-rolled HTTP router, Postgres via Drizzle, Supabase Storage, deployed to Vercel).

The job: add an "Export" button to the article Metadata page that downloads a zip of all of that
article's data. Read the plan at `docs/plans/260901h-export-article-data.md`.

Then read, at minimum:
- `src/store/export.ts` — the existing CLI rollback exporter the plan proposes to generalise.
  Pay close attention to `exportArticle`, the local `put()` closure, `ARTICLE_TABLE_COVERAGE`,
  `writeRawDocument`, and the `stampedHtml` write to `outputRoot`.
- `tests/store-export-covers-tables.test.ts` — the coverage guard the whole design is built around.
- `src/routes.ts` — `sendSource` (~L417), `contentDisposition` (~L504), `slugPart` (~L3572),
  `handleApi`/`serveAuthenticatedApi` (~L5055/5359) for the auth and owner-scoping model.
- `src/owner.ts` and `ownedSlug` in `src/store/pg.ts` — the owner-isolation predicate.
- `src/web/Metadata.tsx` and `src/web/SourceLink.tsx` — where the button goes and the only existing
  blob-download idiom.
- `src/db/schema.ts` — to judge whether the plan's list of what it exports and what it omits is
  actually complete.

## The questions I most want answered

1. **Is the central decision right?** The plan refactors `exportArticle` to take an `ExportSink`
   instead of an `ExportTarget`, so the CLI rollback and the new HTTP download are ONE code path
   and are both covered by the existing coverage test. The rejected alternative was a standalone
   `export-bundle.ts` that queries what it wants. Is the sink refactor as mechanical as the plan
   claims — does every gathered value really pass through `put()`, or are there escapes I have
   missed beyond `writeRawDocument` and `stampedHtml`? Is there a third option better than both?

2. **Security.** The route is `GET /api/export/:slug` returning every row belonging to that article.
   Is owner isolation genuinely inherited from `ownedSlug()` inside `exportArticle`, or does the
   route need its own check? Is there any way for this endpoint to return another owner's data, or
   to be reached through the unauthenticated `/api/public/` namespace? Does anything in the bundle
   leak reader-global state (`reader_profiles`) or another party's data? Are there injection or
   content-type concerns in serving reader-controlled HTML back as part of a zip?

3. **What the plan gets factually wrong** about this codebase. I built it from subagent research;
   check the specific claims — file paths, line numbers, which table backs which feature, whether
   `fflate` is a sane choice here, whether an in-memory zip is safe given Vercel Fluid Compute
   response-size limits (the plan assumes it is, since the bundle is text-only).

4. **Completeness.** Given `src/db/schema.ts`, is anything a reader would call "my data for this
   article" missing from both the export and the plan's explicit "deliberately not doing" list?
   The omissions are: image/asset bytes, the original PDF/HTML, older revisions, `ai_calls`,
   `feedback`/`uploads`, whole-library export. Are any of those wrong to omit?

5. **Staging.** Six stages, A–F. Is each a genuine safe stopping point where the tree is
   committable and deployable? Is the order right? Is anything missing a test that would catch a
   silent success — an export that reports success while writing nothing?

Be specific and cite files and lines. Say plainly where the plan is wrong, and where you would
build it differently. If you think the whole approach is misconceived, say so first.
