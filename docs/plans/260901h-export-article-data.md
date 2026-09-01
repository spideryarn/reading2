# Export all of an article's data, from a button on the Metadata page

**Status:** written 2026-09-01, before any code. Not yet reviewed by GPT Sol.

## What Greg asked for

> Let's add an Export button somewhere, perhaps in Metadata, that exports all the data for an
> article. Check we don't already have this. It can exclude the original PDF/HTML itself (because
> that's easy to get otherwise). It should include the Spideryarn-ingested version of the HTML +
> images/assets/etc. Plus include all the various input + augmentations added on the site,
> e.g. Hierarchy, Summary, Glossary, Chats, Diagrams, Comments, etc etc. If anything is
> particularly tricky, defer it.
>
> — Greg, 2026-09-01

Asked what the file is for, and what to leave out of v1, he answered: include **everything**, but
**leave out the binary asset bytes**; and

> perhaps also with a human-readable index .html, and/or a .md describing the data for agents
> writing code to import it
>
> — Greg, 2026-09-01

So the deliverable is a zip: one JSON file per feature, the ingested HTML, a `README.md` that
documents the format for whoever writes an importer, and an `index.html` you can double-click.

## Do we already have this? Half of it, and not where a reader can reach it

`npm run db:export -- --out <dir>` ([`src/store/export.ts`](../../src/store/export.ts)) already
walks one article across every table and writes `data/<slug>/`. But it is **the rollback**, not a
feature: it is a CLI, it needs `DATABASE_URL` and a Supabase **service-role** key, it writes to the
filesystem, and its output shape is the filesystem store's internal layout. No reader can run it,
and there is no download path anywhere in the web app except the original-PDF route.

What it does have, and what makes this job much smaller than it looks, is
[`tests/store-export-covers-tables.test.ts`](../../tests/store-export-covers-tables.test.ts) —
a test that reads `src/db/schema.ts` at runtime, finds every table reaching an article, and fails
if `ARTICLE_TABLE_COVERAGE` doesn't either export it or say in words why not. It exists because
`referee_criteria` landed on 2026-08-31 and `db:export` silently dropped every row.
**A second exporter written alongside the first would not be covered by that test**, and would
acquire exactly the same bug on the next new table.

## The key decision: one exporter, two sinks — not two exporters

`exportArticle()` interleaves gathering and writing, but every value it gathers already passes
through a single choke point:

```ts
const put = async (from: ExportedTable | readonly ExportedTable[], name: string, value: unknown)
```

`from` is the runtime half of the coverage test. There are exactly two escapes from `put`:
`writeRawDocument()` (the original document's bytes, out of the bucket) and the `stampedHtml` write
to `outputRoot`.

So we do not extract a gatherer and we do not write a second exporter. We **make the destination an
argument**: `exportArticle(slug, sink)`, where the CLI passes a sink that writes files and the new
route passes a sink that collects zip entries in memory. One code path, one query set, one
coverage test — and a table added next month breaks the download the same day it breaks the
rollback.

The two escapes become sink methods rather than special cases, which is also where the "exclude the
original PDF/HTML" instruction lands cleanly: the zip sink simply declines the raw document.

**The simpler option passed over:** write `src/export-bundle.ts` standalone, querying the tables it
wants. Fewer files touched, no refactor of a security-sensitive rollback tool, and it could have
shipped in one stage. Rejected because it is a second way to do the same thing, and because the
coverage test — the one guard that has already caught a real silent-success bug in this exact area —
would protect only one of the two. Duplicating the guard means duplicating the maintenance of it,
and a guard nobody updates is worse than none.

**Second decision: no bucket access at all.** Because the raw document is excluded (Greg) and the
image bytes are deferred (Greg), the whole bundle is text out of Postgres. The route needs no
service-role key, no signed URLs, and no streaming — it builds a buffer and ends the response, like
`sendSource` already does for PDFs. That is a large simplification and it is worth protecting: if a
later stage adds asset bytes, it adds the bucket dependency with it, and should say so.

**Third decision: not behind the experimental flag.** Nothing sits behind `experimental` today, and
[experimental-features.md](../project/experimental-features.md) attaches real obligations to being
the first thing that does (a shared provider for the answer, a doc entry, mid-flight handling).
Export is small, safe, read-only and finished — it ships visible. Flagged for Greg to overrule.

## References

- [`src/store/export.ts`](../../src/store/export.ts) — the exporter being generalised; `put()` at
  ~L468, `ARTICLE_TABLE_COVERAGE` at L168, `ExportTarget` at L82.
- [`tests/store-export-covers-tables.test.ts`](../../tests/store-export-covers-tables.test.ts) — the
  guard this design is built around. Its docstring is the best statement of the failure mode.
- [`src/routes.ts`](../../src/routes.ts) — `sendSource` (L417) is the only existing non-JSON
  response and the template for this one; `contentDisposition` (L504) builds the RFC 6266 header;
  `slugPart` (L3572) is mandatory for any slug that becomes a store key.
- [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) — `Section` (L1460), the `CARD` style (L222),
  `hasShelfRow` (L454) as the ownership gate, `SharingSection` (L914) and `DeleteArticle` (L1393) as
  the two button patterns to copy.
- [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) — the only blob-download idiom in the
  app: `apiFetch` → `res.blob()` → object URL → `<a download>`. A plain `<a href>` cannot work,
  because `/api/` needs a Bearer token and a navigation carries no headers.
- [security-map.md](../project/security-map.md), [auth.md](../project/auth.md) — owner scoping is
  request-scoped via `AsyncLocalStorage`; `ownedSlug()` in `src/store/pg.ts` is the one predicate.
  `exportArticle` already uses it, which is why the route inherits the right behaviour.
- [database.md](../project/database.md) — run everything with `SPIDERYARN_STORE=postgres`.

## The stages

**Stage A — make the destination an argument.** No behaviour change, no new feature.

- [ ] Define `ExportSink` in `src/store/export.ts`: `put(from, name, value)`, `rawDocument(...)`,
      `stamped(html)`. Give it the same `from` bookkeeping so `ExportResult.tables` stays observed
      rather than declared.
- [ ] `fileSink(target: ExportTarget, sources: RawSourceStore)` reproduces today's behaviour
      exactly, including `<slug>.html` into `outputRoot` and the `written` path list.
- [ ] `exportArticle(slug, sink)` — the CLI at the bottom of the file builds a `fileSink`, so
      `npm run db:export` is unchanged from the outside.
- [ ] Done when: `npm test` green **with `REQUIRE_POSTGRES=1`**, so the behavioural half of the
      coverage test actually ran rather than skipping. A green run that skipped it proves nothing
      here — [silent-success.md](../reusable/silent-success.md).

**Stage B — the bundle.** `src/store/export-bundle.ts` + `fflate` (zero-dep, ESM, `zipSync`).

- [ ] `bundleSink()` collects `{path, bytes}`; `articleBundle(slug): Promise<Uint8Array>` runs
      `exportArticle` against it and zips the result.
- [ ] Layout — flat is not good enough for something Greg will hand to an agent:
      `manifest.json` (slug, title, url, exportedAt, format version, file list, what was
      deliberately omitted and why), `article.json` (ex-`shelf.json`), `content/` (`stamped.html`,
      `extracted.html`, `blocks.json`, `assets.json` — the manifest, with the bytes absent and said
      to be absent), `augmentations/` (tree, arc, tweets, glossary, glossary-lookups, ideas,
      quotes, timeline, quiz, sketch, labels, comments, chat, searches, referee-*).
- [ ] `README.md` in the zip: what each file is, which feature it backs, the block-id contract
      ([block-ids.md](../project/block-ids.md)) since every augmentation addresses text by it, and
      what is **not** here (raw document, image bytes, older revisions, spend ledger) with the
      reason for each. Written for someone writing an importer.
- [ ] `bundleSink.rawDocument()` is a no-op that **records the omission into the manifest** rather
      than dropping it silently.
- [ ] Test: run `articleBundle` over the fixture article, assert the exact entry list, assert the
      zip reads back, and assert every table `ExportResult.tables` reports lands in some entry —
      the same "observed, not declared" trick the coverage test uses.

**Stage C — the route.** `GET /api/export/:slug` in `src/routes.ts`.

- [ ] Matched with `slugPart`, not `part`. Belt-and-braces ownership: an owner-scoped store read
      first to force the 404, exactly as `sendSource` does and for the same recorded reason.
- [ ] `Content-Type: application/zip`, `contentDisposition(`${slug}.zip`, "attachment")`,
      `X-Content-Type-Options: nosniff`, `Content-Length`, `res.end(Buffer)`.
- [ ] Tests: another owner's slug 404s (with a **positive control** — the test must be shown going
      red if the owner filter is removed, or it is not evidence); a traversal-shaped slug 400s.

**Stage D — the button.** `ExportSection` in `Metadata.tsx`.

- [ ] Its own `<Section label="Export">` between "Access & sharing" and "Not built yet" — before
      "Delete this article", which stays last.
- [ ] Inline `<button>` in the card style of `DeleteArticle`, not `IconButton` (that is for compact
      toolbar rows). A Lucide icon that is not `Download`, which this page already spends on the
      fetch stage — `Package` or `FileArchive`.
- [ ] Gated on `hasShelfRow`, like the sharing switch. Pending state while the zip builds, and a
      readable failure message ([copy.md](../project/copy.md)) rather than a thrown error.
- [ ] Download via the `SourceLink.tsx` idiom, revoking the object URL after.
- [ ] Browser check in a Sonnet subagent against `SPIDERYARN_STORE=postgres npm run dev` on :5273 —
      click it, confirm a zip actually lands and opens. Tests going green is not evidence a reader
      can see it.

**Stage E — `index.html`, the human-readable half.**

- [ ] A self-contained page in the zip: the article's stamped HTML, with its summaries, glossary,
      ideas, quotes, timeline, comments and chats rendered alongside. No network, opens offline,
      readable in six months.
- [ ] Its own stage because it is presentation work with no bearing on A–D, and if it slips the
      export is still complete and shippable. This is the piece to cut if anything has to give.

**Stage F — docs.**

- [ ] `docs/project/export.md` — what the button produces, the format, what is omitted and why, and
      the relationship to `db:export`. Owned by [architecture.md](../project/architecture.md) with a
      pointer from `reading-view-overview.md`; `tests/doc-links.test.ts` must stay green.
- [ ] A line in `database.md` next to the rollback exporter saying they are now one code path.

## What this plan is deliberately not doing

- **Image and asset bytes.** Greg's call. `content/assets.json` ships the full manifest — every
  source URL, hash, content type and byte count — so the bundle *names* everything, and a later
  stage can fetch it. Adding it later means adding bucket credentials to the route, which is the
  real cost and the reason it is worth deferring separately.
- **The original PDF/HTML.** Greg's call, and easy to get otherwise.
- **Older revisions.** Only `current_revision_id` is a first-class concept anywhere in the app;
  regenerating glossary overwrites the column. Exporting history would mean inventing it first.
- **`ai_calls` (what it cost).** `article_id` is nullable and half an article's calls have none, so
  a per-article total would be quietly wrong. Better absent than misleading.
- **`feedback` and `uploads`.** Joined to an article by a loose `slug` string with no FK, so the
  schema walk cannot see them and neither can this.
- **Whole-library export.** One article, one button. `db:export` already does the bulk case.
