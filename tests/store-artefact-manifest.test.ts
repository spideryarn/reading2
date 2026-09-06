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
 *   it is a `StepName`** (`labels.json` is not — it is one of `hierarchy`'s outputs).
 * - **Reader state** → its own table keyed `(article_id, …)` with an
 *   `owner_id`, and **never** on a revision: a revision-keyed blob is deleted
 *   by re-extraction, which is the exact failure the identity split exists to
 *   prevent.
 *
 * Then teach `SITES` in `src/store/artifacts-pg.ts` — which is where
 * `src/store/import.ts` used to be named, until it was deleted on 2026-09-01 —
 * and `src/store/export.ts` about it, add it to
 * `ROUNDTRIP_JSON_ARTEFACTS` in tests/helpers/roundtrip-artefacts.ts, and put an
 * example of it in the committed corpus.
 *
 * ## Which directory each test below judges against
 *
 * There are five tests. **Three read the committed corpus** at
 * tests/fixtures/data-root/data/, and two read only the lists in this file.
 *
 * **That used to be a split, and the split is what went on 2026-09-05.** Two of
 * the three read the developer's gitignored `data/` instead, on the argument
 * that "is there a filename nobody wrote down?" wants the most generous
 * evidence available and a laptop's `data/` is where a brand-new artefact shows
 * up first — they were **discovery canaries**, and they caught two real things
 * that way (`assets.json`, `quotes.json`). Stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * ended that: nothing writes an article into `data/` any more, so the generous
 * evidence does not exist and a scan of it would pass or fail on whether
 * somebody had run `npm run worktree:setup`. `scanData` below has the argument
 * in full.
 *
 * What has not changed is why the third one always read the commit. "Does the
 * manifest still describe things that exist?" is a **gate verdict**, so its
 * evidence must live in the commit. Until 2026-09-02 it read `data/` and
 * `example/`, and the verdict was therefore a property of one machine at one
 * moment: a real quiz generated into one laptop's `data/` cleared `quiz.json`'s
 * exemption, the tracked corpus never gained one, that laptop file later
 * vanished, and the gate went red for everybody with no commit in between.
 * docs/postmortems/260902c-a-test-whose-evidence-was-one-laptop.md.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURE_ROOT } from "./helpers/require-fixture.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * A corpus root, read out loud.
 *
 * **This used to be `readdir(...).catch(() => [])`, three times.** An absent
 * `data/` yielded `[]`, the scan below saw no files, `unaccounted` was empty
 * and the suite whose entire job is to notice a new artefact filename passed
 * having examined nothing — green, in 5ms, on a fresh clone where `data/` is
 * gitignored and therefore not there. Verified 2026-09-01 by running this file
 * against an empty tree: "covers every file present in data/" passed.
 *
 * An absent corpus is a broken checkout, not an empty set.
 * docs/plans/260901b-committed-fixture-corpus.md · docs/reusable/silent-success.md.
 */
async function corpusRoot(root: string) {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(
      `${root} could not be read (${code}), so this scan has nothing to scan.\n` +
        `That is a broken checkout rather than an empty set: this file reads the corpus to ` +
        `notice an artefact filename the manifest below does not know about, and with no ` +
        `corpus it can only ever pass.\n` +
        `See docs/plans/260901b-committed-fixture-corpus.md for where the corpus is supposed ` +
        `to come from.`,
    );
  }
}

/**
 * One article's filenames, **in the mutable `data/`**.
 *
 * `ENOENT` alone is swallowed, and only here: `data/` is shared mutable state
 * during a run, so a directory listed a millisecond ago can be another suite's
 * fixture on its way out. Every other error — a permission, an I/O fault — is a
 * reason the scan is not seeing what is there, and is thrown rather than read
 * as "this article has no files".
 *
 * The corpus scan below deliberately does **not** use this: nothing writes into
 * tests/fixtures/data-root/ during a run, so a directory that vanishes between
 * two calls there is a broken checkout and must be thrown.
 */
async function articleFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * The article directories in a corpus root.
 *
 * `_jobs` is the queue's, not an article's. `test-` directories are other test
 * files' fixtures, created and removed concurrently.
 */
function articleDirs(entries: Awaited<ReturnType<typeof corpusRoot>>): string[] {
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("test-"))
    .map((e) => e.name);
}

/**
 * The floor beneath the enumeration, and why it is a floor rather than a cage.
 *
 * The scan has to stay an enumeration — its whole value is catching a filename
 * **nobody wrote down**, which a fixed list cannot do, and its comments record
 * two real catches (`assets.json`, `quotes.json`). But an enumeration with no
 * floor is satisfied by zero, and by a corpus thinned to two metadata-only
 * directories, and by a `data/` holding nothing but another suite's leftover
 * `test-` fixtures. Each of those reads exactly like a clean run.
 *
 * `writes` is the named must-have because it is already this repo's ground
 * truth for "a healthy fixture set": `GATE_FIXTURES` in
 * `scripts/deploy-checks.ts` names it as the deploy gate's sentinel slug, and
 * `tests/artefact-copy.test.ts` hardcodes it as `SLUG`. It carries more artefact
 * names than any other directory here.
 *
 * This used to quote a file count and a byte total for it. Both were already
 * wrong — a measurement of `data/`, which is gitignored and changes under you,
 * written down where nothing re-runs it. That is a small helping of the same
 * disease as the rest of this file, so the numbers are gone rather than
 * corrected. ⟨Sol⟩, 2026-09-02.
 *
 * **The gate names a different copy of it, and that is worth knowing rather
 * than smoothing over.** Since 2026-09-01 `GATE_FIXTURES` names
 * `tests/fixtures/data-root/data/writes/…`, the tracked corpus, while this scan
 * reads `data/` — the working store, gitignored, whatever the machine happens to
 * hold. The slug is the same and the requirement is the same; the two paths are
 * not, and until the corpus seam lands for tests as well as for the gate, a
 * green here says nothing about the tracked copy being present. That is ranked
 * silent failure 1 in docs/plans/260901b-committed-fixture-corpus.md — some
 * readers on the tracked corpus, others still on laptop `data/`.
 */
const FLOOR_SLUG = "writes";

/** What every complete article in the corpus has, so a scan seeing none of them is broken. */
const FLOOR_FILES = ["blocks.json", "meta.json", "tree.json", "labels.json"];

/**
 * Every artefact, and where it lives once it is in Postgres.
 *
 * The value is documentation rather than something the test parses — the test
 * only cares that the *key* is here. But writing the destination down is what
 * makes the list a decision record instead of an allowlist somebody appends to
 * without thinking.
 */
const HOMES: Record<string, string> = {
  /* **An object in the `sources` bucket, named by the revision's reference** —
     `raw_source_sha256` + `raw_source_kind`, and `canonicalKey` in
     src/source.ts builds the key. This said `article_revisions.raw_bytes` until
     2026-09-01, when that column was dropped
     (docs/plans/260831b-finish-the-database-move.md § *Stage 4*). */
  "raw.html": "the sources bucket, via article_revisions.{raw_source_sha256,raw_source_kind}",
  /* A PDF, and the record of which of the two it is. Stage 1 writes exactly one
     of `raw.html` / `raw.pdf` plus `raw.json` naming it — a refresh can leave
     both raw files there, and "whichever exists" then picks the stale one
     silently (docs/plans/260826c-pdf-ingestion.md). The bytes go to the same
     bucket either way, and `raw_source_kind` — not the file's name — is what
     says which arrived.

     **No example in the committed corpus** — see `PENDING_CORPUS_EXAMPLE`,
     which says why the existing PDF tests do not stand in for one. */
  "raw.pdf": "the sources bucket — the same place; raw_source_kind says which arrived",
  "raw.json": "article_revisions.{raw_content_type,raw_encoding,requested_url,final_url,fetched_at} + a raw_sha256 column that does not exist yet",
  "meta.json": "article_revisions.{title,byline,site_name,lang,excerpt,note,final_url,fetched_at}",
  "blocks.json": "revision_blocks (+ block_identities)",
  "tree.json": "article_revisions.tree",
  "labels.json": "article_revisions.labels — a `hierarchy` output, NOT a step of its own",
  /* The manifest is the column. The image bytes are content-addressed objects
     in the `sources` bucket and get no row of their own — an image is not the
     document, so `raw_sources.kind` stays `in ('pdf','html')`.
     docs/plans/260829b-hosting-the-articles-images.md. */
  "assets.json": "article_revisions.assets",
  /* The label run's checkpoint. **Wired on 2026-09-01** (landing D2): the file
     is gone, `src/labels.ts` takes a `CheckpointStore` and writes one row per
     batch, and `StoreSession` is what hands it down. The name stays in this
     list because `data/` fixtures still carry the file and this list is what
     says where such a file's contents went — and it is classified in
     `RETIRED_FILE_REPRESENTATIONS`, not in `NOT_MIGRATED`, because its contents
     went somewhere and only the file is gone.

     Reclamation is answered too: `sweepPgCheckpoints` on `last_used_at`,
     `scripts/checkpoints-sweep.ts`, src/store/checkpoints.ts § Retention. There
     is deliberately no delete on success. */
  "labels-progress.json": "checkpoints (namespace 'hierarchy-labels')",
  "arc.json": "article_revisions.arc",
  "tweets.json": "article_revisions.tweets",
  "glossary.json": "article_revisions.glossary",
  "ideas.json": "article_revisions.ideas",
  "quotes.json": "article_revisions.quotes",
  "sketch.json": "article_revisions.sketch",
  /* The column is declared and its migration is written — `drizzle/0035_timeline.sql`,
     which also carries the `revision_step_runs_step` CHECK that drizzle-kit will
     not write. **Whether it has been APPLIED is a separate question and Greg's
     call every time**, so until he runs it this row says where the artefact goes
     and the database does not yet have the column. */
  "timeline.json": "article_revisions.timeline",
  /* `drizzle/0046_quiz.sql`, applied locally on 2026-09-01. It also carries the
     `revision_step_runs_step` CHECK that drizzle-kit will not write — the sixth
     migration in a row to have to. */
  "quiz.json": "article_revisions.quiz",
  "comments.json": "comments",
  "chat.json": "chat_threads + chat_messages",
  "searches.json": "search_runs (hits stay JSONB)",
  /* `drizzle/0042_referee_criteria.sql`. `results` stays JSONB for the reason
     `search_runs.hits` does — one model call's output, replaced together and
     never edited a row at a time.

     **Deliberately not in `ROUNDTRIP_JSON_ARTEFACTS`** (tests/helpers/roundtrip-artefacts.ts),
     unlike everything else on this list: no article in the committed corpus
     carries a criterion, and an artefact no fixture has makes that suite's
     `preserves %s exactly` row assert only that the export invented nothing —
     which is exactly the hole its own "has at least one article carrying each
     artefact" test exists to catch. The export is covered instead by
     tests/store-export-referee.test.ts, which makes the rows it needs. See
     `COVERED_BY_ANOTHER_TEST`. */
  "referee-criteria.json": "referee_criteria (results stay JSONB)",
  /* `drizzle/0051_referee_claims.sql`, applied locally on 2026-09-01. **It sat
     in `NOT_MIGRATED` until then**, saying the decision was "not this table, not
     yet": a claims run is an article-derived reusable artefact whose right home
     is a pipeline artefact, and a bespoke table for something already scheduled
     to be replaced is two migrations to reach one place. That is still true and
     `referee_claims` still calls itself an interim — what changed is that the
     alternative was a sub-mode returning 501 for every operation in the only
     configuration that deploys.

     Like `referee-criteria.json` it is **deliberately not in
     `ROUNDTRIP_JSON_ARTEFACTS`**: no article in the committed corpus carries a
     claims run, so that suite's `preserves %s exactly` row would assert only that
     the export invented nothing. The export is covered instead by the sentinel
     fixture in tests/store-export-covers-tables.test.ts, which inserts a row and
     requires it back out of this file. See `COVERED_BY_ANOTHER_TEST`. */
  "referee-claims.json": "referee_claims (one row per article, claims stay JSONB)",
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
  /* **Deleted rather than unmigrated**, and the distinction is this list's
     whole point. Stage 5e wrote the generated summary ladder here until
     2026-08-31; the stage, the artefact kind, every reader of it and the
     `article_revisions.summary` column are all gone
     (docs/plans/260831s-gist-only-summaries.md, drizzle/0036). `data/` is gitignored, so
     the files linger on whichever machine ran the stage — orphans that nothing
     reads and nothing moves. */
  "summary.json": "deleted with stage 5e; no home, because there is nothing to home",
  /* **`pdf-chunks` and `steps` were both here until 2026-09-02** and are now in
     `RETIRED_DIRECTORY_REPRESENTATIONS`. Each of them explained, in this list,
     where its contents had been migrated to — which is the opposite of what this
     list says it means. Two names is all that is left, and both are true ones:
     one is not ours, and the other has nothing to home. */
};

/**
 * Why a name has **no example in the committed corpus**.
 *
 * `why` is the sentence somebody has to be able to disagree with; nothing can
 * check it. `evidence` is the part that can be, so it is not a bare path:
 *
 * - `file` is repository-relative and must be **tracked in git**. An earlier
 *   draft of this checked `existsSync` and nothing else, which let any file on
 *   the machine — an untracked scratch file included — validate a committed
 *   policy. That is this incident's own class reappearing inside the guard
 *   written to prevent it. ⟨Sol⟩, 2026-09-02.
 * - `contains` is a needle specific to *this* artefact that the evidence file
 *   must actually contain. Existence alone proves only that somebody once
 *   created a file with the right name; the needle is what fails when a test is
 *   rewritten until it no longer touches the thing it is cited for.
 *
 * Neither is a promise the named test would go red. Nothing mechanical can
 * check that, and pretending otherwise is how a manifest starts lying — so the
 * bar stated in each list's header is a human one, and this pair only stops the
 * citation rotting underneath it.
 */
type Unexampled = { why: string; evidence: { file: string; contains: string } };

/**
 * Artefacts with a home and no corpus example **yet**, because the step that
 * writes them is new or the example is expensive to commit.
 *
 * The temporary list, and it is the one that gets abused, so it is narrowly
 * named on purpose: not "no example", but "no example *in the corpus*, and
 * somebody owes one".
 *
 * **It clears itself.** The arrival check below fails the moment a name here
 * turns up in the committed corpus, so the first real example forces the entry
 * to be deleted rather than leaving an exemption quietly excusing a manifest
 * entry that has rotted. That is the failure this whole file exists to catch.
 *
 * ## Why it survived the redesign
 *
 * Deleting the escape hatch outright sounds principled and is not. Registration
 * and the first real generation legitimately land in separate commits, and with
 * no deterministic pending state the next person forces the deploy gate
 * instead — which is exactly the habit
 * docs/plans/260902g-corpus-evidence-for-artefact-coverage.md exists to end.
 * ⟨Sol⟩, 2026-09-02: the temporary exemption was not the root defect; its
 * evidence source was, and that is what changed.
 *
 * Its three previous occupants — `assets.json` (2026-08-29), `quotes.json`
 * (2026-08-31), `quiz.json` (2026-09-01) — each cleared within days, which is
 * the shape a healthy entry has. The third one cleared **wrongly**, on a file
 * in one laptop's gitignored `data/`, and that is the bug: the arrival check
 * now reads the corpus and nothing else.
 */
const PENDING_CORPUS_EXAMPLE: Record<string, Unexampled> = {
  /* **Not "covered elsewhere", and the distinction is the whole point.** It is
     tempting to call the PDF path already tested and move on. It is not:
     tests/store-export-raw.test.ts drives `writes`, whose source is `raw.html`
     (:64), and the PDF cases in tests/store-roundtrip.test.ts call
     `rawFileName` directly (:769) rather than exporting an article. So a
     mutation making `writeRawDocument` always write `raw.html` passes both. An
     exemption resting on that would be a claim of coverage we do not have,
     which is how this file came to be wrong in the first place.

     A corpus example is not the answer either — tests/fixtures/data-root/README.md
     says not to duplicate the large PDFs. **The right fix is an end-to-end
     `exportArticle` test over small synthetic PDF bytes**, and it is out of
     scope for 260902g. Until it exists this entry says so out loud. */
  "raw.pdf": {
    why: "the corpus carries no PDF article, and the existing PDF tests do not exercise exportArticle end to end — a follow-up test over small synthetic PDF bytes is what clears this, not a committed PDF",
    evidence: {
      file: "docs/plans/260902g-corpus-evidence-for-artefact-coverage.md",
      contains: "raw.pdf",
    },
  },
};

/**
 * Artefacts whose **contents are migrated and whose file is retired**.
 *
 * A separate classification from `NOT_MIGRATED`, and the reason is that
 * `NOT_MIGRATED` means "we decided not to". Putting a migrated-but-retired file
 * there records a decision nobody made, which is the same rot in a new list —
 * ⟨Sol⟩, 2026-09-02, reviewing docs/plans/260902g-corpus-evidence-for-artefact-coverage.md.
 *
 * The name keeps its `HOMES` entry, because that entry is the true answer to
 * "where did the contents of this file go?", and `data/` fixtures on older
 * machines still carry the file. What it does not have, and can never regain,
 * is a corpus example — nothing writes one any more.
 *
 * `evidence` names the test that covers the contents **now**, in their new home.
 * Without that this list would be an unfalsifiable "it's fine, honest".
 */
const RETIRED_FILE_REPRESENTATIONS: Record<string, Unexampled> = {
  /* Wired on 2026-09-01: `src/labels.ts` takes a `CheckpointStore` and writes a
     row per batch instead of a file. See the `HOMES` entry for the retention
     answer. `pdf-chunks` is in the same state and is one list further down, in
     `RETIRED_DIRECTORY_REPRESENTATIONS`, for the one reason that it is a
     directory and has no `HOMES` key to be exempted from. */
  "labels-progress.json": {
    why: "the label run's checkpoint is rows in `checkpoints` (namespace 'hierarchy-labels'); nothing writes the file any more, so no corpus example can ever exist",
    evidence: {
      file: "tests/checkpoints-durable-resume.test.ts",
      contains: "hierarchy-labels",
    },
  },
};

/**
 * Directories beside an article whose **contents are migrated and whose
 * directory is retired**, and which the discovery scan must therefore recognise.
 *
 * The same honesty as `RETIRED_FILE_REPRESENTATIONS` for the two names that are
 * directories rather than files. Both sat in `NOT_MIGRATED` until 2026-09-02,
 * and both contradicted that list's own contract in their own text: it says
 * "we decided not to migrate this", and each of them then explained where its
 * contents had been migrated to.
 *
 * **These are not exemptions.** They excuse nothing, because neither name is a
 * key of `HOMES` — nothing ever promised them a home *as a file*. All they do is
 * keep the "a filename nobody wrote down" scan from reporting a directory it has
 * always known about. Keeping the two jobs apart is what the check below
 * enforces, and it is why the earlier attempt to leave `pdf-chunks` in
 * `NOT_MIGRATED` was wrong: the invariant it was protecting is about the
 * exemption lists, and this is not one. ⟨Sol⟩, 2026-09-02.
 */
const RETIRED_DIRECTORY_REPRESENTATIONS: Record<string, Unexampled> = {
  /* **This entry said the opposite until 2026-08-31, and it was stale.** It read
     "a decision not to migrate it, not an omission" — a cache, one file per page
     range, keyed on the PDF's bytes + the prompt version + the reader, holding
     the model's raw answer so that fixing the renderer or the checker costs
     nothing (docs/plans/260826c-pdf-ingestion.md).

     That decision was reversed and the list was never told. `src/db/schema.ts`
     § checkpoints names **both** checkpoint forms as the table's Postgres home,
     and `src/store/checkpoints.ts`'s namespace is a closed set containing
     exactly `hierarchy-labels` and `pdf-chunk`. ⟨Sol⟩, 2026-08-31, on a review of
     `labels-progress.json`: PDF chunks and label checkpoints are in the same
     state, and either both are exempt or neither is. They are now classified
     together, one list apart only because one is a file and one is a directory.

     Like `labels-progress.json`, it was **decided and not wired** until
     2026-09-01, and the note that used to sit here named the only thing that
     could ever have caught that: *"a name in any of these three lists makes the
     canary green whether or not the value is true. Only a behavioural test that
     runs a caller through a `CheckpointStore` and proves a second store instance
     reuses the entry can redden on the wiring."* That test now exists, and is
     what `evidence` points at. */
  "pdf-chunks": {
    why: "the PDF chunk cache is rows in `checkpoints` (namespace 'pdf-chunk'); the directory is the file store's rendering of it and goes with the file store",
    evidence: {
      file: "tests/checkpoints-durable-resume.test.ts",
      contains: "pdf-chunk",
    },
  },
  /* Never an artefact — one marker per step that has started and not finished,
     which is what stops a step killed between two of its own writes reporting
     itself done with two generations mixed (`beginStep` in
     src/store/artifacts.ts). In Postgres that is
     `revision_step_runs.status = 'running'`, and the directory is the file
     store's rendering of that column. */
  steps: {
    why: "the run marker is `revision_step_runs.status`; the directory is the file store's rendering of that column and goes with the file store",
    evidence: {
      file: "tests/pg-session-exact-base.test.ts",
      contains: "revision_step_runs",
    },
  },
};

/**
 * Artefacts a **dedicated test** covers instead of the corpus.
 *
 * Permanent and reasoned, unlike `PENDING_CORPUS_EXAMPLE`: these are not
 * waiting for anything. No committed article carries one, and putting one in
 * the corpus would buy less than the test already there — a suite that inserts
 * the rows it needs proves the export writes the file, where a corpus example
 * would only prove the round trip did not lose it.
 *
 * The bar for entry is that the named test **would redden** if the export
 * stopped writing the file. That bar is why `raw.pdf` is in
 * `PENDING_CORPUS_EXAMPLE` and not here.
 */
const COVERED_BY_ANOTHER_TEST: Record<string, Unexampled> = {
  "referee-criteria.json": {
    why: "no committed article carries a criterion; the export is proved by a suite that makes the rows it needs",
    evidence: {
      file: "tests/store-export-referee.test.ts",
      contains: "referee-criteria.json",
    },
  },
  /* tests/store-export-covers-tables.test.ts:724 inserts a sentinel claims row
     and requires it back out of this exact filename, so an export that stopped
     writing it fails there. */
  "referee-claims.json": {
    why: "no committed article carries a claims run; a sentinel row is inserted and required back out of this filename",
    evidence: {
      file: "tests/store-export-covers-tables.test.ts",
      contains: "referee_claims",
    },
  },
};

/**
 * The exemptions: **why a `HOMES` name has no corpus example.** Every key must
 * be a `HOMES` key, or it excuses nothing.
 */
const EXEMPTIONS: [string, Record<string, Unexampled>][] = [
  ["PENDING_CORPUS_EXAMPLE", PENDING_CORPUS_EXAMPLE],
  ["RETIRED_FILE_REPRESENTATIONS", RETIRED_FILE_REPRESENTATIONS],
  ["COVERED_BY_ANOTHER_TEST", COVERED_BY_ANOTHER_TEST],
];

/**
 * The kinds: **what a name beside an article is.** Every name has exactly one,
 * so these three must be disjoint.
 *
 * A separate layer from `EXEMPTIONS`, and the distinction is worth holding on
 * to: an exemption key is *also* a `HOMES` key, deliberately, so a single
 * "nothing is classified twice" sweep over all six lists would forbid the very
 * thing the exemptions are for. Two layers, two rules — a name has one kind, and
 * a `HOMES` name has at most one excuse.
 *
 * The first draft checked neither, so `labels-progress.json` could sit in
 * `NOT_MIGRATED` ("we decided not to") and `RETIRED_FILE_REPRESENTATIONS` ("its
 * contents moved") at once, two flatly contradictory classifications, with every
 * assertion green. ⟨Sol⟩, 2026-09-02.
 */
const KINDS: [string, Record<string, unknown>][] = [
  ["HOMES", HOMES],
  ["NOT_MIGRATED", NOT_MIGRATED],
  ["RETIRED_DIRECTORY_REPRESENTATIONS", RETIRED_DIRECTORY_REPRESENTATIONS],
];

/** Every name any list in this file knows about, whatever it says about it. */
const KNOWN_NAMES = new Set(KINDS.flatMap(([, list]) => Object.keys(list)));

/**
 * Every list whose entries carry a `why` and an `evidence`, and whether it is an
 * exemption (so its keys must be `HOMES` keys) or a directory representation (so
 * its keys must not be).
 */
const REASONED: [string, Record<string, Unexampled>, boolean][] = [
  ...EXEMPTIONS.map(([n, l]) => [n, l, true] as [string, Record<string, Unexampled>, boolean]),
  ["RETIRED_DIRECTORY_REPRESENTATIONS", RETIRED_DIRECTORY_REPRESENTATIONS, false],
];

/** One list's citation of a file that is supposed to back it up. */
type Citation = { at: string; file: string; contains: string };

/**
 * What is wrong with each citation — rule 4 of the classification check.
 *
 * `git ls-files` rather than `existsSync`, in one call for every path: an
 * untracked file is on one machine and the policy is in the commit, which is the
 * whole argument of this file. An earlier draft checked existence alone, so any
 * file on the laptop — a scratch note included — could stand as evidence for a
 * committed exemption. ⟨Sol⟩, 2026-09-02. The `git ls-files` pattern is
 * `trackedSources()` in tests/no-undeclared-spend.test.ts.
 *
 * The needle is the other half. A tracked file with the right *name* proves
 * nothing about what is in it, and a test rewritten until it no longer touches
 * the artefact it is cited for leaves the citation looking fine.
 */
function evidenceProblems(citations: Citation[]): string[] {
  const shape = /^(tests|docs)\/[A-Za-z0-9._/-]+$/;
  const wellFormed = (c: Citation) => shape.test(c.file) && !c.file.includes("..");

  const problems = citations
    .filter((c) => !wellFormed(c))
    .map(
      (c) => `${c.at} points at ${c.file}, which is not a repository-relative tests/ or docs/ path`,
    );

  const paths = [...new Set(citations.filter(wellFormed).map((c) => c.file))];
  const tracked = new Set(
    paths.length
      ? execFileSync("git", ["ls-files", "-z", "--cached", "--", ...paths], {
          cwd: ROOT,
          encoding: "utf8",
        })
          .split("\0")
          .filter(Boolean)
      : [],
  );

  for (const c of citations.filter(wellFormed)) {
    if (!tracked.has(c.file)) {
      problems.push(`${c.at} points at ${c.file}, which is not tracked in git`);
    } else if (!readFileSync(path.join(ROOT, c.file), "utf8").includes(c.contains)) {
      problems.push(`${c.at}: ${c.file} does not mention ${JSON.stringify(c.contains)}`);
    }
  }

  return problems;
}

/**
 * The scan the first two tests run: every filename beside an article in the
 * **committed corpus**.
 *
 * **It read the gitignored `data/` until 2026-09-05**, and the reason it could
 * is the reason it no longer should. `data/` was where a laptop's own runs put
 * their artefacts, so it was the most generous evidence available and the first
 * place a brand-new artefact filename ever appeared — which is exactly what a
 * discovery canary wants, and both of this scan's real catches (`assets.json`,
 * `quotes.json`) worked that way.
 *
 * Stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * finished deleting the filesystem store, so **nothing writes an article into
 * `data/` any more**: a new step's artefact is a column or a table. What is left
 * there is whatever `npm run worktree:setup` last copied out of the corpus, so
 * a scan of it is a scan of the corpus with an extra way to be absent — the
 * verdict would pass or fail on whether somebody had run the setup script,
 * which is a property of a machine and not of a commit. That is the same defect
 * docs/postmortems/260902c-a-test-whose-evidence-was-one-laptop.md is about,
 * arriving from the other direction: there the evidence was one laptop's file,
 * here it would be one laptop's *absence*.
 *
 * **What that costs, said plainly.** The canary and the staleness verdict now
 * read the same directory, so they are two directions of one comparison —
 * `HOMES` covers everything the corpus carries, and the corpus (or a written
 * exemption) covers everything in `HOMES`. A brand-new artefact is therefore
 * noticed when somebody commits an example of it, which is one step later than
 * before. The header already tells whoever adds an artefact to commit that
 * example, and there is no earlier moment left to notice it in.
 */
async function scanData(): Promise<{ articles: string[]; seen: Set<string> }> {
  const data = path.join(FIXTURE_ROOT, "data");
  const articles = articleDirs(await corpusRoot(data));
  const seen = new Set<string>();
  for (const slug of articles) {
    for (const file of await articleFiles(path.join(data, slug))) seen.add(file);
  }
  return { articles, seen };
}

/**
 * Every filename beside an article in the **committed corpus**.
 *
 * The evidence the staleness verdict is made from, and the reason it is a
 * separate function from `scanData` rather than a parameter: they are not the
 * same kind of evidence, and reading them through one function is how the two
 * questions got confused in the first place.
 *
 * No ENOENT swallowing and no `test-` filtering, both of which `scanData` needs
 * and this must not have. Nothing writes into tests/fixtures/data-root/ during a
 * run — every suite that uses the corpus copies *out* of it — so there are no
 * concurrent fixture directories to skip and no directory that can disappear
 * mid-scan. A read that fails here is a broken checkout, and `corpusRoot` says
 * so loudly.
 *
 * **Real files only.** A committed directory named `raw.pdf/` would otherwise
 * count as an example of `raw.pdf`: it would clear the pending entry, satisfy
 * the staleness check, and contain no PDF at all — evidence in the commit, and
 * still no artefact. ⟨Sol⟩, 2026-09-02.
 */
async function scanFixtureCorpus(): Promise<Set<string>> {
  const data = path.join(FIXTURE_ROOT, "data");
  const seen = new Set<string>();
  for (const entry of await corpusRoot(data)) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(path.join(data, entry.name), {
      withFileTypes: true,
    });
    for (const file of files) {
      if (file.isFile()) seen.add(file.name);
    }
  }
  return seen;
}

describe("the artefact manifest", () => {
  /**
   * **The floor, and it is the point of this pair.** The test below can only
   * fail on a filename it has actually read, so everything that quietly reduces
   * what it reads — a missing corpus, a thinned one, one holding nothing but a
   * peer's leftovers — turns it green rather than red. That is the failure
   * mode, so it gets its own red rather than a clause hidden inside the scan.
   */
  it("has a corpus rich enough for that to mean anything", async () => {
    const { articles, seen } = await scanData();

    expect(
      articles.length,
      `no article directories under ${path.join(FIXTURE_ROOT, "data")} — only ` +
        `\`_\`-prefixed and \`test-\` ones, which are the queue's and other suites' fixtures`,
    ).toBeGreaterThan(0);

    expect(
      articles,
      `${FLOOR_SLUG} is the sentinel slug GATE_FIXTURES in scripts/deploy-checks.ts and ` +
        `tests/artefact-copy.test.ts both name, and the richest article in the corpus. ` +
        `Without it this scan can be green over a corpus too thin to catch anything.`,
    ).toContain(FLOOR_SLUG);

    const missing = FLOOR_FILES.filter((file) => !seen.has(file));
    expect(
      missing,
      missing.length
        ? `The scan read ${articles.length} article directories and did not see:\n` +
            `  ${missing.join("\n  ")}\n` +
            `Every complete article has all of these, so either the corpus is not one or the ` +
            `scan is walking the wrong tree.`
        : "",
    ).toEqual([]);
  });

  it("covers every file the committed corpus carries", async () => {
    /* **This read `data/` until 2026-09-05, and `scanData` above says why it
       stopped.** In short: nothing writes an article into `data/` any more, so
       the generous evidence that made it a discovery canary no longer exists,
       and reading it would make the verdict depend on whether somebody had run
       `npm run worktree:setup`.

       It is the opposite direction from the staleness test below — that one
       asks whether `HOMES` still describes things that exist, this one whether
       anything exists that `HOMES` has never heard of — and both now read the
       commit. Until 2026-09-02 both read `data/`, and conflating them is what
       let a file on one laptop stand in for evidence everybody could see. */
    const { seen } = await scanData();

    /* `KNOWN_NAMES` is the union of the three *kinds*, not of all six lists: a
       name is accounted for by having a kind, and the exemption lists say
       something else entirely (why a `HOMES` name has no corpus example). The
       two directory names are in there because this scan reads directory names
       too, and always has. */
    const unaccounted = [...seen].filter((file) => !KNOWN_NAMES.has(file)).sort();

    expect(
      unaccounted,
      unaccounted.length
        ? `These files sit beside a corpus article and have no home in Postgres:\n` +
            `  ${unaccounted.join("\n  ")}\n` +
            `Read the header of this file — it says what to do.`
        : "",
    ).toEqual([]);
  });

  it("does not list artefacts the committed corpus no longer carries", async () => {
    /* The list rotting the other way is quieter and just as real: a feature is
       removed, its file stops being written, and the entry here lingers —
       promising a home for something nobody produces, and making the manifest
       read as more complete than it is.

       **The evidence is the committed corpus and nothing else**, which is the
       whole of docs/plans/260902g-corpus-evidence-for-artefact-coverage.md.
       This read `data/` and `example/` until 2026-09-02, so its verdict was a
       property of one machine at one moment and flipped without a commit. Every
       name in `HOMES` therefore needs either an article in
       tests/fixtures/data-root/data/ carrying it, or a line in one of the three
       classification lists saying why it never will.

       `example/` is gone from the scan too, and it was the same defect in
       gentler clothing: it survives a fresh clone, but it holds four files, so
       what it actually did was let four names skip the corpus. */
    const seen = await scanFixtureCorpus();

    /* **The exemption is checked before it is used**, so it cannot outlive the
       thing it excuses. A name in `PENDING_CORPUS_EXAMPLE` that the corpus now
       carries is an example that has arrived, and the entry has to go —
       otherwise the exemption goes on quietly excusing the same name the day
       the file stops being written, which is the exact rot the assertion below
       is for.

       One set now, where there used to be two. `seen` and `outsideFixtures`
       existed because `data/` is shared mutable state: a `data/test-…`
       directory is another suite's fixture, so counting it would clear an
       exemption on a *test* having written the file, intermittently, depending
       on which suite was mid-run. Nothing writes into the committed corpus —
       every suite that uses it copies out of it into a scratch slug — so there
       is no second, less trusted class of evidence left to separate out. */
    const arrived = Object.keys(PENDING_CORPUS_EXAMPLE).filter((file) => seen.has(file));
    expect(
      arrived,
      arrived.length
        ? `The corpus now carries these, so delete them from PENDING_CORPUS_EXAMPLE:\n  ${arrived.join("\n  ")}`
        : "",
    ).toEqual([]);

    const excused = new Set(EXEMPTIONS.flatMap(([, list]) => Object.keys(list)));
    const stale = Object.keys(HOMES).filter((file) => !seen.has(file) && !excused.has(file));
    expect(
      stale,
      stale.length
        ? `No article in tests/fixtures/data-root/data/ carries these, and no list says why:\n` +
            `  ${stale.join("\n  ")}\n` +
            `Either commit an example to the corpus, or classify each one — ` +
            `PENDING_CORPUS_EXAMPLE, RETIRED_FILE_REPRESENTATIONS or COVERED_BY_ANOTHER_TEST, ` +
            `whichever is true.`
        : "",
    ).toEqual([]);
  });

  /**
   * **The lists are checked, not trusted.**
   *
   * Every one of them is a way to turn the assertion above green by typing, and
   * a policy list with nothing checking it is a check that cannot fail — which
   * is what the first draft of this work shipped, twice, both times found by
   * ⟨Sol⟩ rather than by anything here. So four rules:
   *
   * 1. **One kind per name.** `HOMES`, `NOT_MIGRATED` and
   *    `RETIRED_DIRECTORY_REPRESENTATIONS` say what a name *is*, and they
   *    contradict each other, so they must be disjoint. The first draft swept
   *    only the exemption lists, which let `labels-progress.json` be both
   *    "deliberately not migrated" and "migrated, file retired" at once.
   * 2. **One excuse per `HOMES` name**, and only for a `HOMES` name — an
   *    exemption on a name the manifest never claimed excuses nothing.
   * 3. **A reason somebody can disagree with.** Not checkable beyond being
   *    there; it is for the reader.
   * 4. **Evidence that is tracked, and that mentions the artefact.** See
   *    `Unexampled` — `existsSync` alone let any file on the machine validate a
   *    committed policy, which is this incident's own class.
   *
   * Rule 1 gets its own test below because it is about a different set of lists,
   * and because five findings arriving in one `problems` array is a red nobody
   * can attribute.
   */
  /** Rule 1, on its own so that a red here means only this. */
  it("gives every artefact name exactly one kind", () => {
    const problems: string[] = [];
    const kindOf = new Map<string, string>();
    for (const [listName, list] of KINDS) {
      for (const file of Object.keys(list)) {
        const already = kindOf.get(file);
        if (already) problems.push(`${file} has two kinds: ${already} and ${listName}`);
        else kindOf.set(file, listName);
      }
    }
    expect(problems).toEqual([]);
  });

  /** Rules 2, 3 and 4. */
  it("gives every excused artefact a reason and tracked evidence that names it", () => {
    const problems: string[] = [];

    /* Rules 2 and 3, plus the evidence paths for rule 4. */
    const excusedBy = new Map<string, string>();
    const evidence: Citation[] = [];
    for (const [listName, list, isExemption] of REASONED) {
      for (const [file, entry] of Object.entries(list)) {
        if (isExemption) {
          const already = excusedBy.get(file);
          if (already) problems.push(`${file} is excused twice: ${already} and ${listName}`);
          else excusedBy.set(file, listName);

          if (!(file in HOMES)) {
            problems.push(
              `${listName}.${file} excuses a name that is not in HOMES, so it excuses nothing`,
            );
          }
        } else if (file in HOMES) {
          /* A directory representation is not an exemption, so it must not be a
             `HOMES` key — that is the confusion this pair of layers exists to
             stop, and it is how `pdf-chunks` nearly went into the wrong list. */
          problems.push(`${listName}.${file} is also a HOMES key, so it is claiming to be both`);
        }

        if (entry.why.trim().length === 0) problems.push(`${listName}.${file} has no reason`);
        evidence.push({ at: `${listName}.${file}`, ...entry.evidence });
      }
    }

    problems.push(...evidenceProblems(evidence));

    expect(problems).toEqual([]);
  });
});
