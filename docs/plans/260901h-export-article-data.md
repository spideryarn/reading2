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

- ~~`contentDisposition(filename)` takes one argument and always returns `inline`~~ — **done**
  (commit `3183ddc`). Now `contentDisposition(filename, "inline" | "attachment")`, required with no
  default so a download cannot inherit the PDF route's answer. The reasoning moved to `sendSource`.
  The regression test was watched going red before being trusted.
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

**Stage A — `readArticleRows`, with the rollback unchanged.** ✅ **Done.**
- [x] [`src/store/article-rows.ts`](../../src/store/article-rows.ts): `ArticleRows` (typed via
      `$inferSelect`, not hand-written), `readArticleRows(slug)`, `ArticleNotFound`, and
      `messagesOfThread`. `exportArticle`'s projection is untouched and now fed from it — ten `await
      db` reads became one call.
- [x] Coverage test still 8/8 under `REQUIRE_POSTGRES=1`; the five rollback suites 285/285.
      `npm run typecheck` clean.
- [x] **Parity proven independently of the suite.** The pre-refactor `exportArticle` was
      reconstructed in a scratchpad and both were run against a fixture exercising all ten tables —
      blocks inserted in scrambled ordinal order, messages interleaved across `chat`, `remember` and
      `candidates` threads. `diff -r` said *directories identical*, 21 files each, same `tables` set.
- [x] Two things learned, both recorded because they will matter later:
      - The positive control worked for `stance` (dropping it from the old copy's projection turned
        the diff red) but **breaking `order by ordinal` did not** — Postgres returned the rows in
        ordinal order anyway. Exactly the trap the file's own comment warns about. The `ORDER BY` is
        guaranteed by being written, not by that diff; `store-roundtrip` is what pins it.
      - An N+1 per-thread message query became one `article_id`-scoped read. The article-scoping
        that stops one reader's conversation landing under another's article now lives in
        `readArticleRows`, and the old site says so.
- [x] **Cost accepted:** `db:export` now reads `block_identities` and throws the rows away — one
      extra cheap read per article, the price of not having two query walks.
- [x] Moved this suite's fixture ids off `…ea`/`…eb`, which `public-visibility-pg.test.ts` had also
      claimed. `tests/fixture-ids.test.ts` exists to catch exactly that, and the symptom is a 404 in
      whichever file loses the race — so it reads as a flake in someone else's work.

**Stage B — move the guard, and prove data survives.** ✅ **Done.**
- [x] `ARTICLE_TABLE_COVERAGE` moved to [`article-rows.ts`](../../src/store/article-rows.ts), beside
      the query walk, and each entry now answers for **both** outputs:
      `{ rollback: Destination; bundle: Destination }`. `export.ts` re-exports it, so `put()` and
      every old importer are untouched.
- [x] The two projections genuinely disagree in exactly one place, which is what forced two fields:
      `block_identities` is `exported: false` for the rollback and **required** for the bundle.
- [x] One set of sentinel fixtures now runs through **both** projections, one `it` each so a failure
      names which output lost the row. The `block_identities` fixture's sentinel is deliberately a
      block id that has *left the article*. 8 → 10 tests.
- [x] Three controls watched going red and reverted: flattening `candidates`→`chat`; dropping
      `comments.json` (only the bundle `it` went red, the rollback stayed green); and — the one that
      matters — **writing `comments.json` but with only `{id}` per row**, the "received a row and
      discarded it" case a weaker check would have passed.

**Stage C — the bundle.** ✅ **Done.** [`src/store/export-bundle.ts`](../../src/store/export-bundle.ts),
`fflate` async `zip()`.
- [x] Layout as planned, `manifest.json` at `format: 1`, and its machine-readable `omitted` list is
      **derived from the coverage record** rather than written out beside it — so the manifest cannot
      drift from the guard.
- [x] **A better decision than this plan specified:** the bundle serialises **whole rows** (Dates to
      ISO, `ownerId`/`articleId`/`revisionId`/`fts` dropped) rather than naming fields. A
      hand-written field list is exactly how `tools`, `stance`, `criterionId` and `valence` each went
      missing from `export.ts`. So `passages`, `interrupted` and a real `candidates` kind survive
      **by construction, not by being remembered**. The rollback must keep its lists because a byte
      comparison pins them; this file must not.
- [x] `BUNDLE_BYTE_CAP = 4_500_000` and an exported `overBundleCap()` — the route must call it
      rather than writing `>` a second time. Both sides unit-tested; `overCap` has never been
      observed true on a real bundle and cannot be without a ~5 MB fixture, which is why the
      comparison is shared rather than duplicated.
- [x] **No bucket access, proved by mocking rather than by a parameter** — `articleBundle` takes no
      store (a dead parameter would be worse), so the test mocks `src/store/blobs.js` to throw on
      every call and asserts the bundle still builds. The positive control sits in the same file:
      `exportArticle` on the same article, same process, throws — because `writeRawDocument` reads
      before it writes. Scope: this catches a reach through either sanctioned constructor, not a
      future direct import of `blobs-supabase.ts`.
- [x] Built and inspected for real, not just tested: `noema-mythology-of-conscious-ai` → 18 entries,
      **172 KB**, with chat and comments present; `fowler-phrenology` → 12 entries, 92 KB.
- [x] Known and deliberate: `content/extracted.html` can be byte-identical to `stamped.html`. No
      "skip when equal" rule, because an absent file meaning *identical* is indistinguishable from
      one meaning *missing*.

**Stage D — the route.** ✅ **Done.** `GET /api/export/:slug`, `sendExport` in
[`src/routes.ts`](../../src/routes.ts), modelled on `sendSource`.
- [x] `slugPart`, `application/zip`, `contentDisposition(…, "attachment")`, `nosniff`,
      `Content-Length`. `Content-Type` is a literal, not a `CONTENT_TYPE` entry — that record is
      keyed by `StoredKind` and a per-request zip is never stored.
- [x] **No second ownership check, deliberately.** `readArticleRows` predicates on `ownedSlug()` —
      slug and owner in one `where` — so there is no window where the route holds an article it may
      not have. `sendSource`'s belt-and-braces pair exists for a reason that does not apply here.
- [x] `ArticleNotFound` → 404, which was GPT Sol's flagged 500. Not-this-reader's and
      no-current-revision are deliberately **one** answer, so the response cannot confirm that a
      slug they cannot see exists.
- [x] Over cap → 413 reading *"This article is too big to download in one file. That is a limit on
      our side, not something you did, and trying again will not help…"* — reads `overCap` rather
      than recomputing, because two `>` in two files is how one of them ends up `>=`. The platform's
      own answer is a truncated download, which is worse than a refusal because it looks like a file.
- [x] 10 tests. **The owner-isolation control was watched going red**: with the owner clause mocked
      away, the stranger got the zip (`expected 200 to be 404`) and the other nine stayed green. The
      404-translation and 413 branches were each proven live the same way, and `routes.ts` verified
      byte-identical afterwards. The mock is recorded in the test's header, since it is not a control
      that can safely live in the suite.

**Stage E — docs.** ✅ **Done.** [`docs/project/export.md`](../project/export.md), 124 lines.
- [x] Most of its length goes on why there are two exporters and why they cannot be one — the thing
      a future reader would otherwise reverse-engineer. Also records why Sol's synthesized middle
      model was turned down, and says plainly that the route and button are not built yet.
- [x] `database.md`'s pointer to `ARTICLE_TABLE_COVERAGE` was stale the moment the record moved, and
      its "why a rollback of `data/` does not need it" framing was wrong once it answered per
      projection. Both fixed.
- [x] Ownership is derived from the `↳` list in `AGENTS.md`, not from `architecture.md` — so the
      orphan check could not have gone green on an `architecture.md` edit alone. Both got a line.
      These are **signposts**, which `edit-important-docs.md` explicitly exempts from the approval
      process (Greg, 2026-08-31: *"you don't need explicit authorisation just for adding minimal
      signposts like these"*), so no approval was needed and none was sought.
- [x] `doc-links` 8/8, and its orphan check watched going red against a throwaway doc first.

**Stage F — the button.** ✅ **Done.** `ExportSection` in `Metadata.tsx`, between "Access & sharing"
and "Not built yet"; Delete still last.
- [x] `FileArchive` (not `Download`, spent on the fetch stage), inline card button in
      `DeleteArticle`'s style minus the destructive tint.
- [x] Three deliberate departures from `SourceLink`'s blob idiom, each with its reason recorded: the
      anchor goes **into** the document (Firefox will not run the default action for a detached
      one); revoke is a macrotask later, not synchronous (which can abort the download) and not
      `SourceLink`'s 60s (that timer exists because a new tab must fetch the URL itself); and
      failures go through `failure`, not `readJson`, which would consume the zip.
- [x] 8 tests, and **six mutations watched going red** and reverted: dropped `download` attribute,
      dropped `disabled`, swallowed catch, removed the gate, detached anchor, dropped revoke.
- [x] **Honest cost recorded on the component:** `hasShelfRow` is false while the metadata request is
      out *and for ever if it fails* — the same complaint that moved the sharing card off it. Kept,
      because there is no useful "we could not check" state for a section that is one button.
- [x] **Browser-checked on the remote box** against the running dev server. The card is in the right
      place with the right visual weight and is not styled destructive; pressing it returned
      `200` and downloaded `own-spya-bf6g9b.zip` — a real 13-entry archive; no console errors.
      **Not confirmed:** the "Building the zip…" disabled state, which completed faster than the
      tooling could snapshot. Reported as unverified rather than assumed; the button returned to
      rest cleanly, which is consistent but is not the same as having seen it.

**Stage G — `index.html`.** ✅ **Done.** Deliberately an index, not a reading client, per Sol.
- [x] Self-contained, no JavaScript, no external anything. Title, byline, source, export time; counts
      (blocks, words, hierarchy nodes, glossary terms, comments, chat messages…); a file table with a
      note and a size for each entry; and what is not in it.
- [x] **The page and the manifest cannot disagree** — both read a shared `omissions()`, rather than
      the page carrying a second copy of the list.
- [x] One escaper, and it is the repo's (`escapeHtml` in `src/html.ts`), not a fresh one — that
      file's own doc records what happened the last time it was written twice. CSP
      `default-src 'none'`, `referrer: no-referrer`. Neither `extractedHtml` nor `stampedHtml` is
      rendered, proved with a marker string.
- [x] A URL only becomes an `href` if `isWebUrl()` accepts it — **and this fired on real data**:
      `fowler-phrenology`'s `finalUrl` is a `file:///…` path, and it prints as plain text with no
      anchor.
- [x] Escaping control watched going red across four tests, the page rendering
      `<h1></title><script>alert(1)</script></h1>`. **The two that stayed green were the two not
      about escaping** — `isWebUrl` is what keeps `javascript:` out of an `href`, and "no article
      markup" is a claim about what is rendered at all. That distinction is written into the test
      file's header rather than left as a coincidence.
- [x] Anti-drift guard: the file table must cover exactly the zip's contents minus itself and the
      manifest, each with a real note — so a file added to the bundle without one turns it red.
- [x] Built for real: `fowler-phrenology` 13 entries / 95 KB, `noema…` 19 entries / 176 KB.

**Stage H — what the code review found.** ✅ **Done.** The second review (code, not plan) found a
real bug, and it was the one the design claimed to have abolished.

- [x] **`article_revisions` was field-listed, not row-serialised.** The whole argument for the bundle
      is that whole rows cannot forget a field — true for nine tables and **false for the biggest
      one**. Measured against the real database: `"byline"`, `"siteName"`, `"excerpt"`,
      `"publishedAt"` and `"wordCount"` were in **no JSON file in the zip**, surviving only
      incidentally inside article prose. The rollback's `meta.json` keeps most of them, so on this
      table *the faithful export was the less faithful one* — and nobody saw it, because the audit
      only ever looked for losses in the rollback direction. Fixed with `content/revision.json` via
      `rowJson`, dropping only `id` and the sixteen payloads already written as their own files.
- [x] **Why it hid, and the guard that now catches it.** The coverage check was table-level. Sol's
      *plan* review said so — "it cannot see a dropped column" — and Stage B fixed only the other
      half. One column of forty-six (`title`, into the manifest) satisfied the guard for the whole
      table. There is now a column-level check comparing emitted keys against
      `getTableColumns()`, with every difference requiring a written reason, **and it checks both
      directions** so a stale "left out" claim is also red.
- [x] **Watched red before the fix**, naming all 30 missing columns, with the other ten tables
      passing — a specific failure, not a new test failing everything. Then a second control, since
      30 columns at once does not prove it catches one: dropping `byline` alone turned it red too.
- [x] The rollback is deliberately **not** covered by the column check, and the test says why: that
      projection renames as it goes (`extract_method`→`method`), so there is no key set to compare,
      and `store-roundtrip` already pins its bytes.
- [x] Deleted `ArticleBundle.filename` — dead, and its docstring claimed the route used it. The name
      was already spelled consistently in two places; a third, unused spelling was the whole problem.
- [x] Recorded the owner-isolation invariant on `readArticleRows`: the child reads carry no owner
      predicate, which is correct **today** only because every write path stamps `currentOwnerId()`
      and the public surface is read-only. `glossary_lookups`' PK is `(article_id, entry_id)` with
      `owner_id` outside it, so the schema does not forbid the other case. The trigger is the day
      anyone can annotate someone else's shared article — at which point every test here stays green.
- [x] The owner-uuid assertion now sweeps the **whole zip**, not just `article.json`, so a future
      owner column under another name (`createdBy`) that `rowJson` would happily ship is caught.
- [x] `Cache-Control: private, no-store` on `sendExport`, as `/api/admin/users` does — a zip of one
      reader's whole article is the response most likely to sit in a disk cache.
- [x] `export.md` no longer says the route and button are unbuilt.
- [x] **The reviewer's arithmetic was corrected rather than copied**: one column of forty-six, not
      three — `manifest.json`'s `slug`/`shortId` come off `articles` and its `url` is a renamed
      derivation.

**The rollback did not move, proved without running the contended suite.** Two peer test runs held
the fixture job slots, so `store-roundtrip` could not start. Instead: `src/store/export.ts` is
**byte-identical** to `bb0aff5`, the commit at which it was watched passing 263/263, and the only
executable change in `article-rows.ts` since is the `bundle` destination string — a field
`export.ts` never reads, since it goes through `.rollback` alone via `RollbackTable`. A stand-in
diff against `data/` was built and **thrown away as invalid evidence**, because Postgres has drifted
from `data/` under other agents' work and it diffs red on an unmodified codebase.

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
