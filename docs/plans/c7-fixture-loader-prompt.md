# C7 — replacing `importArticle` in three test suites. Three decisions, please.

You are reviewing a **design**, before it is built. Repo: `spideryarn2`, an AI-assisted reading tool.
Plan: `docs/plans/delete-the-importer.md` (you have reviewed it three times; § C7 is the part in
question). Read that file's § C7 and § The publication gate, as a truth table first.

## Context you need

`db:import` (`src/store/import.ts`) is being deleted. It moved a filesystem article into Postgres in
one go, including reader state, and it wrote `revision_step_runs` rows with
`input_hash = hashBlocks(blocks)` and `implementation_version = 'imported'` for **every** step,
whether or not the artefact on disk could support that claim.

Three suites used it purely as a fixture loader:
`tests/store-parity.test.ts`, `tests/store-roundtrip.test.ts`, `tests/chat-anchor.test.ts`.

The replacement is `tests/helpers/load-article.ts` (new, attached below), which drives the **real**
write path: a running `jobs` row → `openOrBeginJobDraft` → `copyArtefacts` (fs store → `pgArtifactsIn`,
`beginStep`/`write`/`finishStep` per step, in pipeline order) → `publishRevision` → release the job.

**It is built and it works.** Measured against the live local database, over the seven `data/`
fixtures that have both `blocks.json` and `tree.json`:

```
constitution                     FAILED to publish (see decision 1)
fowler-phrenology                6 steps, published, Article differs only in meta.fetchedAt
noema-mythology-of-conscious-ai  8 steps, published, Article identical
revistes-ub-30977                5 steps, published, Article differs only in meta.fetchedAt
source                           5 steps, published, Article differs only in meta.fetchedAt
source-2                         5 steps, published, Article differs only in meta.fetchedAt
writes                           9 steps, published, Article identical
```

(Comparison is the full `Article` from `fsArticleReader.loadArticle` vs `pgArticleReader.loadArticle`,
serialised with keys sorted recursively, so key order is not a difference.)

**One caveat on that evidence, which I want you to weigh.** Those rows were produced against a
database that still holds articles a previous `importArticle` run published. `beginDraftIn` carries
columns forward from the published revision, so a column the artefact path never writes can still
read back correct. `noema-mythology-of-conscious-ai` has no `raw.json` at all, so its `fetch` step is
skipped entirely and `fetched_at`/`final_url` are written by nothing — yet it compared identical.
I believe that is carry-forward from the old import, and that on a clean database it would differ.
I have not yet run it clean. Tell me if you think anything else in that table is contaminated the
same way.

## Decision 1 — `constitution` cannot be published, and I think that is correct

`STAMP_SOURCE.toc = "labels"`, so the `toc` step's `inputHash` is `labels.json`'s `sourceHash`.
`data/constitution/labels.json` predates that field:

```
constitution        sourceHash= None   keys= ['batches','generator','labels','slug','version']
every other slug    sourceHash= <hex>  keys= [...,'sourceHash','structureHash']
```

So `copyArtefacts` leaves `NO_INPUT_HASH` on the `toc` run row, and `reasonsNotToPublish` refuses:

> Refusing to publish "constitution": the tree was built from different blocks (toc ran against
> unstamped, these blocks are b520d796c43fbf6c) — re-run toc

`importArticle` never hit this because it wrote `hashBlocks(blocks)` as the input hash for every step
regardless — the exact dishonesty this landing exists to remove.

Note this can only arise from **legacy filesystem data**. Stage 4 has written `sourceHash` for a long
time, so no pipeline run produces it; after the demolition there is no path that can.

My options:

- **(a) Assert the refusal.** Keep `constitution` in the corpus and give it one test saying it
  refuses to publish, with that reason. The stale fixture becomes coverage of the publication gate.
  Risk: it silently becomes a no-op the day somebody re-runs `npm run toc constitution`.
- **(b) Re-run stage 4 on `constitution`** so its fixture is current. Costs a model call and rewrites
  `tree.json` and `labels.json`, which other tests may pin.
- **(c) Hand-write a `sourceHash` into its `labels.json`.** Cheap, and I think dishonest — it asserts
  those labels were built from those blocks, which nobody knows.
- **(d) Drop it from the corpus** with a loud reason.

I lean (a), plus a guard so it cannot go quiet: the test asserts *both* that the labels file has no
`sourceHash` and that publication refuses, so regenerating the fixture turns the test red rather than
green. Is that the right instinct, or is a fixture that must stay stale a trap?

## Decision 2 — `meta.fetchedAt` genuinely differs, and parity has to say so

The two stores disagree, on purpose, because of a decision this plan already made:

```
fowler-phrenology   meta.json fetchedAt = 17:26:00.108Z   raw.json fetchedAt = 17:17:48.176Z
source              meta.json fetchedAt = 22:04:06.043Z   raw.json fetchedAt = 22:03:20.693Z
writes              meta.json fetchedAt = 11:09:34.025Z   raw.json fetchedAt = 11:09:34.025Z  (same run)
```

`src/extract.ts` sets `meta.fetchedAt = new Date()` — its own clock. So the filesystem's number is
*when extraction last ran*. `META_COLUMNS` in `src/store/artifacts-pg.ts` therefore excludes
`fetchedAt`, `finalUrl` and `rawSha256`, and the `fetch` step owns them via the raw manifest, because
the shelf sorts on that column and letting extract write it sends every re-extracted article to the
top of the library.

Consequence: `Article.meta.fetchedAt` cannot be equal across the two stores for any article extracted
in a later run than it was fetched.

My proposal: the parity suite compares the full `Article` **with `meta.fetchedAt` exempted**, and pays
for the exemption with two positive assertions that pin *why* — Postgres's value equals `raw.json`'s,
the filesystem's equals `meta.json`'s. So the divergence is asserted rather than hidden.

Is an exemption plus two positive assertions enough, or does an exempted field in the one suite the
whole migration rests on need something stronger?

## Decision 3 — what the fixture loader should carry, and what each suite supplies

`copyArtefacts` moves only what `ArtifactStore` owns. It writes nothing to `articles`, and no reader
state at all. Specifically it does **not** write:

- `articles.created_at` (importer seeded it from `meta.fetchedAt ?? stat(blocks.json).mtime`),
  `articles.archived_at`, `title_override`, `opens`, `last_opened_at` (all from `shelf.json`)
- `comments`, `chat_threads`, `chat_messages`, `search_runs`, `glossary_lookups`
- `article_revisions.raw_bytes` — the payload is a `raw_sources` pointer plus a blob now
- `block_identities` for a block **no revision contains** — the importer minted those from comment
  and chat anchors, and `tests/chat-anchor.test.ts` exists to prove one survives a round trip

What each suite needs as a result:

- **`store-parity`** needs the shelf columns (it asserts archived articles are excluded from search)
  and the comment counts (`LibraryEntry.comments`), and needs `articles.created_at` seeded, because
  library order is `coalesce(article_revisions.fetched_at, articles.created_at)` and a draft minted
  today sorts to the top.
- **`store-roundtrip`** exports back to files and compares. It needs all five reader-state files, and
  it needs the raw payload — which now lives in the blob bucket rather than `raw_bytes`, so
  `src/store/export.ts` reads a column that will be null.
- **`chat-anchor`** needs a chat thread anchored to a block the article does not contain, and the
  `block_identities` row that makes that legal.

The question is **where that setup belongs**. Two shapes:

- **(A) One fat loader.** `loadArticleIntoPg` grows options — `shelf`, `comments`, `chat` — and
  writes them through the live reader stores. Every suite gets its state from one place.
- **(B) A thin loader plus per-suite setup.** The loader stays artefacts-only, and each suite writes
  the reader state it actually needs through the live stores itself, in its own `beforeAll`.

I lean (B): the loader's honesty comes from being *exactly* the production write path, and options
that write comments would make it a small importer again — the thing § C7 rejected. The cost is
three copies of "insert a comment", which I would rather have than one helper that can drift into a
second implementation.

But (B) leaves `store-roundtrip` writing five kinds of reader state by hand, which is most of that
suite's setup. Is the seam in the right place, or should there be a *separate* `reader-state.ts`
helper that both the loader and the suites can use, kept deliberately apart from the artefact path?

## Also please tell me

4. `src/store/export.ts` reads `article_revisions.raw_bytes` and returns nothing when it is null.
   After C6 the payload is in the blob bucket behind `raw_source_sha256`. Should `db:export` learn to
   read the blob (making the round trip real again), or should the round-trip suite stop asserting on
   raw bytes? The demolition drops `raw_bytes` either way, so this is not optional for long.

5. Anything in the loader below that is wrong, unsafe, or claims more than it does. In particular the
   `finally` that releases the job, and the retry on `jobs_only_one_running` / `jobs_active_slug`.

## The loader as built

```ts
/**
 * Put one filesystem article into Postgres the way the pipeline would.
 *
 * ## Why this is not `importArticle`
 *
 * `db:import` is being deleted (docs/plans/delete-the-importer.md § C7), and
 * three suites used it purely as a fixture loader. The replacement is not a
 * smaller importer — that would be a second files → Postgres implementation,
 * exercised only by tests and therefore free to drift from the path production
 * actually runs. It is the *real* write path, driven over a fixture:
 *
 * 1. a running `jobs` row, because every artefact write is fenced on one;
 * 2. `openOrBeginJobDraft`, the same call `advanceJob` makes;
 * 3. `copyArtefacts` from the filesystem store to `pgArtifactsIn`, which is
 *    `beginStep` → `write` → `finishStep` per step, in pipeline order;
 * 4. `publishRevision`, with its guards run rather than routed around;
 * 5. the job released, so the next call can have the single running slot.
 *
 * Every byte therefore crosses the same seam a real ingest crosses. What that
 * buys is stated plainly in tests/helpers/artefacts.ts; what it *costs* is that
 * this loader carries strictly less than the importer did, and the difference
 * is not an oversight — see § What this does not carry.
 *
 * ## What this does not carry
 *
 * `ArtifactStore` owns artefacts and nothing else, so **no reader state** comes
 * across: comments, chat, searches, glossary lookups, the shelf. A suite that
 * needs any of it must write it through the live reader stores, which is also
 * how production gets it.
 *
 * **`created_at` is today unless you say otherwise.** A draft minted by this
 * function was minted *now*, and the filesystem's idea of when the article
 * arrived is the blocks file's mtime. Where a suite compares the two stores'
 * library entries, that difference is the whole assertion, so `createdAt` is an
 * explicit option rather than something quietly inferred — a fixture that
 * guessed would make "today" pass for history and the parity claim would be
 * about nothing.
 */
import { and, eq } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articleRevisions, jobs } from "../../src/db/schema.js";
import { mintId } from "../../src/ids.js";
import { currentOwnerId } from "../../src/owner.js";
import { createFsArtifactStore } from "../../src/store/artifacts-fs.js";
import { pgArtifactsIn } from "../../src/store/artifacts-pg.js";
import { mintAttempt } from "../../src/store/jobs.js";
import { openOrBeginJobDraft, publishRevision } from "../../src/store/pg-revisions.js";
import type { JobStep } from "../../src/types.js";
import type { StepName } from "../../src/types.js";
import { copyArtefacts } from "./artefacts.js";

/** What the load produced, so a caller can assert on it rather than assume. */
export interface LoadedArticle {
  readonly articleId: string;
  readonly revisionId: string;
  /**
   * The steps that actually had something to copy — **the thing to assert on**.
   * A silent no-op over an article the filesystem has never heard of returns an
   * empty array, and a fixture that loaded nothing is the failure this repo
   * keeps meeting (docs/reusable/silent-success.md).
   */
  readonly copied: readonly StepName[];
  /** False when `publish` was off, or when the gate refused and `publish` was `"try"`. */
  readonly published: boolean;
  /** The gate's reasons, when it refused. Empty otherwise. */
  readonly refusedBecause: readonly string[];
}

export interface LoadOptions {
  /**
   * What `article_revisions.created_at` should say. Left alone when absent,
   * which means "now" — see the note above about history.
   */
  readonly createdAt?: Date;
  /**
   * `true` (the default) publishes and throws if the gate refuses.
   * `"try"` publishes but reports a refusal on the result instead of throwing,
   * for a suite whose subject *is* the gate.
   * `false` leaves the revision a draft.
   */
  readonly publish?: boolean | "try";
  /**
   * Whose article it is. Defaults to `currentOwnerId()`, which outside a
   * request is the environment's owner — the same answer `importArticle` used,
   * so a suite that does not care about ownership does not have to say.
   */
  readonly ownerId?: string;
}

/** A job's step list has to be non-empty and well-formed; nothing reads these. */
const FIXTURE_STEPS: JobStep[] = [
  { name: "toc", label: "Building the table of contents", status: "pending" },
];

/**
 * Take the single running slot, run `body`, and give the slot back.
 *
 * **The retry is not defensive padding.** `jobs_only_one_running` is a partial
 * unique index over the *whole table*, so a dev server mid-ingest, or another
 * suite's fixture, will refuse this insert — and the refusal arrives as a
 * constraint name rather than as anything a test could recognise. Retrying on
 * that one name and rethrowing everything else keeps a genuine bug loud.
 *
 * The release is in `finally` because a job left running would wedge every
 * later call in the same run, turning one real failure into a file full of
 * timeouts that say nothing about what broke.
 */
async function withRunningJob<T>(
  slug: string,
  ownerId: string,
  body: (job: { id: string; attemptId: string }) => Promise<T>,
): Promise<T> {
  const db = getDb();
  for (let attempt = 1; ; attempt++) {
    const job = { id: mintId(), attemptId: mintAttempt() };
    try {
      await db.insert(jobs).values({
        id: job.id,
        ownerId,
        slug,
        steps: FIXTURE_STEPS,
        status: "running",
        attemptId: job.attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `fixture-${job.id}`,
      });
    } catch (err) {
      const constraint = (err as { cause?: { constraint?: string } }).cause?.constraint;
      /* `jobs_active_slug` too, not only the global slot: a previous load of the
         same slug that died before its `finally` leaves a running row for this
         article, and that refuses on a different name for the same reason. */
      if (constraint !== "jobs_only_one_running" && constraint !== "jobs_active_slug") throw err;
      if (attempt >= 40) {
        throw new Error(
          `could not get the running-job slot for "${slug}" in 20s — another job is holding it. ` +
            "Re-run when the queue is idle, or check for a wedged `running` row in `jobs`.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    try {
      return await body(job);
    } finally {
      /* Done and owning no draft. The pointer is cleared as well as the status
         because `jobs_draft_revision_unique` is not partial on status: a
         finished job still holding a draft id is a row that can refuse a later,
         legitimate claim on the same revision. */
      await db
        .update(jobs)
        .set({ status: "done", attemptId: null, leaseExpiresAt: null, draftRevisionId: null, finishedAt: new Date() })
        .where(and(eq(jobs.id, job.id)));
    }
  }
}

/**
 * Load `slug` from `data/` into Postgres, published by default.
 *
 * Idempotent in the way the pipeline is idempotent: each call mints a fresh
 * draft from whatever is published, copies over it and publishes again. It does
 * not compare against what is already there, and it is not trying to.
 */
export async function loadArticleIntoPg(
  slug: string,
  opts: LoadOptions = {},
): Promise<LoadedArticle> {
  const { publish = true, ownerId = currentOwnerId() } = opts;
  const fs = createFsArtifactStore();
  const db = getDb();

  return withRunningJob(slug, ownerId, async (job) => {
    const draft = await openOrBeginJobDraft({ slug, job });
    const ref = {
      slug,
      articleId: draft.articleId,
      revisionId: draft.revisionId,
      jobId: job.id,
      attemptId: job.attemptId,
    };

    /* One transaction around the whole copy, which is what the coordinator will
       do for one step. Not one per step: a fixture that committed step by step
       could leave an article half-loaded behind a failure, and the next suite
       to read it would fail somewhere else entirely. */
    const copied = await db.transaction((tx) => copyArtefacts(fs, pgArtifactsIn(ref, tx), slug));

    if (opts.createdAt) {
      await db
        .update(articleRevisions)
        .set({ createdAt: opts.createdAt })
        .where(eq(articleRevisions.id, draft.revisionId));
    }

    if (publish === false) return { ...ref, copied, published: false, refusedBecause: [] };

    try {
      await publishRevision({ slug, revisionId: draft.revisionId, job });
      return { ...ref, copied, published: true, refusedBecause: [] };
    } catch (err) {
      if (publish !== "try") throw err;
      return {
        ...ref,
        copied,
        published: false,
        refusedBecause: [(err as Error).message],
      };
    }
  });
}

```
