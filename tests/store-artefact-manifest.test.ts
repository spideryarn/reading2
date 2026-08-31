/**
 * Every file an article directory can contain has a home in Postgres — and
 * a new one turns up here as a red test rather than as archaeology.
 *
 * ## Why this exists
 *
 * This migration was written against a schema that was one day old and already
 * behind. Five artefacts had no column and no table at all — `summary.json`,
 * `labels.json`, `chat.json`, `searches.json`, `glossary-lookups.json` — and
 * `src/glossary-lookups.ts` appeared *while the migration was being written*.
 * Several agents work this repo at once, and each new feature brings a new
 * file beside the article.
 *
 * Nothing would have reported that. The importer would have imported what it
 * knew about, the parity test would have compared what the importer imported,
 * and the reader's looked-up terms would simply not have been there. Every
 * check shared the same assumption about what exists, which is the failure mode
 * docs/reusable/silent-success.md is about: **the check must not share the
 * migration's blind spot.**
 *
 * So this test does not ask the migration what it handles. It asks the
 * *filesystem* what is there, and holds the answer against a list somebody had
 * to write down.
 *
 * ## When this fails
 *
 * You added an artefact. Give it a home and then add it here:
 *
 * - **A pipeline artefact** → a whole-artefact JSONB column on
 *   `article_revisions`, plus an entry in the `revision_step_runs` CHECK **if
 *   it is a `StepName`** (`labels.json` is not — it is one of `toc`'s outputs).
 * - **Reader state** → its own table keyed `(article_id, …)` with an
 *   `owner_id`, and **never** on a revision: a revision-keyed blob is deleted
 *   by re-extraction, which is the exact failure the identity split exists to
 *   prevent.
 *
 * Then teach `src/store/import.ts` and `src/store/export.ts` about it, and add
 * it to `ARTEFACTS` in tests/store-roundtrip.test.ts.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Every artefact, and where it lives once it is in Postgres.
 *
 * The value is documentation rather than something the test parses — the test
 * only cares that the *key* is here. But writing the destination down is what
 * makes the list a decision record instead of an allowlist somebody appends to
 * without thinking.
 */
const HOMES: Record<string, string> = {
  "raw.html": "article_revisions.raw_bytes",
  /* A PDF, and the record of which of the two it is. Stage 1 writes exactly one
     of `raw.html` / `raw.pdf` plus `raw.json` naming it — a refresh can leave
     both raw files there, and "whichever exists" then picks the stale one
     silently (docs/plans/pdf-ingestion.md). The bytes go in the same column
     either way; the manifest's fields are what the pipeline used to throw away,
     and `raw_content_type` and `raw_encoding` already exist for them. */
  "raw.pdf": "article_revisions.raw_bytes — the same column; raw.json says which arrived",
  "raw.json": "article_revisions.{raw_content_type,raw_encoding,requested_url,final_url,fetched_at} + a raw_sha256 column that does not exist yet",
  "meta.json": "article_revisions.{title,byline,site_name,lang,excerpt,note,final_url,fetched_at}",
  "blocks.json": "revision_blocks (+ block_identities)",
  "tree.json": "article_revisions.tree",
  "labels.json": "article_revisions.labels — a `toc` output, NOT a step of its own",
  /* The manifest is the column. The image bytes are content-addressed objects
     in the `sources` bucket and get no row of their own — an image is not the
     document, so `raw_sources.kind` stays `in ('pdf','html')`.
     docs/plans/hosting-the-articles-images.md. */
  "assets.json": "article_revisions.assets",
  /* The label run's checkpoint, and the one entry here whose home is decided
     but **not yet wired**. `src/db/schema.ts` § checkpoints says in as many
     words that the table is "the Postgres home of `labels-progress.json`", and
     `src/store/checkpoints.ts` exists — but `src/labels.ts` still reads and
     writes the flat file directly against `opts.dir` (`CHECKPOINT_FILE`, line
     877), so nothing puts one in Postgres today.

     It belongs here rather than in `NOT_YET_WRITTEN` for a reason the two
     lists' own headers settle: that one is for artefacts with **no example on
     disk**, and it clears itself the moment one appears — so an entry there
     would fail on the very file that prompted it. This list is a record of
     where a thing goes, not a claim that it has got there.

     What is genuinely unanswered is who *reclaims* a finished run's checkpoint
     once it is in Postgres: on the filesystem `scripts/checkpoints-sweep.ts`
     sweeps the `data/` root, which is a filesystem answer that does not carry
     over. docs/plans/delete-the-importer.md § D2 records it as open. */
  "labels-progress.json": "checkpoints (namespace 'toc-labels') — decided, not yet wired",
  "arc.json": "article_revisions.arc",
  "tweets.json": "article_revisions.tweets",
  "glossary.json": "article_revisions.glossary",
  "summary.json": "article_revisions.summary",
  "ideas.json": "article_revisions.ideas",
  "quotes.json": "article_revisions.quotes",
  "sketch.json": "article_revisions.sketch",
  /* The column does not exist yet — Stage 4 of docs/plans/timeline-mode.md adds
     it, with the `revision_step_runs_step` CHECK that drizzle will not write.
     The entry is here rather than in `NOT_YET_WRITTEN` because that list is for
     an artefact with **no example on disk**, and this one has one: the stage was
     run for real against `data/openai-huggingface` on 2026-08-31. This list is a
     record of where a thing goes, not a claim that it has got there — the same
     state `labels-progress.json` is in. */
  "timeline.json": "article_revisions.timeline — decided, column not yet written",
  "comments.json": "comments",
  "chat.json": "chat_threads + chat_messages",
  "searches.json": "search_runs (hits stay JSONB)",
  "glossary-lookups.json": "glossary_lookups",
  /* Reader state, and the one exception to "never on a revision" being stated
     as a positive: these four ARE on `articles` rather than on a table of their
     own. There is exactly one row per article and it is per-owner state on a
     table that already carries `owner_id`, so a join for four scalars would be
     ceremony. What matters is that they are not on `article_revisions` — a
     re-extraction must not un-archive an article or forget the reader's title. */
  "shelf.json": "articles.{archived_at,title_override,opens,last_opened_at}",
};

/**
 * Files that are deliberately NOT migrated, with the reason.
 *
 * A separate list from `HOMES` on purpose: "we decided not to" and "we have not
 * got to it" look identical in a single allowlist, and only one of them is a
 * finished decision.
 */
const NOT_MIGRATED: Record<string, string> = {
  ".DS_Store": "macOS. Not ours.",
  /* **This entry said the opposite until 2026-08-31, and it was stale.** It read
     "a decision not to migrate it, not an omission" — a cache, one file per page
     range, keyed on the PDF's bytes + the prompt version + the reader, holding
     the model's raw answer so that fixing the renderer or the checker costs
     nothing (docs/plans/pdf-ingestion.md).

     That decision was reversed and this list was never told. `src/db/schema.ts`
     § checkpoints names **both** checkpoint forms as the table's Postgres home,
     and `src/store/checkpoints.ts`'s namespace is a closed set containing
     exactly `toc-labels` and `pdf-chunk`. So it is migrated in the only sense
     this list asks about: it has a home, and the home was chosen deliberately.

     It stays in this list rather than moving to `HOMES` for one reason — it is
     a **directory**, not a file, and `HOMES` is keyed by filename. The entry
     below says where it goes so that the two lists stop contradicting each
     other. ⟨Sol⟩, 2026-08-31, on a review of `labels-progress.json`: PDF chunks
     and label checkpoints are in the same state, and either both are exempt or
     neither is.

     Like `labels-progress.json`, the destination and both adapters exist and
     **no caller is wired** — `src/pdf-read.ts` still reads and writes
     `data/<slug>/pdf-chunks` directly. Nothing here expires when that changes,
     which is the honest limit of this file: a name in any of these three lists
     makes the canary green whether or not the value is true. Only a behavioural
     test that runs a caller through a `CheckpointStore` and proves a second
     store instance reuses the entry can redden on the wiring. */
  "pdf-chunks": "checkpoints (namespace 'pdf-chunk') — decided, not yet wired",
  /* Not an artefact either, and not migrated *as a file* — but the thing it
     records is already in the schema. One marker per step that has started and
     not finished, which is what stops a step killed between two of its own
     writes reporting itself done with two generations mixed (`beginStep` in
     src/store/artifacts.ts). In Postgres that is
     `revision_step_runs.status = 'running'`, so there is nothing here to give a
     home to — the directory *is* the file store's rendering of that column, and
     it disappears with the file store. */
  steps: "revision_step_runs.status — the run marker, not an artefact",
};

/**
 * Artefacts that have a home and **no example on disk yet**, because the step
 * that writes them has only just been built.
 *
 * A third list, and it earns its place for the reason the header of
 * `NOT_MIGRATED` gives about the second one: "we decided this never appears"
 * and "nothing has written one yet" look identical in a single exemption, and
 * only one of them is finished. This one is the temporary kind.
 *
 * **It clears itself.** The check below fails if a name here *does* turn up —
 * so the first real run of the step is what forces the entry to be deleted,
 * rather than leaving an exemption that goes on quietly excusing a rotted
 * manifest entry for ever. That is the failure this whole file exists to catch,
 * and an exemption with no expiry would reintroduce it by the back door.
 */
const NOT_YET_WRITTEN: Record<string, string> = {
  /* Empty, and that is the list working rather than the list being unused.
     `assets.json` sat here from 2026-08-29 — "the assets step is new and has
     not been run against a real article" — until a real run on 2026-08-30
     produced one, and the assertion below duly failed and made somebody delete
     the line. It has a home in `HOMES` and always did.
     docs/plans/hosting-the-articles-images.md, stage B. */

  /* `quotes.json` sat here for a few hours on 2026-08-31 and is gone again,
     which is this pair of lists working exactly as `assets.json` did before it:
     a real run against `data/openai-huggingface` produced one, the assertion
     below duly failed, and the exemption had to be deleted rather than left to
     go on excusing a name that had arrived. docs/project/quotes.md. */
};

describe("the artefact manifest", () => {
  it("covers every file present in data/", async () => {
    const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true }).catch(
      () => [],
    );

    const seen = new Set<string>();
    for (const entry of entries) {
      // `_jobs` is the queue's, not an article's. `test-` directories are other
      // test files' fixtures, created and removed concurrently.
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("test-")) {
        continue;
      }
      const files = await readdir(path.join(ROOT, "data", entry.name)).catch(() => []);
      for (const file of files) seen.add(file);
    }

    const known = new Set([...Object.keys(HOMES), ...Object.keys(NOT_MIGRATED)]);
    const unaccounted = [...seen].filter((file) => !known.has(file)).sort();

    expect(
      unaccounted,
      unaccounted.length
        ? `These files sit beside an article and have no home in Postgres:\n` +
            `  ${unaccounted.join("\n  ")}\n` +
            `Read the header of this file — it says what to do.`
        : "",
    ).toEqual([]);
  });

  it("does not list artefacts that no longer exist anywhere", async () => {
    /* The list rotting the other way is quieter and just as real: a feature is
       removed, its file stops being written, and the entry here lingers —
       promising a home for something nobody produces, and making the manifest
       read as more complete than it is.

       `example/` counts as well as `data/`, because the fixture is the only
       place some artefacts survive on a fresh clone. */
    const seen = new Set<string>();
    /**
     * The same set, minus other test files' fixtures.
     *
     * The two assertions below want different evidence and this is the
     * difference. "Nothing writes this any more" is generous on purpose — a
     * fixture is enough to show the name is still in use. "This has arrived, so
     * delete the exemption" must not be: a `data/test-…` directory is another
     * suite's fixture, created and removed while this one runs, so counting it
     * would make the exemption clear itself on a *test* having written the file
     * — intermittently, depending on which suite is mid-run — rather than on
     * the pipeline having produced one.
     */
    const outsideFixtures = new Set<string>();
    const roots = [path.join(ROOT, "data"), path.join(ROOT, "example")];
    for (const root of roots) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      if (entries.some((e) => e.isFile())) {
        for (const entry of entries) {
          if (entry.isFile()) {
            seen.add(entry.name);
            outsideFixtures.add(entry.name);
          }
        }
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const files = await readdir(path.join(root, entry.name)).catch(() => []);
        for (const file of files) {
          seen.add(file);
          if (!entry.name.startsWith("test-")) outsideFixtures.add(file);
        }
      }
    }

    /* **The exemption is checked before it is used**, so it cannot outlive the
       thing it excuses. A name in `NOT_YET_WRITTEN` that has now appeared is a
       step that has run for real, and the entry has to go — otherwise the
       exemption goes on quietly excusing the same name the day the file stops
       being written, which is the exact rot the assertion below is for. */
    const arrived = Object.keys(NOT_YET_WRITTEN).filter((file) => outsideFixtures.has(file));
    expect(
      arrived,
      arrived.length
        ? `These have arrived, so delete them from NOT_YET_WRITTEN:\n  ${arrived.join("\n  ")}`
        : "",
    ).toEqual([]);

    // Only warn about the ones we claim to migrate; NOT_MIGRATED entries are
    // about files that may legitimately never appear, and NOT_YET_WRITTEN ones
    // about a step too new to have produced an example.
    const stale = Object.keys(HOMES).filter(
      (file) => !seen.has(file) && !(file in NOT_YET_WRITTEN),
    );
    expect(
      stale,
      stale.length
        ? `The manifest promises a home for artefacts nothing writes any more:\n  ${stale.join("\n  ")}`
        : "",
    ).toEqual([]);
  });
});
