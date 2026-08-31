# Review prompt — hosting the article's images

You are reviewing a **plan, before any code is written**, for a TypeScript + ESM reading app called
Spideryarn. Be adversarial and specific. I would rather you find one thing that would have cost a day
than agree with six things.

## What the app is

Spideryarn ingests a web article or PDF through a seven-stage pipeline and presents it in a
dark-themed reading view with AI assistance. Roughly:

- **Stage 1 `fetch`** — `src/fetch.ts`. Gets the document bytes. Has a real SSRF guard
  (`guardAddress`), manual redirect handling with a re-guard per hop, a byte cap enforced on arriving
  bytes, a WHATWG encoding sniff, typed retryable failures. Refuses anything that is not HTML or PDF
  by content sniffing (`sniffKind`). Writes `data/<slug>/raw.{html,pdf}` + `raw.json`, and pushes the
  same bytes into Supabase Storage.
- **Stage 2 `extract`** — Mozilla Readability for HTML (no model), a vision model for PDF pages.
  Readability absolutises `src`, `srcset` and `poster`, and promotes `data-src` lazy attributes.
- **Stage 3/4 `blocks`/`toc`** — splits into blocks with stable ids (`spya-k3m9qt`) and builds a tree.
  `data/<slug>/blocks.json` holds per-block sanitised HTML. This is what the reader renders.
- Later stages: arc, tweets, glossary, summary, ideas.

Two storage backends behind one interface: a filesystem store (`data/<slug>/`) and Postgres
(one `article_revisions` row, most artefacts a `jsonb` column). Blob bytes go to a **Supabase Storage
bucket named `sources`**, flat and content-addressed at `sha256/<hash>.<ext>`.

Article HTML is sanitised with DOMPurify **twice** — once in Node at stage 3 before storing, once in
the browser at ingress. The shared policy is `src/sanitize-policy.ts`.

## The plan

Read `docs/plans/260829b-hosting-the-articles-images.md` in full. It is the thing under review.

In one line: article images are hot-linked today; the plan adds a pipeline step that downloads them,
stores them content-addressed in the existing `sources` bucket, records a per-article manifest
artefact, serves them from an authenticated route, and rewrites `<img src>` client-side at render
time.

## Files worth opening

- `docs/plans/260829b-hosting-the-articles-images.md` — the plan
- `src/fetch.ts` — `fetchDocument`, `guardAddress`, `isBlockedAddress`, `readCapped`, `sniffKind`,
  `writeRaw`, `RawManifest`
- `src/source.ts` — `canonicalKey`, `stagingKey`, `isStagingKey`, and the header comment explaining
  why content addressing closes a grant-replay hole
- `src/store/blobs.ts` — `RawSourceStore`, `UploadGrants`, `storeRawSource`
- `src/store/blobs-supabase.ts` — the Storage adapter
- `src/sanitize-policy.ts` — especially `isOwnApi`, `ownOrigins`, `stripOwnApiUrls`, `cleanSrcset`
- `src/pipeline.ts` — `STEP_ORDER`, `DEFAULT_INGEST_STEPS`, `STEPS`, `stepIsDone`, `inputHashFor`
- `src/store/artifacts.ts` — `ArtifactKind`, `ArtifactMap`, `SHAPE`, `STAMP_SOURCE`, `ArtifactStore`
- `src/store/artifacts-fs.ts` (`PATHS`, `DECODERS`) and `src/store/artifacts-pg.ts`
  (`STORAGE`, `WholeColumn`, `Site`)
- `src/store/pg-revisions.ts` — `REVISION_CARRY_POLICY`
- `src/routes.ts` — `sendSource` around line 222, and `serveAuthenticatedApi`
- `src/web/TableView.tsx` — the `proseHtml` memo, where the client-side rewrite would go
- `src/web/App.tsx` — where `sanitizeArticle` is called
- `src/web/zoomable.ts` — a recent, very similar html-to-html render-time pass, as a model
- `supabase/config.toml` — the `[storage.buckets.sources]` block
- `docs/postmortems/260828a-the-config-file-is-not-the-bucket.md`
- `docs/project/open-questions.md` — Q11, the light-sheet question this unlocks
- `docs/reusable/silent-success.md` — the failure mode this codebase cares most about

## What I want from you

Answer the six questions in the plan's "Open for Sol" section directly, then add anything else.
Weight these:

1. **Security.** Is the authorisation model right? The plan says the asset route must check both that
   the reader owns the slug *and* that the requested hash appears in that article's own manifest —
   is that sufficient, and is there a cheaper correct design? Is the SVG-with-sandbox-CSP call right,
   or should we refuse to host SVG? Does fetching N page-author-chosen URLs change the SSRF risk
   enough that the known DNS-rebind gap should be closed as part of *this* work rather than noted?

2. **The `fetchDocument` refactor.** The plan proposes splitting the hop loop into an internal
   `fetchBytes` and leaving `fetchDocument` a thin caller, so image fetching reuses the address guard
   and redirect handling. That is surgery on the most security-sensitive file in the repo. Is it the
   right call, and if so what specifically must not be allowed to change?

3. **Silent failure.** The plan lists nine traps. Which of them is wrong, and — much more useful —
   what is the tenth? Concretely: what could ship where every test is green, the logs are clean, and
   images are still being hot-linked or are quietly broken? This codebase's whole culture is that the
   dangerous bug is the one whose obvious check agrees with it.

4. **Cost.** Adding a pipeline artefact touches 13+ places here. Is a whole new artefact justified,
   or should the URL-to-hash map ride on something that already exists? What would you actually do?

5. **Scope.** Is anything in this plan premature, or missing? The corpus is small — 3 articles with
   images, 13 images, 2.46 MB — so tell me where the plan is over-built for the evidence, and equally
   where a limit or guard has been picked from thin air rather than from a measurement.

## Ground rules

- The plan is a plan. Judge the design, not the prose.
- Do not propose new frameworks or dependencies beyond what is discussed. "Prefer boring" is a stated
  project principle; the existing exceptions are Postgres and shadcn/Tailwind.
- Where you disagree, say what you would do instead, concretely enough to implement.
- If a claim in the plan is factually wrong about this codebase, say so and cite the file.
- Rank your findings by how much time they would save. Say explicitly if you think a section is fine.
