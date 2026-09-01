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
[260901h-export-article-data.md](../plans/260901h-export-article-data.md), and **the route and the
button are not written yet** — its stages D and F. The bundle builds; nothing calls it.

## What comes out

[`src/store/export-bundle.ts`](../../src/store/export-bundle.ts) assembles it, and the `readme()` at
the foot of that file is the layout's own documentation — it ships inside every zip. That is the
file-by-file list, and the thing to edit when the layout changes.

    manifest.json     what this export is, when it was made, and what was left out
    article.json      the article on your shelf: your title, your purpose, sharing state
    README.md         the above, for whoever writes an importer
    content/          stamped.html, extracted.html, blocks.json, block-identities.json, assets.json
    augmentations/    tree, glossary, glossary-lookups, ideas, quotes, timeline, quiz, sketch, arc,
                      tweets, labels, comments, chat, searches, referee-claims, referee-criteria

**Every file is optional and absent when there is nothing in it** — an article nobody chatted about
has no `chat.json` — except `manifest.json`, `article.json`, `README.md` and
`content/block-identities.json`, which are always written, the last even when empty. Anything
holding a list wraps it in a single-key object, so the format has somewhere to grow.

`articleBundle(slug)` is owner-scoped through `readArticleRows` and throws `ArticleNotFound` for a
slug that is not this reader's, which a route turns into a 404 rather than a 500.

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
the owner filter, and the `order by ordinal` that is the whole ballgame, since ids carry no position
— and each side projects those rows its own way. The rollback keeps its hand-written field lists,
because a byte comparison pins them. The bundle **serialises whole rows** and names only the handful
of columns it drops, so a column added to [`src/db/schema.ts`](../../src/db/schema.ts) reaches the
reader's download without anybody remembering it. Fidelity by construction rather than by memory:
`tools`, `stance`, `criterionId` and `valence` each went missing from `export.ts` for weeks, one
field list at a time.

The middle option — a synthesized model both sides project from — was proposed in review and turned
down. It would have to be rich enough for the bundle *and* lossily projectable back to a pinned
format, and the rows are already the faithful representation.

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
machinery rather than reader data.

`manifest.json` states all of this machine-readably under `omitted`, and that list is **derived from
`ARTICLE_TABLE_COVERAGE`** rather than written out beside it, so the manifest cannot drift from the
guard. The per-table reasons live in that record, one for each projection —
[database.md](database.md) has why the record exists at all, and what a day of silence cost when
`referee_criteria` was missing from it.

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
