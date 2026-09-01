# Export one article's data, from a button on the Metadata page

**Status:** revised 2026-09-01 after GPT Sol's review
([260901h-…-review-sol.md](260901h-export-article-data-review-sol.md)), which refuted the first
version's central design. No code written yet. The rewrite below is what to build.

## What Greg asked for

> Let's add an Export button somewhere, perhaps in Metadata, that exports all the data for an
> article. Check we don't already have this. It can exclude the original PDF/HTML itself (because
> that's easy to get otherwise). It should include the Spideryarn-ingested version of the HTML +
> images/assets/etc. Plus include all the various input + augmentations added on the site,
> e.g. Hierarchy, Summary, Glossary, Chats, Diagrams, Comments, etc etc. If anything is
> particularly tricky, defer it.
>
> — Greg, 2026-09-01

Asked what the file is for and what to cut from v1, he said include **everything** but leave out the
**binary asset bytes**, and:

> perhaps also with a human-readable index .html, and/or a .md describing the data for agents
> writing code to import it
>
> — Greg, 2026-09-01

## Do we already have this? Half of it, and it is the wrong half

`npm run db:export` ([`src/store/export.ts`](../../src/store/export.ts)) already walks one article
across every table. But it is **the rollback**: a CLI needing a service-role key, writing
`data/<slug>/` to disk, in the filesystem store's internal layout. No reader can reach it, and the
web app has no download path except the original-PDF route.

## What the review changed, and why the first design was wrong

The first version of this plan proposed making `exportArticle`'s *destination* an argument — one
`ExportSink` interface, a file sink for the rollback and a zip sink for the download, so both shared
one code path and one coverage test.

An audit of all 951 lines confirmed the narrow claim: there is no write outside `put()`,
`writeRawDocument()` and the `stampedHtml` line. **But that was the wrong claim to check.** Sol's
review made the point that matters, and the code confirms it on every count:

`exportArticle` does not gather an article — it **projects one into a legacy format**, and that
format is *pinned byte-for-byte* by `tests/store-roundtrip.test.ts`, which compares it against what
the filesystem store writes. So the projection is deliberately lossy and **cannot be enriched in
place**:

- **`extractedHtml` is never written at all** — `grep extractedHtml src/store/export.ts` returns
  nothing, while the proposed bundle layout promised `content/extracted.html`.
- **A `candidates` chat thread is exported as `chat`.** The code comment says emitting the real kind
  was tried and reverted, *because the roundtrip test compares bytes*. A reader's Candidates thread
  would silently come back as an ordinary chat.
- **`passages` and `interrupted` are dropped** from every chat message.
- Article identity and sharing state — `shortId`, `createdAt`, `visibility`, `publicAt` — never
  reach a file.

A shared sink would have inherited every one of these into a brand-new user-facing format, and the
roundtrip test would have blocked fixing them. **The rollback's data model is not "my article
data", and must not become its definition.**

Two more findings from the review, both verified in the source:

- **The bucket read is not avoidable by a no-op.** `writeRawDocument` calls `readRawDocument(...)`
  *before* it writes anything (export.ts:349), so a zip sink whose `rawDocument()` did nothing would
  still have paid for the bucket fetch. The "no bucket access at all" claim would have been false.
- **The coverage test is table-level, not column-level.** It cannot see a dropped column, the
  `candidates` collapse, or a sink that receives a `put()` and discards it. My proposed zip
  assertion — "every table in `ExportResult.tables` lands somewhere" — was *weaker* than the
  existing sentinel test, because `tables` records that a call happened, not that data survived.

## The design, and where it differs from the review

Sol's remedy was a middle layer of "typed logical entries" that both renderers project from.
**Taking the diagnosis, but a simpler remedy:** share the **queries**, not a synthesized model.

```
                  readArticleRows(slug)        ← one owner-scoped data walk
                  typed Drizzle rows, faithful
                   ↓                    ↓
      legacy projection            bundle projection
      (unchanged rollback)         (the new zip)
```

`readArticleRows(slug): ArticleRows` returns the raw rows for the article, its current revision and
the nine child tables — the ordering (`order by ordinal` on blocks is the whole ballgame; ids carry
no position), the joins, and `ownedSlug()` in one place. `exportArticle` keeps its existing
projection code *verbatim*, now reading from those rows, so byte-for-byte parity is preserved by
construction rather than by care. The bundle writes its own, faithful projection.

Why not Sol's intermediate model: it would have to be rich enough for the bundle *and* lossily
projectable to the pinned legacy format — real design work whose only output is a second
representation of rows we already have. **The raw rows are already the faithful representation.**
Fewer parts touching each other; the shared thing is the part worth sharing.

**What this costs, honestly:** the coverage guard now has to attach to the query layer rather than
to `put()`. That is Stage B's job and it is the riskiest part of this plan.

## Decisions

- **Size: buffer, and refuse loudly.** Vercel caps a buffered response body at **4.5 MB**
  ([limits](https://vercel.com/docs/functions/limitations)); streaming is the documented escape.
  Measured over the local database: the largest article (`scaling-hypothesis`, 12.6k words) is
  1.01 MB uncompressed, **307 KB gzipped** — 7% of the cap; median 165 KB. So buffering is right for
  v1. But Sol is correct that **a warning log is not a guard-rail — the reader's request still
  fails**. So: assemble, and if the result exceeds the cap, return a **readable 413** saying the
  article is too large to export, with a test that exercises that path. Streaming is the named fix
  if it ever fires. Note stored HTML artefacts may be up to 32 MiB, so this is not hypothetical.
- **`zip()`, not `zipSync()`.** fflate's own docs recommend the async API beyond one file, and
  `zipSync` blocks the event loop while holding sources, encoded bytes and output at once.
- **Name it what it is.** Older revisions and spend records stay out, so the manifest calls this a
  **current-article snapshot**, not "all your data". A `format` version in the manifest from day one.
- **Not behind the `experimental` flag.** Nothing sits behind it today and being first carries
  obligations ([experimental-features.md](../project/experimental-features.md)). Export is small,
  read-only and finished. Flagged for Greg to overrule.

## Corrections to fold in (all verified in the source)

- `contentDisposition(filename)` takes **one argument and always returns `inline`**
  (routes.ts:504) — deliberately, for the PDF route. It needs a second parameter, and a test that
  the PDF route stays `inline`.
- `ownedSlug` lives in [`src/store/owned-slug.ts`](../../src/store/owned-slug.ts), not `pg.ts`.
- `exportArticle` throws a plain `Error` for another owner's slug (export.ts:461), which the route
  would turn into a **500 rather than a 404**. Needs a typed not-found.
- `hasShelfRow` is **UI/load state, not an ownership gate** — ownership is settled server-side. Fine
  to gate the button's display on it; wrong to describe it as the check.
- Revisions do have lineage (`basedOnRevisionId`, timestamps), so "history would mean inventing it"
  was false. Omitting older revisions is a **deliberate product choice**, and the manifest says so.
- `DeleteArticle` starts around Metadata.tsx:1234.

## The stages

Ordered as the review recommended: the data contract first, docs before the button, UI last.

**Stage A — `readArticleRows`, with the rollback unchanged.**
- [ ] Extract the owner-scoped queries into `readArticleRows(slug)` returning typed rows; add a
      typed `ArticleNotFound`. `exportArticle` keeps its projection, now fed from it.
- [ ] Done when `REQUIRE_POSTGRES=1 npm test` is green — the DB half must have *run*, not skipped.
      Baseline captured before touching anything: 8 tests pass.

**Stage B — move the guard to the query layer, and prove data survives.**
- [ ] Coverage declaration attaches to `readArticleRows`, so a new table fails the test on the day
      it lands, for both outputs.
- [ ] **Run the same sentinel fixtures through both projections** and grep each declared destination
      for its sentinel — Sol's suggestion, and stronger than what either had. A projection that
      receives a row and discards it must go red.
- [ ] Fidelity tests for the specific losses found: chat `kind` survives as `candidates`,
      `passages` and `interrupted` survive, `extractedHtml` is present.

**Stage C — the bundle.** `src/store/export-bundle.ts`, `fflate`, no bucket access.
- [ ] `manifest.json` (slug, title, url, exportedAt, `format`, entry list, and machine-readable
      omissions), `article.json` (identity + shelf + sharing state), `content/` (`stamped.html`,
      `extracted.html`, `blocks.json`, `block-identities.json`, `assets.json`), `augmentations/`
      (tree, arc, tweets, glossary, glossary-lookups, ideas, quotes, timeline, quiz, sketch, labels,
      comments, chat, searches, referee-claims, referee-criteria).
- [ ] **`block-identities.json` is not optional.** Comments and chat anchors can reference ids whose
      blocks are gone from the current revision, so without it the bundle contains anchors pointing
      at nothing. The rollback omits it as "recoverable from stamped HTML", which is true for
      re-ingestion and false for anchor integrity.
- [ ] `README.md` for whoever writes an importer — drafted already; leads on the block-id contract
      ([block-ids.md](../project/block-ids.md)) and warns that ids carry no ordering.
- [ ] A test that the bundle path **never touches the blob store** — pass a store that throws.
- [ ] The oversize path returns a readable 413, with a test.

**Stage D — the route.** `GET /api/export/:slug`.
- [ ] `slugPart`, not `part`. `contentDisposition(name, "attachment")` after the refactor above,
      `application/zip`, `nosniff`, `Content-Length`.
- [ ] Tests: owner downloads a valid zip; unauthenticated 401; **another owner 404** (with a
      positive control — the test must be seen going red without the filter, or it is not evidence);
      public-namespace 404; traversal and bad encoding 400; oversize 413.

**Stage E — docs.** `docs/project/export.md`: the format, the omissions and why, the relationship to
`db:export`. Owned by [architecture.md](../project/architecture.md); `tests/doc-links.test.ts` green.

**Stage F — the button.** `ExportSection` in `Metadata.tsx`, before "Delete this article".
- [ ] Inline card button in the `DeleteArticle` style, not `IconButton`; a Lucide icon that is not
      `Download` (spent on the fetch stage). Pending state, readable failure
      ([copy.md](../project/copy.md)).
- [ ] Download via `apiFetch` → `res.blob()` → `<a download>` — the header's filename is lost
      through the blob URL, so the anchor must carry the name.
- [ ] A component test (pending state, error text, anchor click, URL revocation) **and** a browser
      check in a Sonnet subagent. The manual check is extra evidence, not the only evidence.

**Stage G — `index.html`, deliberately minimal.** An escaped index of what's in the zip, with the
article title and counts. Every reader-controlled and model-derived string HTML-escaped, a
restrictive CSP blocking scripts and network, and adversarial fixtures (`<script>`, event handlers,
closing tags). **`extractedHtml` is not safe to render directly.** Rendering every feature inline
would be a second reading client inside a zip — out of scope, and the piece to cut if anything gives.

## What this is deliberately not doing

- **Image bytes** (Greg's call) — `assets.json` names every image, hash and URL, so the bundle
  *names* everything. Adding bytes later means adding bucket credentials to the route.
- **The original PDF/HTML** (Greg's call) — easy to get from the URL.
- **Older revisions** — a real, deliberate omission, not an impossibility. Named in the manifest.
- **`ai_calls`** — rows with a matching `article_id` are exportable, but `article_id` is nullable and
  many of an article's calls have none, so any total would be quietly wrong. Manifest says so.
- **`checkpoints`, `jobs`, `queue_state`, `revision_step_runs`** — pipeline machinery, not reader
  data. Listed in the manifest as omitted so an importer knows rather than guesses. **If `jobs` is
  ever added, note it carries a reader-profile snapshot.**
- **`feedback` / `uploads`** — support records, not article state.
- **Whole-library export** — one article, one button. `db:export` covers bulk.
