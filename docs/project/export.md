# Export one article

A reader presses **Export** on an article's Metadata page and gets back a zip of everything
Spideryarn holds for that article — the HTML as we read it, every block id, and every augmentation:
hierarchy and gists, glossary, ideas, quotes, timeline, quiz, diagram, comments, chats, searches,
referee mode. Plain text files, readable without Spideryarn. It is the reader's data, and this is
how it leaves.

> Let's add an Export button somewhere, perhaps in Metadata, that exports all the data for an
> article. Check we don't already have this. It can exclude the original PDF/HTML itself (because
> that's easy to get otherwise). It should include the Spideryarn-ingested version of the HTML +
> images/assets/etc. Plus include all the various input + augmentations added on the site,
> e.g. Hierarchy, Summary, Glossary, Chats, Diagrams, Comments, etc etc. If anything is
> particularly tricky, defer it.
>
> — Greg, 2026-09-01

Parent: [architecture.md](architecture.md). The work is
[260901h-export-article-data.md](../plans/260901h-export-article-data.md), and it is built: the
bundle, `GET /api/export/:slug`, and the button on the Metadata page.

## What comes out

[`src/store/export-bundle.ts`](../../src/store/export-bundle.ts) assembles it, and the `readme()` at
the foot of that file is the layout's own documentation — it ships inside every zip. That is the
file-by-file list, and the thing to edit when the layout changes.

    index.html        what is in the zip, as a page a person double-clicks
    manifest.json     what this export is, when it was made, and what was left out
    article.json      the article on your shelf: your title, your purpose, sharing state
    README.md         the above, for whoever writes an importer
    content/          revision.json, stamped.html, extracted.html, blocks.json,
                      block-identities.json, assets.json
    augmentations/    tree, glossary, glossary-lookups, ideas, quotes, timeline, quiz, sketch, arc,
                      tweets, labels, comments, chat, searches, referee-claims, referee-criteria

**Every file is optional and absent when there is nothing in it** — an article nobody chatted about
has no `chat.json` — except `index.html`, `manifest.json`, `article.json`, `README.md`,
`content/revision.json` and `content/block-identities.json`, which are always written, the last even
when empty. Anything holding a list wraps it in a single-key object, so the format has somewhere to
grow.

`articleBundle(slug)` is owner-scoped through `readArticleRows` and throws `ArticleNotFound` for a
slug that is not this reader's, which a route turns into a 404 rather than a 500.

## `index.html` is an index, not a reader

Greg asked for "perhaps also with a human-readable index .html", and the review drew the line:

> I would make `index.html` a simple escaped file index in v1. Rendering every feature recreates a
> second reading client inside a ZIP.
>
> — GPT Sol, 2026-09-01

So the page says **what you have got**, not what it says: the title, byline, site and source URL;
a table of every file with a few words and its size; counts taken off the rows; and the same
`omitted` list the manifest carries, read from the same function so the two cannot disagree. It
renders **no article prose, no comment bodies and no chat**, and in particular neither
`extractedHtml` nor `stampedHtml` — the reader has both as files and the browser opens either.

It is opened from a `file://` URL, where there is no origin isolating it and no CSP header from a
server, and every string on it — title, byline, site name — was written by the site the article came
from or by a model. So: one escaper ([`escapeHtml`](../../src/html.ts), through `safe()`) on every
interpolated value with no exceptions; a `<meta>` CSP of `default-src 'none'` as the second line of
defence rather than the first, since `<meta>` CSP on `file://` varies by browser; no JavaScript and
nothing external, so it works with the network unplugged. A URL only becomes an `href` if
[`isWebUrl`](../../src/urls.ts) accepts it — real articles in the local database include a
`file:///…/source.pdf`, which prints as text. The adversarial fixtures are in
`tests/store-export-bundle.test.ts`, and the escaping was watched failing before it was believed.

The file table doubles as the guard against drift: a file the bundle writes and `FILE_NOTES` has no
words for turns that test red, so a new file cannot arrive undescribed.

## Why there are two exporters

`npm run db:export` ([`src/store/export.ts`](../../src/store/export.ts)) also walks one article
across every table, and reusing it was the first plan. That was wrong, and why is the most useful
thing on this page.

`exportArticle` is **the rollback**. It projects an article into the filesystem store's
`data/<slug>/` layout, and `tests/store-roundtrip.test.ts` pins that output *byte for byte* against
what the filesystem store writes. So its losses cannot be fixed in place — fixing one turns that
test red:

- a `candidates` chat thread is written as `chat` (emitting the real kind was tried, and reverted);
- `passages` and `interrupted` are dropped from every message;
- `extractedHtml` is never written at all;
- `shortId`, `visibility` and `publicAt` have nowhere to land, because `data/` has no sharing.

A reader's download built on that would inherit every one of them into a brand-new user-facing
format, with the round-trip test blocking the repair. **The rollback's data model is not "my article
data", and must not become its definition.**

So the two share **the queries, and nothing else**.
[`readArticleRows(slug)`](../../src/store/article-rows.ts) is the one owner-scoped walk — the joins,
the owner filter, the `order by ordinal` that is the whole ballgame since ids carry no position, and
[one snapshot](#one-snapshot-not-ten) — and each side projects those rows its own way. The rollback
keeps its hand-written field lists, because a byte comparison pins them. The bundle **serialises
whole rows** and names only the handful of columns it drops, so a column added to
[`src/db/schema.ts`](../../src/db/schema.ts) reaches the reader's download without anybody
remembering it. Fidelity by construction rather than by memory:
`tools`, `stance`, `criterionId` and `valence` each went missing from `export.ts` for weeks, one
field list at a time.

**That last sentence was a claim before it was true, and how it failed is the more useful half.**
For a day, `article_revisions` — the biggest table here — was the one table whose row was never
serialised: `manifest.json` named `title` and a url, the HTML and artefact columns were files of
their own, and `byline`, `siteName`, `excerpt`, `publishedAt`, `wordCount` and twenty-five others
were in **no JSON file in the zip**. The rollback's `meta.json` wrote most of them, so on that one
table the faithful export was the less faithful of the two. It is `content/revision.json` now.

The guard could not see it because it was **table-level**: one sentinel string per table, and this
table's went into `title` — the one column of it that did ship. One column out of forty-six
satisfied the check for the whole table.
[`tests/store-export-covers-tables.test.ts`](../../tests/store-export-covers-tables.test.ts) now
also compares the keys each file actually carries against `getTableColumns`, so a dropped column
fails and a deliberate omission has to be written down in words beside it. It covers the bundle
only: the rollback renames as it goes (`extract_method` lands as `method`), so there is no key set
there to compare, and `store-roundtrip` already pins its bytes.

The middle option — a synthesized model both sides project from — was proposed in review and turned
down. It would have to be rich enough for the bundle *and* lossily projectable back to a pinned
format, and the rows are already the faithful representation.

## One snapshot, not ten

The walk reads eleven tables in ten statements, and the rows have to agree with each other, because
the projections join them: a chat message is written *inside* its thread. Until 2026-09-01 it read
them through the pool with `Promise.all` and no transaction, so each statement took its own snapshot
— and a thread committed between the `chat_threads` read and the `chat_messages` read gave the
caller a message whose thread it had never been handed. `export-bundle.ts` nests messages under the
threads it was given, so that message was **dropped in silence**, out of a zip that says it holds
everything. Every statement now runs inside one `repeatable read`, `read only` transaction.

It costs about 12 ms per walk on the local database, and the walk is twelve round trips where it was
three; the numbers, and why `Promise.all` inside the transaction was measured and then not taken,
are on `walk()` in [`article-rows.ts`](../../src/store/article-rows.ts).
`tests/article-rows-snapshot.test.ts` proves the snapshot without racing anything: it commits a
thread, a message and a comment *during* the walk, deterministically, and asks the transaction
itself what isolation it got.

## `block_identities`, the one table they disagree about

The rollback leaves it out on purpose: stage 3 recovers ids from the HTML that export writes, which
is true for re-ingestion and **false for anchor integrity**. A comment or a chat thread can be
anchored to a block id that has since left the article, so a bundle without these rows carries
anchors pointing at nothing, and an importer cannot tell a dangling anchor from a corrupted one.
That single disagreement is why `ARTICLE_TABLE_COVERAGE` answers for both projections rather than
one. [block-ids.md](block-ids.md).

## What is left out, and why

Image bytes and the original PDF/HTML, both Greg's calls — `content/assets.json` still names every
image, its hash, type and source URL, so the bundle *names* everything. Earlier revisions: they
exist and carry lineage, so this is a product decision, not an impossibility. `ai_calls`, whose
`article_id` is nullable, so a per-article total would be quietly **wrong** rather than merely
absent. And the pipeline tables — `checkpoints`, `jobs`, `queue_state`, `revision_step_runs` —
machinery rather than reader data. Plus `raw_sources` and `uploads`, which describe *how the
document arrived* rather than the article: the bucket object the fetch stored, and the upload
attempt that produced it.

`manifest.json` states all of this machine-readably under `omitted`, and that list is **derived from
`ARTICLE_TABLE_COVERAGE`** rather than written out beside it, so the manifest cannot drift from the
guard. The per-table reasons live in that record, one for each projection —
[database.md](database.md) has why the record exists at all, and what a day of silence cost when
`referee_criteria` was missing from it.

**Those last two were missing from the record until 2026-09-01, and the reason is worth keeping.**
The guard finds the tables by walking foreign keys, and it walked them **child → parent** only — so
a table an article *points at* was never discovered, while the test's own comment said it found
everything that reaches an article. Nothing failed; the two simply never appeared in `omitted`, so
no reader was ever told they existed. The plan had said `uploads` was deliberately omitted, which
was true in the plan and in nothing a reader could see. The collector now takes one hop **outward**
as well, deliberately one and not a fixpoint: outward references reach the whole schema, and
`feedback` and `reader_profiles` are correctly still outside it.

## Size, and the cap

The zip is assembled in memory and returned whole. Vercel caps a buffered response body, so
`export-bundle.ts` holds that cap as `BUNDLE_BYTE_CAP` and exports `overBundleCap()` for the route
to call — one comparison rather than two, because two `>` in two files is how one of them becomes
`>=`. Being over the cap is *reported* on the bundle, not thrown, since only the caller knows
whether it is an HTTP response with a ceiling or a CLI writing to disk; the route answers a readable
413. A warning log would not have done, because the reader's request still fails.

Measured over the local database, the largest article is a small fraction of the cap, so buffering
is right for v1. Stored HTML artefacts can be far larger, so the case is not hypothetical.
**Streaming is the named escape if the 413 ever fires**, and it is not built.

## See also

- [architecture.md](architecture.md) — the pipeline that produces everything in the zip, and where
  the data lives.
- [database.md](database.md) — the store, `db:export` as a rollback, and the coverage record's
  history.
- [block-ids.md](block-ids.md) — the contract every augmentation in the export addresses text
  through.
- [`src/store/article-rows.ts`](../../src/store/article-rows.ts) — the shared walk and
  `ARTICLE_TABLE_COVERAGE`; [`export-bundle.ts`](../../src/store/export-bundle.ts) — the reader's
  zip; [`export.ts`](../../src/store/export.ts) — the rollback.
